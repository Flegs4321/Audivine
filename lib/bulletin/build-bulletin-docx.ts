import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import type { SonlightBulletinJson } from "./types";

function templatePath(): string {
  return path.join(process.cwd(), "bulletin-final", "template", "template.docx");
}

function esc(str: string | undefined): string {
  return (str || "N/A").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function cloneSection(xml: string, marker: string, items: string[] | undefined): string {
  const idx = xml.indexOf(marker);
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

  const clones = items.map((item) => templateBlock.replace(marker, esc(item))).join("\n    ");
  return xml.substring(0, pStart) + clones + xml.substring(pEnd);
}

/**
 * Fills bulletin-final/template/template.docx using the same XML rules as bulletin-final/generate.js.
 */
export function buildBulletinDocxBuffer(bulletin: SonlightBulletinJson): Buffer {
  const tpl = templatePath();
  if (!fs.existsSync(tpl)) {
    throw new Error(`Bulletin template not found at ${tpl}`);
  }

  const input = fs.readFileSync(tpl);
  const zip = new PizZip(input);
  const doc = zip.file("word/document.xml");
  if (!doc) {
    throw new Error("word/document.xml missing from template .docx");
  }

  let xml = doc.asText();

  xml = xml.replace("{{DATE}}", esc(bulletin.date));
  xml = xml.replace("{{THIS_EVENING}}", esc(bulletin.announcements?.this_evening));
  xml = xml.replace("{{WEDNESDAY_EVE}}", esc(bulletin.announcements?.wednesday_eve));
  xml = xml.replace("{{DEVOTIONS}}", esc(bulletin.announcements?.next_sunday_devotions));
  xml = xml.replace("{{CHAIR_SETUP}}", esc(bulletin.announcements?.next_sunday_chair_set_up));
  xml = xml.replace("{{HOST_HOSTESS}}", esc(bulletin.announcements?.next_sunday_host_hostess));
  xml = xml.replace("{{IN_SERVICE}}", esc(bulletin.prayer_sharing?.in_service));
  xml = xml.replace("{{SPEAKER}}", esc(bulletin.message?.speaker));
  xml = xml.replace("{{SERMON_TITLE}}", esc(bulletin.message?.title));

  xml = cloneSection(xml, "{{ANNOUNCEMENT_ITEM}}", bulletin.announcements?.additional || []);
  xml = cloneSection(xml, "{{EVENT_ITEM}}", bulletin.upcoming_events || []);
  const prayerItems = (bulletin.prayer_sharing?.items || []).map((s) =>
    s.replace(/^[➤•]\s*/gu, "").trim()
  );
  xml = cloneSection(xml, "{{PRAYER_ITEM}}", prayerItems);
  xml = cloneSection(xml, "{{MESSAGE_POINT}}", bulletin.message?.points || []);

  zip.file("word/document.xml", xml);

  const out = zip.generate({
    type: "nodebuffer",
    compression: "DEFLATE",
  }) as Buffer;

  return out;
}
