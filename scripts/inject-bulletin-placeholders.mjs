/**
 * Rewrites bulletin-final/template/TEMPLATE.docx document.xml to use {{PLACEHOLDER}}
 * tokens expected by build-bulletin-docx.ts / generate.js. The .docx may have been
 * saved with static example text only (no tokens), so exports never changed.
 *
 * Usage: node scripts/inject-bulletin-placeholders.mjs
 *   --backup   Force-copy current template to TEMPLATE.backup-static-content.docx first
 *
 * Safe paragraph removal uses exact <w:p>...</w:p> XML from the original template
 * (not regex from first <w:p> to a substring — that can delete most of the document).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import PizZip from "pizzip";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const templatePath = path.join(root, "bulletin-final", "template", "TEMPLATE.docx");
const backupPath = path.join(
  root,
  "bulletin-final",
  "template",
  "TEMPLATE.backup-static-content.docx"
);

/** Full paragraph XML copied from TEMPLATE.docx (word/document.xml) — one-time static example. */
const EXACT_PARAGRAPHS_TO_REMOVE = [
  `<w:p w14:paraId="78C68038" w14:textId="77777777" w:rsidR="004A44AA" w:rsidRDefault="00000000"><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr><w:spacing w:before="20" w:after="20"/></w:pPr><w:r><w:t>Youth group volunteering at food bank next Saturday</w:t></w:r></w:p>`,
  `<w:p w14:paraId="4ABD5464" w14:textId="77777777" w:rsidR="004A44AA" w:rsidRDefault="00000000"><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr><w:spacing w:before="20" w:after="20"/></w:pPr><w:r><w:t>April 8th – Preparatory Service</w:t></w:r></w:p>`,
  `<w:p w14:paraId="5C5B5406" w14:textId="77777777" w:rsidR="004A44AA" w:rsidRDefault="00000000"><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr><w:spacing w:before="20" w:after="20"/></w:pPr><w:r><w:t>April 12th – Communion</w:t></w:r></w:p>`,
  `<w:p w14:paraId="36B33FE6" w14:textId="77777777" w:rsidR="004A44AA" w:rsidRDefault="00000000"><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr><w:spacing w:before="20" w:after="20"/></w:pPr><w:r><w:t xml:space="preserve">Pike County Boy’s Camp registration opens April 1st – 60 </w:t></w:r><w:proofErr w:type="gramStart"/><w:r><w:t>boys</w:t></w:r><w:proofErr w:type="gramEnd"/><w:r><w:t xml:space="preserve"> max</w:t></w:r></w:p>`,
  `<w:p w14:paraId="15A72C9B" w14:textId="77777777" w:rsidR="004A44AA" w:rsidRDefault="00000000"><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr><w:spacing w:before="20" w:after="20"/></w:pPr><w:r><w:t>May 17th – DNR Presentation</w:t></w:r></w:p>`,
  `<w:p w14:paraId="19B339C8" w14:textId="77777777" w:rsidR="004A44AA" w:rsidRDefault="00000000"><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="4"/></w:numPr><w:spacing w:before="20" w:after="20"/></w:pPr><w:r><w:t>Martha Byler – Pray for her mother recovering from hip surgery</w:t></w:r></w:p>`,
  `<w:p w14:paraId="0BBC7451" w14:textId="77777777" w:rsidR="004A44AA" w:rsidRDefault="00000000"><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="4"/></w:numPr><w:spacing w:before="20" w:after="20"/></w:pPr><w:r><w:t>Kevin Graber – God’s faithfulness in providing a new job</w:t></w:r></w:p>`,
  `<w:p w14:paraId="57C705EA" w14:textId="77777777" w:rsidR="004A44AA" w:rsidRDefault="00000000"><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="4"/></w:numPr><w:spacing w:before="20" w:after="20"/></w:pPr><w:r><w:t>Rhoda Miller – Feeling anxious about upcoming medical tests, trusting God</w:t></w:r></w:p>`,
  `<w:p w14:paraId="093ACE95" w14:textId="77777777" w:rsidR="004A44AA" w:rsidRDefault="00000000"><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="4"/></w:numPr><w:spacing w:before="20" w:after="20"/></w:pPr><w:r><w:t>Josh Byler – Praise for answered prayer about his tooth</w:t></w:r></w:p>`,
  `<w:p w14:paraId="1F75C188" w14:textId="77777777" w:rsidR="004A44AA" w:rsidRDefault="00000000"><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="5"/></w:numPr><w:spacing w:before="20" w:after="20"/></w:pPr><w:r><w:t>1 John 1:5-7 – God is light and in Him there is no darkness</w:t></w:r></w:p>`,
  `<w:p w14:paraId="038E4C1C" w14:textId="77777777" w:rsidR="004A44AA" w:rsidRDefault="00000000"><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="5"/></w:numPr><w:spacing w:before="20" w:after="20"/></w:pPr><w:r><w:t>John 8:12 – Jesus said I am the light of the world</w:t></w:r></w:p>`,
  `<w:p w14:paraId="050A8F83" w14:textId="77777777" w:rsidR="004A44AA" w:rsidRDefault="00000000"><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="5"/></w:numPr><w:spacing w:before="20" w:after="20"/></w:pPr><w:r><w:t>Sin tries to pull us into darkness</w:t></w:r></w:p>`,
  `<w:p w14:paraId="0130570E" w14:textId="77777777" w:rsidR="004A44AA" w:rsidRDefault="00000000"><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="5"/></w:numPr><w:spacing w:before="20" w:after="20"/></w:pPr><w:r><w:t>Ephesians 5:8 – For you were once darkness but now you are light in the Lord</w:t></w:r></w:p>`,
  `<w:p w14:paraId="36886BFC" w14:textId="77777777" w:rsidR="004A44AA" w:rsidRDefault="00000000"><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="5"/></w:numPr><w:spacing w:before="20" w:after="20"/></w:pPr><w:r><w:t>How do we walk in the light daily?</w:t></w:r></w:p>`,
  `<w:p w14:paraId="2AA3695B" w14:textId="77777777" w:rsidR="004A44AA" w:rsidRDefault="00000000"><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="5"/></w:numPr><w:spacing w:before="20" w:after="20"/></w:pPr><w:r><w:t>Psalm 119:105 – Your word is a lamp to my feet</w:t></w:r></w:p>`,
  `<w:p w14:paraId="5A0D9FF3" w14:textId="77777777" w:rsidR="004A44AA" w:rsidRDefault="00000000"><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="5"/></w:numPr><w:spacing w:before="20" w:after="20"/></w:pPr><w:r><w:t>The importance of fellowship and accountability</w:t></w:r></w:p>`,
  `<w:p w14:paraId="57BE0996" w14:textId="77777777" w:rsidR="004A44AA" w:rsidRDefault="00000000"><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="5"/></w:numPr><w:spacing w:before="20" w:after="20"/></w:pPr><w:r><w:t>We must choose light over darkness every single day</w:t></w:r></w:p>`,
  `<w:p w14:paraId="3082B74E" w14:textId="77777777" w:rsidR="004A44AA" w:rsidRDefault="00000000"><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="5"/></w:numPr><w:spacing w:before="20" w:after="20"/></w:pPr><w:r><w:t>Matthew 5:16 – Let your light shine before others</w:t></w:r></w:p>`,
];

function main() {
  const forceBackup = process.argv.includes("--backup");

  if (!fs.existsSync(templatePath)) {
    console.error("Missing:", templatePath);
    process.exit(1);
  }

  if (forceBackup || !fs.existsSync(backupPath)) {
    fs.copyFileSync(templatePath, backupPath);
    console.log("Backed up to", backupPath);
  }

  const zip = new PizZip(fs.readFileSync(templatePath));
  let xml = zip.file("word/document.xml").asText();
  const initialLen = xml.length;

  const pairs = [
    ["<w:t>2026.3.29</w:t>", "<w:t>{{DATE}}</w:t>"],
    ["<w:t>This Evening: No Service</w:t>", "<w:t>{{THIS_EVENING}}</w:t>"],
    ["<w:t>Wednesday Eve: Small Groups</w:t>", "<w:t>{{WEDNESDAY_EVE}}</w:t>"],
    ["<w:t>Next Sunday Devotions: Marcus Yoder</w:t>", "<w:t>{{DEVOTIONS}}</w:t>"],
    ["<w:t>Next Sunday Chair Set Up: Brian Miller</w:t>", "<w:t>{{CHAIR_SETUP}}</w:t>"],
    [
      "<w:t>Next Sunday Host &amp; Hostess: Kevin &amp; Sarah Wagler</w:t>",
      "<w:t>{{HOST_HOSTESS}}</w:t>",
    ],
    [
      "<w:t>Church potluck April 20th after morning service</w:t>",
      "<w:t>{{ANNOUNCEMENT_ITEM}}</w:t>",
    ],
    ["<w:t>April 5th – Easter Sunday</w:t>", "<w:t>{{EVENT_ITEM}}</w:t>"],
    [
      "<w:t>THOSE IN SERVICE - Judith Miller (EBI); Bryant Wagler (Detroit)</w:t>",
      "<w:t>{{IN_SERVICE}}</w:t>",
    ],
    [
      "<w:t>Leon Wagler – Praise for safe travel mercies this week</w:t>",
      "<w:t>{{PRAYER_ITEM}}</w:t>",
    ],
    [
      "<w:t>4. MESSAGE – David Yoder – Walking in the Light</w:t>",
      "<w:t>4. MESSAGE – {{SPEAKER}} – {{SERMON_TITLE}}</w:t>",
    ],
    ["<w:t>We are called to be children of light</w:t>", "<w:t>{{MESSAGE_POINT}}</w:t>"],
  ];

  for (const [from, to] of pairs) {
    if (!xml.includes(from)) {
      console.warn("WARN: substring not found (skip):", from.slice(0, 72) + "…");
    } else {
      xml = xml.split(from).join(to);
    }
  }

  for (const block of EXACT_PARAGRAPHS_TO_REMOVE) {
    if (!xml.includes(block)) {
      console.warn("WARN: exact paragraph block not found (skip), len=", block.length);
    } else {
      xml = xml.split(block).join("");
    }
  }

  if (xml.length < initialLen * 0.5) {
    console.error("Abort: document.xml shrank too much; refusing to write.");
    process.exit(1);
  }

  if (!xml.includes("{{DATE}}") || !xml.includes("{{ANNOUNCEMENT_ITEM}}")) {
    console.error("Abort: expected placeholders missing after edit.");
    process.exit(1);
  }

  zip.file("word/document.xml", xml);
  fs.writeFileSync(templatePath, zip.generate({ type: "nodebuffer", compression: "DEFLATE" }));
  console.log("Updated", templatePath, "document.xml length:", xml.length);
}

main();
