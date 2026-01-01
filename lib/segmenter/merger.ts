/**
 * Merge consecutive classified segments into final sections
 */

import type { ClassifiedSegment, FinalSection, IgnoredSegment, SegmentationConfig } from "./types";

/**
 * Merge consecutive segments of the same type
 */
export function mergeSegments(
  classified: ClassifiedSegment[],
  config: SegmentationConfig
): {
  sections: FinalSection[];
  ignored: IgnoredSegment[];
} {
  if (classified.length === 0) {
    return { sections: [], ignored: [] };
  }

  const sections: FinalSection[] = [];
  const ignored: IgnoredSegment[] = [];

  // Filter out "Other" segments (these become "ignored")
  const validSegments = classified.filter((s) => s.label !== "Other");
  const otherSegments = classified.filter((s) => s.label === "Other");

  // Convert "Other" segments to ignored
  for (const seg of otherSegments) {
    ignored.push({
      startMs: seg.startMs,
      endMs: seg.endMs,
      reason: "other",
    });
  }

  if (validSegments.length === 0) {
    return { sections, ignored };
  }

  // Merge consecutive segments of same label
  let currentSection: {
    label: FinalSection["label"];
    startMs: number;
    endMs: number;
    texts: string[];
    confidences: number[];
  } | null = null;

  for (const seg of validSegments) {
    if (!currentSection) {
      // Start new section
      currentSection = {
        label: seg.label,
        startMs: seg.startMs,
        endMs: seg.endMs,
        texts: [seg.text],
        confidences: [seg.confidence],
      };
      continue;
    }

    // Check if we should merge
    const gap = seg.startMs - currentSection.endMs;
    const sameLabel = seg.label === currentSection.label;
    const smallGap = gap <= config.mergeGapThresholdMs;

    if (sameLabel && smallGap) {
      // Merge into current section
      currentSection.endMs = seg.endMs;
      currentSection.texts.push(seg.text);
      currentSection.confidences.push(seg.confidence);
    } else {
      // Save current section and start new one
      const avgConfidence = currentSection.confidences.reduce((a, b) => a + b, 0) / currentSection.confidences.length;
      sections.push({
        label: currentSection.label,
        startMs: currentSection.startMs,
        endMs: currentSection.endMs,
        text: currentSection.texts.join(" ").trim(),
      });

      currentSection = {
        label: seg.label,
        startMs: seg.startMs,
        endMs: seg.endMs,
        texts: [seg.text],
        confidences: [seg.confidence],
      };
    }
  }

  // Save final section
  if (currentSection) {
    sections.push({
      label: currentSection.label,
      startMs: currentSection.startMs,
      endMs: currentSection.endMs,
      text: currentSection.texts.join(" ").trim(),
    });
  }

  return { sections, ignored };
}

/**
 * Sort sections by start time and fill gaps with ignored segments
 */
export function finalizeSections(
  sections: FinalSection[],
  ignored: IgnoredSegment[],
  totalDurationMs: number
): {
  sections: FinalSection[];
  ignored: IgnoredSegment[];
} {
  // Sort by start time
  const sortedSections = [...sections].sort((a, b) => a.startMs - b.startMs);

  // Fill gaps with ignored segments
  const allIgnored: IgnoredSegment[] = [...ignored];

  // Check for gaps between sections
  for (let i = 0; i < sortedSections.length - 1; i++) {
    const current = sortedSections[i];
    const next = sortedSections[i + 1];
    const gap = next.startMs - current.endMs;

    if (gap > 1000) {
      // Gap larger than 1 second, add as ignored
      allIgnored.push({
        startMs: current.endMs,
        endMs: next.startMs,
        reason: "silence",
      });
    }
  }

  // Check for gap at start
  if (sortedSections.length > 0 && sortedSections[0].startMs > 1000) {
    allIgnored.push({
      startMs: 0,
      endMs: sortedSections[0].startMs,
      reason: "silence",
    });
  }

  // Check for gap at end
  if (sortedSections.length > 0) {
    const last = sortedSections[sortedSections.length - 1];
    if (last.endMs < totalDurationMs - 1000) {
      allIgnored.push({
        startMs: last.endMs,
        endMs: totalDurationMs,
        reason: "silence",
      });
    }
  }

  return {
    sections: sortedSections,
    ignored: allIgnored.sort((a, b) => a.startMs - b.startMs),
  };
}

