/**
 * Heuristic-based transcript chunking into candidate segments
 */

import type { TranscriptChunk, CandidateSegment, SegmentationConfig } from "./types";

/**
 * Break transcript into candidate segments using heuristics
 */
export function chunkTranscript(
  chunks: TranscriptChunk[],
  config: SegmentationConfig
): CandidateSegment[] {
  if (chunks.length === 0) return [];

  const segments: CandidateSegment[] = [];
  let currentSegment: {
    startMs: number;
    endMs: number;
    texts: string[];
    keywords: Set<string>;
  } | null = null;

  // Normalize keywords for matching (lowercase)
  const normalizedKeywords: Record<string, string[]> = {
    announcements: config.keywords.announcements.map((k) => k.toLowerCase()),
    sharing: config.keywords.sharing.map((k) => k.toLowerCase()),
    sermon: config.keywords.sermon.map((k) => k.toLowerCase()),
  };

  // Helper to find keywords in text
  const findKeywords = (text: string): string[] => {
    const found: string[] = [];
    const lowerText = text.toLowerCase();
    for (const [category, keywords] of Object.entries(normalizedKeywords)) {
      for (const keyword of keywords) {
        if (lowerText.includes(keyword)) {
          found.push(keyword);
        }
      }
    }
    return found;
  };

  // Helper to calculate gap between chunks
  const getGapMs = (prevChunk: TranscriptChunk, currentChunk: TranscriptChunk): number => {
    // Rough estimate: assume each chunk takes ~1 second per 10 words
    const wordsInPrev = prevChunk.text.split(/\s+/).length;
    const estimatedPrevDuration = Math.max(1000, (wordsInPrev / 10) * 1000);
    const estimatedPrevEnd = prevChunk.timestampMs + estimatedPrevDuration;
    return currentChunk.timestampMs - estimatedPrevEnd;
  };

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const prevChunk = i > 0 ? chunks[i - 1] : null;

    // Initialize first segment
    if (!currentSegment) {
      const keywords = findKeywords(chunk.text);
      currentSegment = {
        startMs: chunk.timestampMs,
        endMs: chunk.timestampMs,
        texts: [chunk.text],
        keywords: new Set(keywords),
      };
      continue;
    }

    // Check for breaks
    let shouldBreak = false;
    let breakReason: CandidateSegment["breakReason"] = undefined;

    // 1. Check for silence gap
    if (prevChunk) {
      const gapMs = getGapMs(prevChunk, chunk);
      if (gapMs > config.silenceThresholdMs) {
        shouldBreak = true;
        breakReason = "silence";
      }
    }

    // 2. Check for keywords (indicates section transition)
    const keywords = findKeywords(chunk.text);
    if (keywords.length > 0) {
      // If new keywords appear that don't match current segment, break
      const currentSegmentDuration = chunk.timestampMs - currentSegment.startMs;
      if (currentSegmentDuration > config.minSegmentDurationMs) {
        shouldBreak = true;
        breakReason = "keyword";
      }
      // Add keywords to current segment
      keywords.forEach((k) => currentSegment!.keywords.add(k));
    }

    // 3. Check for max duration (force break)
    const segmentDuration = chunk.timestampMs - currentSegment.startMs;
    if (segmentDuration >= config.maxSegmentDurationMs) {
      shouldBreak = true;
      breakReason = "duration";
    }

    // Add chunk to current segment
    currentSegment.texts.push(chunk.text);
    currentSegment.endMs = chunk.timestampMs;

    // Break if needed
    if (shouldBreak && segmentDuration >= config.minSegmentDurationMs) {
      // Save current segment
      segments.push({
        startMs: currentSegment.startMs,
        endMs: currentSegment.endMs,
        text: currentSegment.texts.join(" ").trim(),
        breakReason,
        keywords: Array.from(currentSegment.keywords),
      });

      // Start new segment
      currentSegment = {
        startMs: chunk.timestampMs,
        endMs: chunk.timestampMs,
        texts: [chunk.text],
        keywords: new Set(keywords),
      };
    }
  }

  // Save final segment if it meets minimum duration
  if (currentSegment) {
    const segmentDuration = currentSegment.endMs - currentSegment.startMs;
    if (segmentDuration >= config.minSegmentDurationMs) {
      segments.push({
        startMs: currentSegment.startMs,
        endMs: currentSegment.endMs,
        text: currentSegment.texts.join(" ").trim(),
        keywords: Array.from(currentSegment.keywords),
      });
    }
  }

  return segments;
}

