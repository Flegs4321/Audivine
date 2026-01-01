/**
 * Type definitions for automatic section detection
 */

export type SectionLabel = "Announcements" | "Sharing" | "Sermon" | "Other";

export interface TranscriptChunk {
  text: string;
  timestampMs: number;
  isFinal?: boolean;
}

export interface CandidateSegment {
  /** Start timestamp in milliseconds */
  startMs: number;
  /** End timestamp in milliseconds */
  endMs: number;
  /** Full text of the segment */
  text: string;
  /** Detected break reason */
  breakReason?: "silence" | "keyword" | "duration" | "topic_shift";
  /** Keywords found in this segment */
  keywords?: string[];
}

export interface ClassifiedSegment {
  /** Section label */
  label: SectionLabel;
  /** Confidence score (0-1) */
  confidence: number;
  /** Start timestamp in milliseconds */
  startMs: number;
  /** End timestamp in milliseconds */
  endMs: number;
  /** Full text of the segment */
  text: string;
}

export interface FinalSection {
  /** Section label */
  label: SectionLabel;
  /** Start timestamp in milliseconds */
  startMs: number;
  /** End timestamp in milliseconds */
  endMs: number;
  /** Full text of the section (merged segments) */
  text: string;
  /** Short summary (2-4 sentences) */
  summary?: string;
  /** Bullet points (only for Sermon) */
  bullets?: string[];
}

export interface IgnoredSegment {
  /** Start timestamp in milliseconds */
  startMs: number;
  /** End timestamp in milliseconds */
  endMs: number;
  /** Reason for ignoring */
  reason: "music" | "prayer" | "silence" | "other";
}

export interface SegmentationResult {
  /** Final labeled sections */
  sections: FinalSection[];
  /** Ignored segments */
  ignored: IgnoredSegment[];
  /** Raw candidate segments before merging */
  candidates?: CandidateSegment[];
  /** Classification results before merging */
  classified?: ClassifiedSegment[];
}

export interface SegmentationConfig {
  /** Minimum segment duration in milliseconds */
  minSegmentDurationMs: number;
  /** Maximum segment duration in milliseconds (force break) */
  maxSegmentDurationMs: number;
  /** Silence gap threshold in milliseconds (break on longer silence) */
  silenceThresholdMs: number;
  /** Maximum gap between segments to merge (milliseconds) */
  mergeGapThresholdMs: number;
  /** Keywords that indicate section transitions */
  keywords: {
    announcements: string[];
    sharing: string[];
    sermon: string[];
  };
}

export const DEFAULT_CONFIG: SegmentationConfig = {
  minSegmentDurationMs: 30000, // 30 seconds
  maxSegmentDurationMs: 120000, // 2 minutes
  silenceThresholdMs: 2000, // 2 seconds
  mergeGapThresholdMs: 5000, // 5 seconds
  keywords: {
    announcements: [
      "announcement",
      "announcements",
      "upcoming",
      "event",
      "reminder",
      "this week",
      "next week",
      "don't forget",
      "please join us",
    ],
    sharing: [
      "sharing",
      "testimony",
      "testimonies",
      "witness",
      "share",
      "praise report",
      "prayer request",
      "thanksgiving",
    ],
    sermon: [
      "sermon",
      "message",
      "teaching",
      "scripture",
      "verse",
      "bible",
      "today we",
      "let's turn to",
      "open your bibles",
    ],
  },
};

