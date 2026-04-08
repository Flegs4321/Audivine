#!/usr/bin/env node

/**
 * Test the bulletin generator locally without API calls.
 * Works on Windows, Mac, and Linux.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const TEMPLATE_PATH = path.join(__dirname, "template", "template.docx");
const OUTPUT_DIR = path.join(__dirname, "output");
const TEMP_DIR = path.join(__dirname, ".temp");

// Detect OS
const isWindows = process.platform === "win32";

function unzipFile(zipPath, destDir) {
  if (isWindows) {
    execSync(`powershell -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${zipPath.replace(/'/g, "''")}', '${destDir.replace(/'/g, "''")}')"`, { stdio: "pipe" });
  } else {
    execSync(`unzip -o "${zipPath}" -d "${destDir}" > /dev/null 2>&1`);
  }
}

function zipFolder(sourceDir, outputZip) {
  if (isWindows) {
    execSync(`powershell -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('${sourceDir.replace(/'/g, "''")}', '${outputZip.replace(/'/g, "''")}')"`, { stdio: "pipe" });
  } else {
    execSync(`cd "${sourceDir}" && find . -type f | sort | zip -X "${outputZip}" -@ > /dev/null 2>&1`);
  }
}

// Mock what Claude would return
const bulletin = {
  date: "2026.4.5",
  announcements: {
    this_evening: "No Service",
    wednesday_eve: "Small Groups",
    next_sunday_devotions: "Levi Graber",
    next_sunday_chair_set_up: "Marcus Yoder",
    next_sunday_host_hostess: "Brian & Amy Miller",
    additional: [
      "Easter breakfast at 8:30 AM before service",
      "Nursery volunteers needed for next month \u2013 sign up sheet in foyer"
    ]
  },
  upcoming_events: [
    "April 8th \u2013 Preparatory Service",
    "April 12th \u2013 Communion",
    "April 20th \u2013 Church Potluck after morning service",
    "Pike County Boy\u2019s Camp registration \u2013 60 boys max",
    "May 17th \u2013 DNR Presentation",
    "June 7th \u2013 Church Picnic at Wagler Farm"
  ],
  prayer_sharing: {
    in_service: "Judith Miller (EBI); Bryant Wagler (Detroit)",
    items: [
      "Marlon Wagler \u2013 Thankful for answered prayers this week",
      "Sarah Knepp \u2013 Recovery going well after surgery, praise God",
      "Kevin Graber \u2013 Pray for guidance on job decision"
    ]
  },
  message: {
    speaker: "Shawn Graber",
    title: "The Risen King",
    points: [
      "The resurrection changed everything",
      "Matthew 28:5-6 \u2013 He is not here, He is risen",
      "1 Corinthians 15:17 \u2013 If Christ has not been raised, your faith is futile",
      "The empty tomb is proof of God\u2019s power",
      "Romans 6:9 \u2013 Death no longer has dominion over Him",
      "Because He lives, we can face tomorrow",
      "John 11:25 \u2013 I am the resurrection and the life"
    ]
  }
};

console.log("\n  === TEST: Bulletin Generator ===\n");

// Build
if (fs.existsSync(TEMP_DIR)) fs.rmSync(TEMP_DIR, { recursive: true, force: true });
fs.mkdirSync(TEMP_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

unzipFile(TEMPLATE_PATH, TEMP_DIR);

// Find document.xml - might be directly in TEMP_DIR/word/ or in a subfolder
let xmlPath = path.join(TEMP_DIR, "word", "document.xml");
if (!fs.existsSync(xmlPath)) {
  // Windows Expand-Archive might put it differently
  const entries = fs.readdirSync(TEMP_DIR);
  for (const entry of entries) {
    const tryPath = path.join(TEMP_DIR, entry, "word", "document.xml");
    if (fs.existsSync(tryPath)) {
      xmlPath = tryPath;
      break;
    }
  }
}

if (!fs.existsSync(xmlPath)) {
  console.log("  ERROR: Could not find word/document.xml in template");
  process.exit(1);
}

let xml = fs.readFileSync(xmlPath, "utf-8");

function esc(str) {
  return (str || "N/A").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// Simple replacements
xml = xml.replace("{{DATE}}", esc(bulletin.date));
xml = xml.replace("{{THIS_EVENING}}", esc(bulletin.announcements.this_evening));
xml = xml.replace("{{WEDNESDAY_EVE}}", esc(bulletin.announcements.wednesday_eve));
xml = xml.replace("{{DEVOTIONS}}", esc(bulletin.announcements.next_sunday_devotions));
xml = xml.replace("{{CHAIR_SETUP}}", esc(bulletin.announcements.next_sunday_chair_set_up));
xml = xml.replace("{{HOST_HOSTESS}}", esc(bulletin.announcements.next_sunday_host_hostess));
xml = xml.replace("{{IN_SERVICE}}", esc(bulletin.prayer_sharing.in_service));
xml = xml.replace("{{SPEAKER}}", esc(bulletin.message.speaker));
xml = xml.replace("{{SERMON_TITLE}}", esc(bulletin.message.title));

// Dynamic cloning
function cloneSection(marker, items) {
  const idx = xml.indexOf(marker);
  if (idx === -1) { console.log(`  X Marker not found: ${marker}`); return; }
  let pStart = idx;
  while (pStart > 0) {
    pStart--;
    if (xml[pStart] === '<' && 
        xml.substring(pStart, pStart + 4) === '<w:p' &&
        (xml[pStart + 4] === ' ' || xml[pStart + 4] === '>')) {
      break;
    }
  }
  const pEnd = xml.indexOf("</w:p>", idx) + "</w:p>".length;
  const block = xml.substring(pStart, pEnd);
  if (!items || items.length === 0) {
    xml = xml.substring(0, pStart) + xml.substring(pEnd);
  } else {
    xml = xml.substring(0, pStart) + items.map(i => block.replace(marker, esc(i))).join("\n    ") + xml.substring(pEnd);
  }
  console.log(`  OK ${marker}: ${items.length} bullets cloned`);
}

cloneSection("{{ANNOUNCEMENT_ITEM}}", bulletin.announcements.additional);
cloneSection("{{EVENT_ITEM}}", bulletin.upcoming_events);
cloneSection("{{PRAYER_ITEM}}", bulletin.prayer_sharing.items);
cloneSection("{{MESSAGE_POINT}}", bulletin.message.points);

// Check for remaining placeholders
const remaining = xml.match(/\{\{[A-Z_]+\}\}/g);
if (remaining) {
  console.log(`\n  PROBLEM - Leftover placeholders: ${remaining.join(", ")}`);
} else {
  console.log(`\n  OK All placeholders filled`);
}

// Write modified XML back
fs.writeFileSync(xmlPath, xml);

// Repackage as .docx
const filename = `SundayBulletin_${bulletin.date.replace(/\./g, "-")}.docx`;
const outputPath = path.join(OUTPUT_DIR, filename);
if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

// Get the root of the extracted content (where [Content_Types].xml lives)
let zipSourceDir = TEMP_DIR;
if (!fs.existsSync(path.join(TEMP_DIR, "[Content_Types].xml"))) {
  const entries = fs.readdirSync(TEMP_DIR);
  for (const entry of entries) {
    if (fs.existsSync(path.join(TEMP_DIR, entry, "[Content_Types].xml"))) {
      zipSourceDir = path.join(TEMP_DIR, entry);
      break;
    }
  }
}

zipFolder(zipSourceDir, path.resolve(outputPath));

// Clean up
fs.rmSync(TEMP_DIR, { recursive: true, force: true });

const size = (fs.statSync(outputPath).size / 1024).toFixed(1);
console.log(`\n  DONE -> output/${filename} (${size} KB)\n`);
