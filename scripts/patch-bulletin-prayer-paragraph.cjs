const fs = require("fs");
const path = require("path");
const PizZip = require("pizzip");

const docxPath = path.join(__dirname, "..", "bulletin-final", "template", "template.docx");

const zip = new PizZip(fs.readFileSync(docxPath));
let xml = zip.file("word/document.xml").asText();

const old =
  '<w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="4"/></w:numPr><w:spacing w:before="20" w:after="20"/></w:pPr><w:r><w:t>{{PRAYER_ITEM}}</w:t></w:r></w:p>';

const neu =
  '<w:pPr><w:spacing w:before="20" w:after="20"/></w:pPr><w:r><w:t xml:space="preserve">➤ {{PRAYER_ITEM}}</w:t></w:r></w:p>';

if (!xml.includes(old)) {
  console.error("Expected PRAYER_ITEM paragraph block not found; template may have changed.");
  process.exit(1);
}

xml = xml.split(old).join(neu);
zip.file("word/document.xml", xml);
fs.writeFileSync(docxPath, zip.generate({ type: "nodebuffer", compression: "DEFLATE" }));
console.log("Updated bulletin-final/template/template.docx (prayer: one ➤, no Word list).");
