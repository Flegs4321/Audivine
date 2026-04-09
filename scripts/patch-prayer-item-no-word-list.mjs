/**
 * Removes Word list numbering from the {{PRAYER_ITEM}} paragraph only, so we don't get
 * a built-in bullet glyph + the ➤ we add in code (double arrowheads).
 * Run: node scripts/patch-prayer-item-no-word-list.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import PizZip from "pizzip";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const templatePath = path.join(root, "bulletin-final", "template", "TEMPLATE.docx");

const zip = new PizZip(fs.readFileSync(templatePath));
let xml = zip.file("word/document.xml").asText();

const withList =
  '<w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="4"/></w:numPr><w:spacing w:before="20" w:after="20"/></w:pPr><w:r><w:t>{{PRAYER_ITEM}}</w:t></w:r>';
const noList =
  '<w:pPr><w:spacing w:before="20" w:after="20"/></w:pPr><w:r><w:t>{{PRAYER_ITEM}}</w:t></w:r>';

if (!xml.includes("{{PRAYER_ITEM}}")) {
  console.error("{{PRAYER_ITEM}} not found");
  process.exit(1);
}

if (!xml.includes(withList)) {
  if (xml.includes(noList)) {
    console.log("PRAYER_ITEM paragraph already has no list; nothing to do.");
    process.exit(0);
  }
  console.error("Expected PRAYER_ITEM list paragraph block not found; template may have changed.");
  process.exit(1);
}

xml = xml.split(withList).join(noList);
zip.file("word/document.xml", xml);
fs.writeFileSync(templatePath, zip.generate({ type: "nodebuffer", compression: "DEFLATE" }));
console.log("Removed Word list from PRAYER_ITEM row in", templatePath);
