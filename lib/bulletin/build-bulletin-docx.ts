import fs from "fs";
import PizZip from "pizzip";
import type { SonlightBulletinJson } from "./types";
import { bulletinTemplateDir, resolveBulletinTemplateDocxPath } from "./bulletin-final-paths";
import { findSplitMarkerIndex, replaceSplitPlaceholder } from "./docx-xml-placeholders";
import {
  cleanMarkdownArtifactsForPrayer,
  normalizeSharingTypography,
  SHARING_LINE_ARROWHEAD,
} from "./prayer-sharing-text";

function esc(str: string | undefined): string {
  return (str || "N/A").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function cloneSection(
  xml: string,
  marker: string,
  items: string[] | undefined,
  formatItem?: (item: string, index: number) => string
): string {
  const idx = findSplitMarkerIndex(xml, marker);
  if (idx === -1) return xml;

  let pStart = idx;
  while (pStart > 0) {
    pStart--;
    if (
      xml[pStart] === "<" &&
      xml.substring(pStart, pStart + 4) === "<w:p" &&
      (xml[pStart + 4] === " " || xml[pStart + 4] === ">")
    ) {
      break;
    }
  }
  const pEnd = xml.indexOf("</w:p>", idx) + "</w:p>".length;
  const templateBlock = xml.substring(pStart, pEnd);

  if (!items || items.length === 0) {
    return xml.substring(0, pStart) + xml.substring(pEnd);
  }

  const clones = items
    .map((item, i) =>
      replaceSplitPlaceholder(
        templateBlock,
        marker,
        formatItem ? formatItem(item, i) : esc(item)
      )
    )
    .join("\n    ");
  return xml.substring(0, pStart) + clones + xml.substring(pEnd);
}

/**
 * One paragraph per speaker: ➤ + whole testimony on one line (no Word list glyph — that doubled the arrowheads).
 */
function formatPrayerItemForDocx(item: string, _index: number): string {
  let t = item
    .replace(/^>\s*/, "")
    .replace(/^[➤•]\s*/gu, "")
    .trim();
  t = t.replace(/^\^+\s*/, "");
  t = cleanMarkdownArtifactsForPrayer(t);
  t = t.replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim();
  t = normalizeSharingTypography(t);
  if (!t) return esc("N/A");
  return esc(`${SHARING_LINE_ARROWHEAD} ${t}`);
}

/**
 * Fills the master template under bulletin-final/template/ (see bulletin-final-paths)
 * using the same XML rules as bulletin-final/generate.js.
 */
export function buildBulletinDocxBuffer(
  bulletin: SonlightBulletinJson,
  templateInput?: Buffer | Uint8Array
): Buffer {
  let input: Buffer | Uint8Array;
  if (templateInput && templateInput.length > 0) {
    input = templateInput;
  } else {
    const tpl = resolveBulletinTemplateDocxPath();
    if (!fs.existsSync(tpl)) {
      throw new Error(
        `Bulletin template not found. Place template.docx (or TEMPLATE.docx) in ${bulletinTemplateDir()}`
      );
    }
    input = fs.readFileSync(tpl);
  }
  const zip = new PizZip(input);
  const doc = zip.file("word/document.xml");
  if (!doc) {
    throw new Error("word/document.xml missing from template .docx");
  }

  let xml = doc.asText();

  if (!xml.includes("{{DATE}}")) {
    throw new Error(
      `Bulletin template has no {{DATE}} placeholder. The .docx may be a static example only; ` +
        `replace body copy with tokens (see bulletin-final/.cursorrules) or run scripts/inject-bulletin-placeholders.mjs on a copy that matches the expected example lines.`
    );
  }

  const rep = (token: string, val: string | undefined) => {
    xml = replaceSplitPlaceholder(xml, token, esc(val));
  };

  rep("{{DATE}}", bulletin.date);
  rep("{{THIS_EVENING}}", bulletin.announcements?.this_evening);
  rep("{{WEDNESDAY_EVE}}", bulletin.announcements?.wednesday_eve);
  rep("{{DEVOTIONS}}", bulletin.announcements?.next_sunday_devotions);
  rep("{{CHAIR_SETUP}}", bulletin.announcements?.next_sunday_chair_set_up);
  rep("{{HOST_HOSTESS}}", bulletin.announcements?.next_sunday_host_hostess);
  const inServiceRaw = bulletin.prayer_sharing?.in_service || "";
  const inServiceOut = normalizeSharingTypography(
    cleanMarkdownArtifactsForPrayer(inServiceRaw).replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim()
  );
  rep("{{IN_SERVICE}}", inServiceOut || undefined);
  rep("{{SPEAKER}}", bulletin.message?.speaker);
  rep("{{SERMON_TITLE}}", bulletin.message?.title);

  xml = cloneSection(xml, "{{ANNOUNCEMENT_ITEM}}", bulletin.announcements?.additional || []);
  xml = cloneSection(xml, "{{EVENT_ITEM}}", bulletin.upcoming_events || []);
  const prayerItems = (bulletin.prayer_sharing?.items || []).map((s) =>
    s.replace(/^\^+\s*/, "").replace(/^>\s*/, "").replace(/^[➤•]\s*/gu, "").trim()
  );
  xml = cloneSection(xml, "{{PRAYER_ITEM}}", prayerItems, formatPrayerItemForDocx);
  xml = cloneSection(xml, "{{MESSAGE_POINT}}", bulletin.message?.points || []);

  zip.file("word/document.xml", xml);

  const out = zip.generate({
    type: "nodebuffer",
    compression: "DEFLATE",
  }) as Buffer;

  return out;
}
