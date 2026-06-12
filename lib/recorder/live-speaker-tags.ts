export type LiveSpeakerRole = "sharing" | "sermon";

export interface LiveSpeakerTag {
  timestampMs: number;
  endTimestampMs: number | null;
  speakerName: string;
  role: LiveSpeakerRole;
}

export const LIVE_SPEAKER_TAG_GRACE_MS = 3000;

export function addLiveSpeakerTag(
  tags: LiveSpeakerTag[],
  params: {
    speakerName: string;
    role: LiveSpeakerRole;
    currentMs: number;
    graceMs?: number;
  }
): LiveSpeakerTag[] {
  const speakerName = params.speakerName.trim();
  if (!speakerName) return tags;

  const graceMs = params.graceMs ?? LIVE_SPEAKER_TAG_GRACE_MS;
  const startMs = Math.max(0, Math.floor(params.currentMs - graceMs));
  const next = tags.map((tag, index) =>
    index === tags.length - 1 && tag.endTimestampMs == null
      ? { ...tag, endTimestampMs: Math.max(tag.timestampMs, startMs) }
      : tag
  );

  next.push({
    timestampMs: startMs,
    endTimestampMs: null,
    speakerName,
    role: params.role,
  });

  return next;
}

export function endActiveLiveSpeakerTag(
  tags: LiveSpeakerTag[],
  currentMs: number
): LiveSpeakerTag[] {
  if (tags.length === 0) return tags;
  return tags.map((tag, index) =>
    index === tags.length - 1 && tag.endTimestampMs == null
      ? { ...tag, endTimestampMs: Math.max(tag.timestampMs, Math.floor(currentMs)) }
      : tag
  );
}

export function undoLastLiveSpeakerTag(tags: LiveSpeakerTag[]): {
  tags: LiveSpeakerTag[];
  currentSpeaker: string | null;
} {
  if (tags.length === 0) return { tags, currentSpeaker: null };
  const next = tags.slice(0, -1);
  const priorOpenTag = [...next].reverse().find((tag) => tag.endTimestampMs == null);
  const priorTag = priorOpenTag ?? next[next.length - 1] ?? null;
  return {
    tags: next,
    currentSpeaker: priorTag?.speakerName ?? null,
  };
}

export function shiftLiveSpeakerTagsForSegment(
  tags: LiveSpeakerTag[],
  segmentStartMs: number,
  segmentEndMs: number
): LiveSpeakerTag[] {
  return tags
    .filter((tag) => {
      const tagEnd = tag.endTimestampMs ?? segmentEndMs;
      return tag.timestampMs < segmentEndMs && tagEnd > segmentStartMs;
    })
    .map((tag) => ({
      ...tag,
      timestampMs: Math.max(0, tag.timestampMs - segmentStartMs),
      endTimestampMs:
        tag.endTimestampMs == null
          ? null
          : Math.max(0, Math.min(tag.endTimestampMs, segmentEndMs) - segmentStartMs),
    }));
}
