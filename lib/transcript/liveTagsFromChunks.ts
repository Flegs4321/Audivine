/**
 * Derives DB-ready speaker tag rows from live recorder transcript chunks.
 * Matches marker strings emitted by app/recorder/page.tsx handleMemberSelect /
 * handleSermonSpeakerSelect.
 */

import type { SpeakerRole } from "./merge";

export interface DerivedLiveSpeakerTagRow {
  timestamp_ms: number;
  speaker_name: string;
  role: SpeakerRole;
}

/** Parses recorder marker lines: "Name - sharing:" / "Name - sermon speaker:" */
export function parseSpeakerTagMarkerText(text: string): {
  speakerName: string;
  role: Exclude<SpeakerRole, "general">;
} | null {
  const s = text.trim();
  const sermon = s.match(/^(.+?)\s+-\s+sermon speaker:\s*$/i);
  if (sermon) {
    const speakerName = sermon[1].trim();
    if (!speakerName) return null;
    return { speakerName, role: "sermon" };
  }
  const sharing = s.match(/^(.+?)\s+-\s+sharing:\s*$/i);
  if (sharing) {
    const speakerName = sharing[1].trim();
    if (!speakerName) return null;
    return { speakerName, role: "sharing" };
  }
  return null;
}

export function deriveLiveSpeakerTagsFromChunks(
  chunks: Array<{ text?: string; timestampMs?: number; speakerTag?: boolean }>
): DerivedLiveSpeakerTagRow[] {
  const sorted = [...chunks].filter(Boolean).sort(
    (a, b) => (Number(a.timestampMs) || 0) - (Number(b.timestampMs) || 0)
  );
  const out: DerivedLiveSpeakerTagRow[] = [];
  for (const c of sorted) {
    if (!c || c.speakerTag !== true || typeof c.text !== "string") continue;
    const parsed = parseSpeakerTagMarkerText(c.text);
    if (!parsed) continue;
    out.push({
      timestamp_ms: Math.max(0, Math.floor(Number(c.timestampMs) || 0)),
      speaker_name: parsed.speakerName,
      role: parsed.role,
    });
  }
  return out;
}
