/**
 * CLI: build Sonlight bulletin .docx from a text file (same mapping as the app).
 * Usage: npx tsx scripts/bulletin-from-summary.ts <summary.txt> [output.docx]
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import path from "path";
import { memberSummaryToBulletinJson } from "../lib/bulletin/member-summary-to-bulletin-json";
import { buildBulletinDocxBuffer } from "../lib/bulletin/build-bulletin-docx";

const inPath = process.argv[2];
const outArg = process.argv[3];

if (!inPath || !existsSync(inPath)) {
  console.error("Usage: npx tsx scripts/bulletin-from-summary.ts <summary.txt> [output.docx]");
  process.exit(1);
}

const summary = readFileSync(inPath, "utf-8");
const bulletin = memberSummaryToBulletinJson(summary);
const buf = buildBulletinDocxBuffer(bulletin);

const defaultOut = path.join(
  process.cwd(),
  "bulletin-final",
  "output",
  `SundayBulletin_${(bulletin.date || "undated").replace(/\./g, "-")}.docx`
);
const outPath = outArg ? path.resolve(outArg) : defaultOut;

writeFileSync(outPath, buf);
console.log("Wrote:", outPath);
