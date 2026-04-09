/**
 * Removes a literal "^ " prefix before {{PRAYER_ITEM}} in the bulletin template (if present).
 * Run: node scripts/patch-prayer-item-caret.mjs
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

if (!xml.includes("{{PRAYER_ITEM}}")) {
  console.error("{{PRAYER_ITEM}} not found in template");
  process.exit(1);
}

if (!xml.includes("^ {{PRAYER_ITEM}}")) {
  console.log("No ^ before {{PRAYER_ITEM}}; nothing to remove.");
  process.exit(0);
}

xml = xml.split('<w:t xml:space="preserve">^ {{PRAYER_ITEM}}</w:t>').join("<w:t>{{PRAYER_ITEM}}</w:t>");
if (xml.includes("^ {{PRAYER_ITEM}}")) {
  xml = xml.split("^ {{PRAYER_ITEM}}").join("{{PRAYER_ITEM}}");
}

zip.file("word/document.xml", xml);
fs.writeFileSync(templatePath, zip.generate({ type: "nodebuffer", compression: "DEFLATE" }));
console.log("Removed ^ before {{PRAYER_ITEM}} in", templatePath);
