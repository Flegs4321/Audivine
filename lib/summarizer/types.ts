/**
 * Type definitions for summarization
 */

export interface SectionSummary {
  /** Short summary (2-4 sentences) */
  summary: string;
  /** Bullet points (only for Sermon sections) */
  bullets?: string[];
}

export interface SummarizationProvider {
  /**
   * Generate summary for a section
   */
  summarize(text: string, label: "Announcements" | "Sharing" | "Sermon"): Promise<SectionSummary>;
}

