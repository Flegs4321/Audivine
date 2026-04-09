import { parseMemberSummaryText } from "@/lib/bulletin/parse-member-summary";
import type { SonlightBulletinJson } from "./types";

const NA = "N/A";

/** First line "THOSE IN SERVICE …" goes to the template {{IN_SERVICE}} row; rest are {{PRAYER_ITEM}}. */
function partitionPrayerSharing(items: string[]): { in_service: string; items: string[] } {
  if (items.length === 0) return { in_service: NA, items: [] };
  const first = items[0].replace(/^\^+\s*/, "").replace(/^[➤]\s*/u, "").trim();
  if (/^those\s+in\s+service\b/i.test(first) || /^in\s+service\s*[-–:]/i.test(first)) {
    return { in_service: items[0].trim(), items: items.slice(1) };
  }
  return { in_service: NA, items };
}

/** One bulletin row per takeaway; split pasted paragraphs / multi-line bullets. */
function expandSermonPoints(points: string[]): string[] {
  const out: string[] = [];
  for (const raw of points) {
    if (!raw.trim()) continue;
    const chunks = raw
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (chunks.length <= 1) {
      out.push(raw.trim());
      continue;
    }
    for (const c of chunks) {
      const strip = c.replace(/^\^+\s*/, "").replace(/^[➤•\-\*\u2022]\s*/, "").trim();
      if (strip.length > 0) out.push(strip);
    }
  }
  return out;
}

/**
 * Maps the same member summary text shown in the review modal into the Sonlight bulletin
 * JSON used by bulletin-final/template/template.docx — without calling Claude again.
 */
export function memberSummaryToBulletinJson(fullSummary: string): SonlightBulletinJson {
  const { parsedSections, messageSpeakerFromSummary } = parseMemberSummaryText(fullSummary);
  const now = new Date();
  const date = `${now.getFullYear()}.${now.getMonth() + 1}.${now.getDate()}`;
  const sermonPoints = expandSermonPoints(parsedSections.Sermon);
  const prayer = partitionPrayerSharing(parsedSections.Sharing);

  return {
    date,
    announcements: {
      this_evening: NA,
      wednesday_eve: NA,
      next_sunday_devotions: NA,
      next_sunday_chair_set_up: NA,
      next_sunday_host_hostess: NA,
      additional: parsedSections.Announcements,
    },
    upcoming_events: parsedSections["Upcoming Events"],
    prayer_sharing: {
      in_service: prayer.in_service,
      items: prayer.items,
    },
    message: {
      speaker: messageSpeakerFromSummary || NA,
      title: NA,
      points: sermonPoints,
    },
  };
}
