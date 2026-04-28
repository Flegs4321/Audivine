/**
 * Pure functions that merge an editable transcript with timestamped speaker
 * tags into labeled, human-readable text. Lives outside any framework so it
 * can run on the server (member-summary endpoint) and the client (sermon
 * library preview).
 *
 * The transcript text is never mutated by this code — speaker labels are
 * applied at render time. The original transcript and the editable transcript
 * stay untouched in the database; tags live in their own table.
 */

export interface TranscriptChunk {
  text: string;
  timestampMs: number;
  isFinal?: boolean;
  speaker?: string;
  speakerTag?: boolean;
  source?: "whisper" | "whisper-live";
}

export type SpeakerRole = "sharing" | "sermon" | "general";

export interface SpeakerTag {
  id?: string;
  timestampMs: number;
  endTimestampMs?: number | null;
  speakerName: string;
  role: SpeakerRole;
  note?: string | null;
}

export interface SpeakerSegment {
  startMs: number;
  endMs: number; // exclusive end (Number.MAX_SAFE_INTEGER means "until end")
  speakerName: string;
  role: SpeakerRole;
}

export interface MergedTranscriptSection {
  role: SpeakerRole;
  speakerName: string;
  startMs: number;
  endMs: number;
  text: string;
}

export interface MergedTranscript {
  /** Full labeled transcript, e.g. "[00:01:23] John (sharing): ..." per line. */
  fullText: string;
  /** Sermon-only text concatenated (no speaker labels), with header "MESSAGE: <name>". */
  sermonText: string;
  /** Sharing-only text grouped by speaker, e.g. "John:\n...\n\nSarah:\n...". */
  sharingText: string;
  /** Per-section breakdown, useful for UI rendering. */
  sections: MergedTranscriptSection[];
  /** Resolved sermon speaker name if a sermon-role tag exists. */
  sermonSpeakerName: string | null;
}

const MAX_END = Number.MAX_SAFE_INTEGER;

/**
 * Convert raw tags into non-overlapping speaker segments. Each tag's segment
 * runs from its `timestampMs` to either:
 *   - `endTimestampMs` if explicitly set, OR
 *   - the next tag's `timestampMs`, OR
 *   - end-of-recording (Number.MAX_SAFE_INTEGER).
 */
export function buildSpeakerSegments(tags: SpeakerTag[]): SpeakerSegment[] {
  if (!tags.length) return [];
  const sorted = [...tags].sort((a, b) => a.timestampMs - b.timestampMs);
  const segments: SpeakerSegment[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i];
    const next = sorted[i + 1];
    const explicitEnd =
      typeof t.endTimestampMs === "number" && t.endTimestampMs > t.timestampMs
        ? t.endTimestampMs
        : null;
    const implicitEnd = next ? next.timestampMs : MAX_END;
    const endMs = explicitEnd != null ? Math.min(explicitEnd, implicitEnd) : implicitEnd;
    segments.push({
      startMs: t.timestampMs,
      endMs,
      speakerName: t.speakerName,
      role: t.role,
    });
  }

  return segments;
}

/** Find which speaker segment (if any) covers a given timestamp. */
export function segmentForTimestamp(
  segments: SpeakerSegment[],
  timestampMs: number
): SpeakerSegment | null {
  for (const s of segments) {
    if (timestampMs >= s.startMs && timestampMs < s.endMs) return s;
  }
  return null;
}

const pad2 = (n: number) => n.toString().padStart(2, "0");

export function formatTimestampMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor((ms || 0) / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${pad2(m)}:${pad2(s)}`;
  return `${m}:${pad2(s)}`;
}

interface TextChunkLite {
  text: string;
  timestampMs: number;
}

function normalizeChunks(chunks: TranscriptChunk[]): TextChunkLite[] {
  return chunks
    .filter((c) => c && typeof c.text === "string" && !c.speakerTag)
    .map((c) => ({ text: c.text.trim(), timestampMs: Math.max(0, Math.floor(c.timestampMs || 0)) }))
    .filter((c) => c.text.length > 0)
    .sort((a, b) => a.timestampMs - b.timestampMs);
}

/**
 * Merge an editable transcript with a list of speaker tags. Returns several
 * derived strings (full / sermon-only / sharing-only) so callers can pick
 * whichever shape suits them.
 */
export function mergeTranscriptWithTags(
  chunks: TranscriptChunk[],
  tags: SpeakerTag[]
): MergedTranscript {
  const text = normalizeChunks(chunks);
  const segments = buildSpeakerSegments(tags);

  const sermonTag = tags.find((t) => t.role === "sermon");
  const sermonSpeakerName = sermonTag?.speakerName?.trim() || null;

  // Bucket each text chunk into the segment that covers its timestamp. Chunks
  // outside any segment fall into a synthetic "untagged" group preserved
  // chronologically.
  type Bucket = { segment: SpeakerSegment | null; lines: TextChunkLite[] };
  const buckets: Bucket[] = [];
  let currentBucket: Bucket | null = null;

  for (const chunk of text) {
    const seg = segmentForTimestamp(segments, chunk.timestampMs);
    if (!currentBucket || currentBucket.segment !== seg) {
      currentBucket = { segment: seg, lines: [] };
      buckets.push(currentBucket);
    }
    currentBucket.lines.push(chunk);
  }

  // ---- Build the labeled full transcript -----------------------------------
  const fullLines: string[] = [];
  for (const bucket of buckets) {
    const seg = bucket.segment;
    if (seg) {
      const roleSuffix =
        seg.role === "sermon" ? " (sermon speaker)" : seg.role === "sharing" ? " (sharing)" : "";
      fullLines.push(`\n=== ${seg.speakerName}${roleSuffix} ===`);
    } else {
      fullLines.push(`\n=== Untagged ===`);
    }
    for (const line of bucket.lines) {
      const stamp = formatTimestampMs(line.timestampMs);
      const speakerPrefix = seg ? `${seg.speakerName}: ` : "";
      fullLines.push(`[${stamp}] ${speakerPrefix}${line.text}`);
    }
  }
  const fullText = fullLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  // ---- Build sections array ------------------------------------------------
  const sections: MergedTranscriptSection[] = buckets
    .filter((b) => b.segment != null)
    .map((b) => {
      const seg = b.segment as SpeakerSegment;
      const lineText = b.lines.map((l) => l.text).join(" ").trim();
      return {
        role: seg.role,
        speakerName: seg.speakerName,
        startMs: b.lines[0]?.timestampMs ?? seg.startMs,
        endMs: b.lines[b.lines.length - 1]?.timestampMs ?? seg.endMs,
        text: lineText,
      };
    });

  // ---- Sermon-only text ----------------------------------------------------
  const sermonSections = sections.filter((s) => s.role === "sermon");
  const sermonBody = sermonSections.map((s) => s.text).join("\n\n").trim();
  const sermonHeader = sermonSpeakerName ? `MESSAGE: ${sermonSpeakerName}` : "MESSAGE";
  const sermonText = sermonBody ? `${sermonHeader}\n\n${sermonBody}` : "";

  // ---- Sharing-only text grouped by speaker --------------------------------
  const sharingBySpeaker = new Map<string, string[]>();
  for (const s of sections) {
    if (s.role !== "sharing") continue;
    const prior = sharingBySpeaker.get(s.speakerName) || [];
    prior.push(s.text);
    sharingBySpeaker.set(s.speakerName, prior);
  }
  const sharingChunks: string[] = [];
  for (const [speaker, lines] of sharingBySpeaker.entries()) {
    sharingChunks.push(`${speaker}:\n${lines.join("\n").trim()}`);
  }
  const sharingText = sharingChunks.length > 0 ? `SHARING TIME\n\n${sharingChunks.join("\n\n")}` : "";

  return {
    fullText,
    sermonText,
    sharingText,
    sections,
    sermonSpeakerName,
  };
}
