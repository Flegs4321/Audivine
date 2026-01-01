/**
 * Main segmentation pipeline
 */

import { chunkTranscript } from "./chunker";
import { createClassificationProvider } from "./classifier";
import { mergeSegments, finalizeSections } from "./merger";
import type {
  TranscriptChunk,
  SegmentationResult,
  SegmentationConfig,
  DEFAULT_CONFIG,
} from "./types";
import { DEFAULT_CONFIG as defaultConfig } from "./types";

/**
 * Run full segmentation pipeline
 */
export async function segmentTranscript(
  chunks: TranscriptChunk[],
  totalDurationMs: number,
  config: SegmentationConfig = defaultConfig
): Promise<SegmentationResult> {
  // Step 1: Chunk transcript into candidate segments
  const candidates = chunkTranscript(chunks, config);

  if (candidates.length === 0) {
    return {
      sections: [],
      ignored: [],
      candidates: [],
      classified: [],
    };
  }

  // Step 2: Classify each segment
  const classifier = createClassificationProvider();
  const classifications = await classifier.classifyBatch(candidates);

  const classified = candidates.map((candidate, i) => ({
    ...candidate,
    label: classifications[i].label,
    confidence: classifications[i].confidence,
  }));

  // Step 3: Merge consecutive segments of same type
  const { sections, ignored } = mergeSegments(classified, config);

  // Step 4: Finalize (sort, fill gaps)
  const finalized = finalizeSections(sections, ignored, totalDurationMs);

  return {
    ...finalized,
    candidates,
    classified,
  };
}

// Re-export types and config
export * from "./types";
export { DEFAULT_CONFIG } from "./types";

