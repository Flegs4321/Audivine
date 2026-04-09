#!/usr/bin/env node

/**
 * Sonlight Chapel Bulletin Generator
 *
 * Usage:
 *   node generate.js                    (latest transcript from Supabase; see env below)
 *   node generate.js <recording-uuid>   (that recording's transcript_chunks)
 *   node generate.js --id=<uuid>        (same)
 *   node generate.js notes.txt          (reads notes from a file instead)
 *   node generate.js -h
 *
 * Output:
 *   Creates a .docx file in the /output folder
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Load repo or local env (no extra deps). Does not override existing process.env.
function loadEnvFromFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFromFile(path.join(__dirname, "..", ".env.local"));
loadEnvFromFile(path.join(__dirname, ".env"));

const { resolveBulletinTemplateDocx } = require("./resolve-template-path");

// ============================================================
// CONFIGURATION
// ============================================================
const API_KEY = process.env.ANTHROPIC_API_KEY || "";

const TEMPLATE_PATH = resolveBulletinTemplateDocx(path.join(__dirname, "template"));
const OUTPUT_DIR = path.join(__dirname, "output");
const TEMP_DIR = path.join(__dirname, ".temp");

const isWindows = process.platform === "win32";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(s) {
  return typeof s === "string" && UUID_RE.test(s.trim());
}

function getSupabaseRestConfig() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) {
    throw new Error(
      "Missing Supabase config. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY " +
        "(e.g. in the repo root .env.local). This script uses the service role only on your machine—do not commit keys."
    );
  }
  return { url, key };
}

function supabaseHeaders(key) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

function parseCli(argv) {
  let filePath = null;
  let recordingId = null;
  let showHelp = false;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") {
      showHelp = true;
      continue;
    }
    if (a.startsWith("--id=")) {
      recordingId = a.slice("--id=".length).trim() || null;
      continue;
    }
    if (a.startsWith("--recording=")) {
      recordingId = a.slice("--recording=".length).trim() || null;
      continue;
    }
    if (a.startsWith("-")) continue;
    if (isUuid(a)) {
      if (!recordingId) recordingId = a.trim();
    } else if (!filePath) {
      filePath = a;
    }
  }
  return { filePath, recordingId, showHelp };
}

function transcriptChunksToText(chunks) {
  let fullText = "";
  if (Array.isArray(chunks)) {
    for (const chunk of chunks) {
      if (typeof chunk === "string") {
        fullText += chunk + "\n";
      } else if (chunk && typeof chunk === "object") {
        fullText +=
          (chunk.text || chunk.content || chunk.transcript || JSON.stringify(chunk)) + "\n";
      }
    }
  }
  return fullText;
}

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

function findDocumentXml(tempDir) {
  let xmlPath = path.join(tempDir, "word", "document.xml");
  if (fs.existsSync(xmlPath)) return xmlPath;
  const entries = fs.readdirSync(tempDir);
  for (const entry of entries) {
    const tryPath = path.join(tempDir, entry, "word", "document.xml");
    if (fs.existsSync(tryPath)) return tryPath;
  }
  return null;
}

function findZipRoot(tempDir) {
  if (fs.existsSync(path.join(tempDir, "[Content_Types].xml"))) return tempDir;
  const entries = fs.readdirSync(tempDir);
  for (const entry of entries) {
    if (fs.existsSync(path.join(tempDir, entry, "[Content_Types].xml"))) {
      return path.join(tempDir, entry);
    }
  }
  return tempDir;
}

// ============================================================
// SUPABASE: Pull transcript (latest or by recording id)
// ============================================================
async function fetchTranscriptForRecording(recording, sourceLabel) {
  console.log(`  OK ${sourceLabel}: ${recording.title || recording.id}`);
  console.log(`     Created: ${new Date(recording.created_at).toLocaleDateString()}`);

  const fullText = transcriptChunksToText(recording.transcript_chunks);
  if (!fullText.trim()) {
    throw new Error("Transcript chunks are empty");
  }
  console.log(`     Transcript length: ${fullText.length} characters`);
  return fullText;
}

async function getTranscriptByRecordingId(recordingId) {
  if (!isUuid(recordingId)) {
    throw new Error(`Invalid recording id (expected UUID): ${recordingId}`);
  }
  const { url, key } = getSupabaseRestConfig();
  console.log("  ... Connecting to Supabase (recording by id)...");

  const restUrl = `${url}/rest/v1/recordings?id=eq.${encodeURIComponent(
    recordingId
  )}&select=id,title,created_at,transcript_chunks`;

  const resp = await fetch(restUrl, { headers: supabaseHeaders(key) });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Supabase error: ${resp.status} - ${err}`);
  }

  const rows = await resp.json();
  if (!rows || rows.length === 0) {
    throw new Error(`No recording found for id: ${recordingId}`);
  }

  return fetchTranscriptForRecording(rows[0], "Recording");
}

async function getLatestTranscript() {
  const { url, key } = getSupabaseRestConfig();
  console.log("  ... Connecting to Supabase (latest transcript)...");

  let restUrl = `${url}/rest/v1/recordings?select=id,title,created_at,transcript_chunks&transcript_chunks=not.eq.[]&order=created_at.desc&limit=1`;

  const userId = (process.env.SUPABASE_USER_ID || "").trim();
  if (userId) {
    restUrl += `&user_id=eq.${encodeURIComponent(userId)}`;
  }

  const resp = await fetch(restUrl, { headers: supabaseHeaders(key) });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Supabase error: ${resp.status} - ${err}`);
  }

  const rows = await resp.json();

  if (!rows || rows.length === 0) {
    const hint = userId
      ? "No matching recordings with transcripts for this user."
      : "No recordings with transcripts found. Set SUPABASE_USER_ID in .env.local to scope to your user, or pass a recording UUID.";
    throw new Error(`Supabase: ${hint}`);
  }

  return fetchTranscriptForRecording(rows[0], "Latest recording");
}

// ============================================================
// CLAUDE AI
// ============================================================
const SYSTEM_PROMPT = `You are a church bulletin organizer for Sonlight Chapel. You will receive a raw transcript from a Sunday church service. Extract and organize the relevant information into a structured JSON format. Return ONLY valid JSON with no markdown backticks or extra text.

The JSON must have this exact structure:
{
  "date": "YYYY.M.DD",
  "announcements": {
    "this_evening": "value or No Service",
    "wednesday_eve": "value or Small Groups",
    "next_sunday_devotions": "Name",
    "next_sunday_chair_set_up": "Name",
    "next_sunday_host_hostess": "Names",
    "additional": ["any other announcements as separate strings"]
  },
  "upcoming_events": ["event 1", "event 2"],
  "prayer_sharing": {
    "in_service": "Names and locations of those serving elsewhere",
    "items": ["Name - prayer/praise item"]
  },
  "message": {
    "speaker": "Name",
    "title": "Sermon Title",
    "points": ["key point or scripture reference from the sermon"]
  }
}

Rules:
- Extract ALL relevant information from the transcript
- Use en-dashes (\u2013) between items, not hyphens
- Include scripture references as mentioned in the sermon
- Keep the person's name at the start of prayer items
- For the message section, extract the main points, scripture references, and key themes
- If information for a field isn't clearly stated, use "N/A"
- The additional array should only contain extra announcements beyond the standard fields. If none, use empty array []
- Return ONLY the JSON object, nothing else`;

async function callClaude(notes) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Here is the raw transcript from this week's Sunday service at Sonlight Chapel. Please extract and organize all bulletin information from it:\n\n${notes}` }],
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error: ${resp.status}`);
  }

  const data = await resp.json();
  const text = data.content.map((i) => (i.type === "text" ? i.text : "")).join("");
  const clean = text.replace(/```json|```/g, "").trim();

  try {
    return JSON.parse(clean);
  } catch (e) {
    throw new Error("AI returned invalid JSON. Try again.");
  }
}

// ============================================================
// BUILD .DOCX
// ============================================================
function buildDocx(bulletin, outputPath) {
  if (fs.existsSync(TEMP_DIR)) fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  unzipFile(TEMPLATE_PATH, TEMP_DIR);

  const xmlPath = findDocumentXml(TEMP_DIR);
  if (!xmlPath) throw new Error("Could not find word/document.xml in template");

  let xml = fs.readFileSync(xmlPath, "utf-8");

  function esc(str) {
    return (str || "N/A").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }

  /** Word splits {{TAG}} across <w:t> runs — allow XML between characters. */
  function escapeRegexChar(c) {
    return c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function splitPlaceholderRegex(placeholder, global) {
    const chars = [...placeholder].map((c) => escapeRegexChar(c));
    return new RegExp(chars.join("(?:<[^>]+>)*"), global ? "g" : "");
  }
  function findSplitMarkerIndex(xmlStr, marker) {
    if (xmlStr.includes(marker)) return xmlStr.indexOf(marker);
    const m = splitPlaceholderRegex(marker, false).exec(xmlStr);
    return m ? m.index : -1;
  }
  function replaceSplitPlaceholder(xmlStr, placeholder, replacementEscaped) {
    if (xmlStr.includes(placeholder)) {
      return xmlStr.split(placeholder).join(replacementEscaped);
    }
    return xmlStr.replace(splitPlaceholderRegex(placeholder, true), replacementEscaped);
  }

  function rep(token, val) {
    xml = replaceSplitPlaceholder(xml, token, esc(val));
  }

  const SHARING_LINE_ARROWHEAD = "\u27A4";

  function cleanMarkdownArtifactsForPrayer(text) {
    let s = (text || "").trim();
    for (let i = 0; i < 10; i++) {
      const next = s
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\*([^*\n]+)\*/g, "$1")
        .replace(/([A-Za-z])\*\*(?=\s|$|[,–—.!?:;])/gu, "$1")
        .replace(/\*\*(?=\s|[,–—.!?:;]|$)/gu, "")
        .replace(/^\*\*\s*/g, "")
        .replace(/\s*\*\*$/gm, "")
        .replace(/\*{2,}/g, "")
        .trim();
      if (next === s) break;
      s = next;
    }
    return s;
  }

  function normalizeSharingTypography(text) {
    let s = (text || "").trim();
    if (!s) return s;
    const NAME_SEP = " - ";
    s = s.replace(
      /^([A-Z][A-Za-z.'-]*(?:\s+(?:&\s+)?[A-Z][A-Za-z.'-]*){0,5})(?:\s*\([^)]{1,40}\))?\s*[-–—]\s+/u,
      (_m, name) => `${name}${NAME_SEP}`
    );
    s = s.replace(/\s+[\u2013\u2014\-]\s+/g, NAME_SEP);
    s = s.replace(/\s+([,;:.!?])/g, "$1");
    s = s.replace(/\s+/g, " ").trim();
    if (!/[.!?]["')\]]*$/u.test(s)) {
      s = `${s}.`;
    }
    return s;
  }

  function formatPrayerItemForDocx(item, index) {
    let t = (item || "")
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

  function cloneSection(marker, items, formatItem) {
    const idx = findSplitMarkerIndex(xml, marker);
    if (idx === -1) return;
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
    const templateBlock = xml.substring(pStart, pEnd);

    if (!items || items.length === 0) {
      xml = xml.substring(0, pStart) + xml.substring(pEnd);
      return;
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
    xml = xml.substring(0, pStart) + clones + xml.substring(pEnd);
  }

  cloneSection("{{ANNOUNCEMENT_ITEM}}", bulletin.announcements?.additional || []);
  cloneSection("{{EVENT_ITEM}}", bulletin.upcoming_events || []);
  const prayerItems = (bulletin.prayer_sharing?.items || []).map((s) =>
    (s || "").replace(/^\^+\s*/, "").replace(/^>\s*/, "").replace(/^[➤•]\s*/gu, "").trim()
  );
  cloneSection("{{PRAYER_ITEM}}", prayerItems, formatPrayerItemForDocx);
  cloneSection("{{MESSAGE_POINT}}", bulletin.message?.points || []);

  fs.writeFileSync(xmlPath, xml);

  if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  const zipRoot = findZipRoot(TEMP_DIR);
  zipFolder(zipRoot, path.resolve(outputPath));

  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
}

// ============================================================
// MAIN
// ============================================================
function printHelp() {
  console.log(`
  Usage:
    node generate.js
                              Latest recording with non-empty transcript_chunks (Supabase).
    node generate.js <recording-uuid>
    node generate.js --id=<uuid>
    node generate.js --recording=<uuid>
                              Use that recording's transcript.
    node generate.js notes.txt
                              Read notes from a file.

  Environment (repo root .env.local is loaded automatically):
    ANTHROPIC_API_KEY           Required.
    NEXT_PUBLIC_SUPABASE_URL    Required for Supabase modes.
    SUPABASE_SERVICE_ROLE_KEY  Required for Supabase modes (local CLI only; never commit).
    SUPABASE_USER_ID            Optional: limit "latest" to this user's rows.

  `);
}

async function main() {
  console.log("\n  === Sonlight Chapel Bulletin Generator ===\n");

  const cli = parseCli(process.argv);
  if (cli.showHelp) {
    printHelp();
    process.exit(0);
  }

  if (!API_KEY) {
    console.log("  ERROR: ANTHROPIC_API_KEY not set.");
    console.log("  Add it to the repo root .env.local or set the variable in your shell.\n");
    process.exit(1);
  }

  if (!fs.existsSync(TEMPLATE_PATH)) {
    console.log("  ERROR: Template not found at template/template.docx\n");
    process.exit(1);
  }

  if (cli.recordingId && !isUuid(cli.recordingId)) {
    console.log(`  ERROR: Invalid recording id (expected UUID): ${cli.recordingId}\n`);
    process.exit(1);
  }

  let notes;
  if (cli.recordingId) {
    notes = await getTranscriptByRecordingId(cli.recordingId);
  } else if (cli.filePath) {
    const filePath = path.resolve(cli.filePath);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      console.log(`  ERROR: File not found: ${filePath}\n`);
      process.exit(1);
    }
    notes = fs.readFileSync(filePath, "utf-8");
    console.log(`  OK Read notes from: ${path.basename(filePath)}`);
  } else {
    notes = await getLatestTranscript();
  }

  if (!notes.trim()) {
    console.log("  ERROR: No notes/transcript found\n");
    process.exit(1);
  }

  console.log("\n  ... Sending transcript to Claude AI...");
  const bulletin = await callClaude(notes);
  console.log("  OK Bulletin content organized");
  console.log(`     Date: ${bulletin.date}`);
  console.log(`     Events: ${bulletin.upcoming_events?.length || 0}`);
  console.log(`     Prayer items: ${bulletin.prayer_sharing?.items?.length || 0}`);
  console.log(`     Message: ${bulletin.message?.speaker} - ${bulletin.message?.title}`);
  console.log(`     Message points: ${bulletin.message?.points?.length || 0}`);

  console.log("\n  ... Building .docx from your template...");
  const filename = `SundayBulletin_${(bulletin.date || "undated").replace(/\./g, "-")}.docx`;
  const outputPath = path.join(OUTPUT_DIR, filename);
  buildDocx(bulletin, outputPath);

  const size = (fs.statSync(outputPath).size / 1024).toFixed(1);
  console.log("  OK Bulletin created!");
  console.log(`\n  -> ${outputPath} (${size} KB)\n`);
}

main().catch((err) => {
  console.log(`\n  ERROR: ${err.message}\n`);
  process.exit(1);
});
