/**
 * Parse AI-generated member summary text into bulletin sections.
 */

import { cleanMarkdownArtifactsForPrayer, normalizeSharingTypography } from "./prayer-sharing-text";

export type ParsedBulletinSections = {
  Announcements: string[];
  "Upcoming Events": string[];
  Sharing: string[];
  Sermon: string[];
};

/** Strip markers sometimes pasted before sharing lines (bullets, stray ^, markdown quote). */
function stripSharingLinePrefix(line: string): string {
  let s = line.trim();
  for (let i = 0; i < 8; i++) {
    const next = s
      .replace(/^\^+\s*/, "")
      .replace(/^>\s*/, "")
      .replace(/^[➤•\-\u2022]\s*/u, "")
      .replace(/^\*+\s*/, "")
      .trim();
    if (next === s) break;
    s = next;
  }
  return s;
}

/**
 * A new sharing block starts when a line looks like a speaker lead-in:
 * "First Last – …", "First Last (EBI) – …", "Leon – …", "Kevin & Sarah Wagler – …".
 * Continuation lines (no such prefix) merge into the previous block.
 */
function isNewSpeakerSharingLine(line: string): boolean {
  const s = stripSharingLinePrefix(line);
  if (s.length < 4) return false;

  // Markdown-only speaker line: **Emanuel Slabaugh** or **Speaker: Name**
  if (/^\*\*[^*]+\*\*\s*$/.test(s)) return true;
  if (/^speaker:\s*\*\*[^*]+\*\*\s*$/i.test(s)) return true;

  if (s.length < 6) return false;

  const paren = String.raw`(?:\s*\([^)]{0,40}\))?`;
  const capWord = String.raw`[A-Z][a-z]+`;
  const twoWordName = String.raw`${capWord}\s+${capWord}`;
  /** e.g. "Kevin & Sarah Wagler – …" */
  const ampName = String.raw`${capWord}\s*&\s*${capWord}\s+${capWord}`;
  const multiName = String.raw`(?:${ampName}|${twoWordName})`;
  const ampSecondPair = String.raw`(?:\s*&\s*${capWord}(?:\s+${capWord})?)?`;

  const re = new RegExp(
    String.raw`^(?:${multiName}${paren}${ampSecondPair}|${capWord}${paren})\s*[-–—]\s*\S`,
    "u"
  );
  return re.test(s);
}

/**
 * Word bulletin uses one {{PRAYER_ITEM}} paragraph per array entry; each becomes a numbered list row.
 * Merge lines that belong to the same speaker so PDF/Word only shows a new marker when the speaker changes.
 */
export function mergeSharingBySpeaker(items: string[]): string[] {
  const cleaned = items.map((s) => stripSharingLinePrefix(s)).filter((s) => s.length > 0);
  if (cleaned.length <= 1) return cleaned;

  const out: string[] = [];
  let buf = cleaned[0];
  for (let i = 1; i < cleaned.length; i++) {
    const line = cleaned[i];
    if (isNewSpeakerSharingLine(line)) {
      out.push(buf);
      buf = line;
    } else {
      buf = `${buf} ${line}`;
    }
  }
  out.push(buf);
  return out;
}

/**
 * Pulls the body under `## SHARING` / `## PRAYER & SHARING` until the next `## …` section.
 * This avoids mixing sharing lines with announcements or sermon when the model uses Markdown.
 */
export function extractMarkdownSharingBody(fullSummary: string): string | null {
  const t = fullSummary.replace(/\r\n/g, "\n");
  const re = /(?:^|\n)(#{1,3})\s*(?:PRAYER\s*(?:&|and)\s*)?SHARING\s*[^\n]*\n/i;
  const m = re.exec(t);
  if (!m) return null;
  const start = m.index + m[0].length;
  const tail = t.slice(start);
  const nextIdx = tail.search(/\n#{1,3}\s*(?:MESSAGE|ANNOUNCE|UPCOMING|SERMON|EVENT|TITLE|INTRO)/i);
  const body = (nextIdx === -1 ? tail : tail.slice(0, nextIdx)).trim();
  return body.length > 0 ? body : null;
}

/**
 * Body under `## MESSAGE` / `## SERMON` until the next `## …` section.
 * When present, this overrides line-by-line Sermon parsing so wording like "event"
 * does not get misclassified as Upcoming Events.
 */
export function extractMarkdownMessageBody(fullSummary: string): string | null {
  const t = fullSummary.replace(/\r\n/g, "\n");
  const re = /(?:^|\n)(#{1,3})\s*(?:MESSAGE|SERMON)\s*[^\n]*\n/i;
  const m = re.exec(t);
  if (!m) return null;
  const start = m.index + m[0].length;
  const tail = t.slice(start);
  const nextIdx = tail.search(
    /\n#{1,3}\s*(?:SHARING|PRAYER|ANNOUNCE|UPCOMING|MESSAGE|SERMON|EVENT|TITLE|INTRO|CLOSING)/i
  );
  const body = (nextIdx === -1 ? tail : tail.slice(0, nextIdx)).trim();
  return body.length > 0 ? body : null;
}

function parseMessageBodyIntoPoints(body: string): string[] {
  const lines = body
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const out: string[] = [];
  for (const line of lines) {
    const bulletMatch = line.match(/^[➤•^\-*\u2022]\s*(.+)$/u);
    const numberedMatch = line.match(/^\d+[.)]\s*(.+)$/);
    const text = bulletMatch ? bulletMatch[1] : numberedMatch ? numberedMatch[1] : line;
    const cleaned = text.replace(/^\^+\s*/, "").trim();
    if (cleaned.length > 0) out.push(cleaned);
  }
  return out;
}

function normalizeSharingItemText(s: string): string {
  const cleaned = cleanMarkdownArtifactsForPrayer(s);
  const oneLine = cleaned
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
  return normalizeSharingTypography(oneLine);
}

/**
 * Turns raw sharing body text into one string per speaker (merge lines, then optional paragraph split).
 */
export function parseSharingBodyIntoItems(body: string): string[] {
  const lines = body
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  let merged = mergeSharingBySpeaker(lines);

  // Model often separates speakers with a blank line but not "Name –" patterns; split paragraphs.
  if (merged.length === 1 && lines.length >= 3) {
    const paras = body
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 12);
    if (paras.length >= 2) {
      merged = paras.flatMap((p) =>
        mergeSharingBySpeaker(
          p
            .split(/\n/)
            .map((l) => l.trim())
            .filter(Boolean)
        )
      );
    }
  }

  return merged.map(normalizeSharingItemText).filter((s) => s.length > 0);
}

export function parseMemberSummaryText(fullSummary: string): {
  parsedSections: ParsedBulletinSections;
  messageSpeakerFromSummary: string | null;
} {
  const lines = fullSummary.split(/\n/);
  const sermonLeadInRe =
    /^(?:[➤•^\-*\u2022]\s*)?[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,4}\s*[-–—]\s*(?:sermon|message)\b/i;

  const parsedSections: ParsedBulletinSections = {
    Announcements: [],
    "Upcoming Events": [],
    Sharing: [],
    Sermon: [],
  };

  let currentSection: keyof ParsedBulletinSections | null = null;
  let currentItems: string[] = [];
  let messageSpeakerFromSummary: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const announcementsMatch = /^[#\s]*announcements?[:\s]*$/i.test(trimmed);
    const eventsMatch = /^[#\s]*(upcoming\s+)?events?[:\s]*$/i.test(trimmed);
    const sharingMatch = /^[#\s]*(prayer\s+&\s+)?sharing[:\s]*$/i.test(trimmed);
    const sermonMatch = /^[#\s]*sermon[:\s\-]*/i.test(trimmed);
    const messageMatch = /^[\d#\s.)\-]*message[:\s\-]/i.test(trimmed);

    if (announcementsMatch || trimmed.toUpperCase() === "ANNOUNCEMENTS") {
      if (currentSection && currentItems.length > 0) {
        parsedSections[currentSection].push(...currentItems);
      }
      currentSection = "Announcements";
      currentItems = [];
    } else if (eventsMatch) {
      if (currentSection && currentItems.length > 0) {
        parsedSections[currentSection].push(...currentItems);
      }
      currentSection = "Upcoming Events";
      currentItems = [];
    } else if (sermonMatch || messageMatch) {
      if (currentSection && currentItems.length > 0) {
        parsedSections[currentSection].push(...currentItems);
      }
      currentSection = "Sermon";
      currentItems = [];
      if (messageMatch && /message\s*:\s*/i.test(trimmed)) {
        const afterColon = trimmed.replace(/^[\d#\s.)\-]*message\s*:\s*/i, "").trim();
        if (afterColon.length > 0) messageSpeakerFromSummary = afterColon;
      }
    } else if (
      sharingMatch ||
      (trimmed.toUpperCase().includes("SHARING") && !trimmed.toUpperCase().includes("PRAYER"))
    ) {
      if (currentSection && currentItems.length > 0) {
        parsedSections[currentSection].push(...currentItems);
      }
      currentSection = "Sharing";
      currentItems = [];
    } else if (/prayer\s*&?\s*sharing/i.test(trimmed)) {
      if (currentSection && currentItems.length > 0) {
        parsedSections[currentSection].push(...currentItems);
      }
      currentSection = "Sharing";
      currentItems = [];
    } else if (currentSection) {
      // Some outputs end sharing with inline "MESSAGE:" on the same line.
      if (currentSection === "Sharing" && /\bmessage\s*:/i.test(trimmed)) {
        const idx = trimmed.search(/\bmessage\s*:/i);
        const before = trimmed.slice(0, idx).trim().replace(/[–—\-:.\s]+$/u, "").trim();
        if (before.length > 0) currentItems.push(before);
        parsedSections.Sharing.push(...currentItems);
        currentSection = "Sermon";
        currentItems = [];
        continue;
      }

      // If model starts sermon bullets before a formal "MESSAGE:" heading, move to Sermon.
      if (currentSection === "Sharing" && sermonLeadInRe.test(trimmed)) {
        parsedSections.Sharing.push(...currentItems);
        currentSection = "Sermon";
        currentItems = [];
      }

      const bulletMatch = trimmed.match(/^[➤•^\-*\u2022]\s*(.+)$/);
      const numberedMatch = trimmed.match(/^\d+[.)]\s*(.+)$/);

      if (bulletMatch || numberedMatch) {
        const text = bulletMatch ? bulletMatch[1] : numberedMatch ? numberedMatch[1] : trimmed;
        if (text && text.trim().length > 0) {
          currentItems.push(text.trim());
        }
      } else if (trimmed.length > 5 && !trimmed.match(/^[#\s]*$/)) {
        currentItems.push(trimmed);
      }
    } else {
      if (/announcements?/i.test(trimmed) && trimmed.length < 20) {
        currentSection = "Announcements";
        currentItems = [];
      } else {
        if (!currentSection) currentSection = "Sermon";
        const bulletMatch = trimmed.match(/^[➤•^\-*\u2022]\s*(.+)$/);
        const text = bulletMatch ? bulletMatch[1] : trimmed;
        if (text && text.trim().length > 0) {
          currentItems.push(text.trim());
        }
      }
    }
  }

  if (currentSection && currentItems.length > 0) {
    parsedSections[currentSection].push(...currentItems);
  }

  const totalItems = Object.values(parsedSections).reduce((sum, items) => sum + items.length, 0);
  if (totalItems === 0) {
    const allLines = fullSummary
      .split(/\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    parsedSections.Sermon = allLines
      .map((line) => {
        const bulletMatch = line.match(/^(?:[➤•^\-*\u2022]\s*|\d+[.)]\s*)(.+)$/);
        return bulletMatch ? bulletMatch[1] : line;
      })
      .filter((item) => item.length > 5);
  }

  const mdSharing = extractMarkdownSharingBody(fullSummary);
  if (mdSharing != null) {
    parsedSections.Sharing = parseSharingBodyIntoItems(mdSharing);
  } else {
    parsedSections.Sharing = mergeSharingBySpeaker(parsedSections.Sharing);
  }

  const mdMessage = extractMarkdownMessageBody(fullSummary);
  if (mdMessage != null) {
    parsedSections.Sermon = parseMessageBodyIntoPoints(mdMessage);
  }

  if (!messageSpeakerFromSummary && parsedSections.Sermon.length > 0) {
    const speakerBulletIndex = parsedSections.Sermon.findIndex((item) =>
      /^Speaker:\s*(.+)$/i.test(item)
    );
    if (speakerBulletIndex >= 0) {
      const match = parsedSections.Sermon[speakerBulletIndex].match(/^Speaker:\s*(.+)$/i);
      if (match && match[1].trim()) {
        messageSpeakerFromSummary = match[1].trim();
        parsedSections.Sermon.splice(speakerBulletIndex, 1);
      }
    }
  }

  return { parsedSections, messageSpeakerFromSummary };
}
