/**
 * Summarization pipeline
 */

import { createSummarizationProvider } from "./summarize";
import type { FinalSection } from "../segmenter/types";
import type { SectionSummary } from "./types";

/**
 * Generate summaries for all sections
 */
export async function summarizeSections(
  sections: FinalSection[]
): Promise<FinalSection[]> {
  const summarizer = createSummarizationProvider();

  // Process sections in parallel for efficiency
  const summaries = await Promise.all(
    sections.map((section) =>
      summarizer.summarize(section.text, section.label).catch((error) => {
        console.error(`Error summarizing section ${section.label}:`, error);
        return {
          summary: "Summary generation failed.",
          bullets: section.label === "Sermon" ? [] : undefined,
        } as SectionSummary;
      })
    )
  );

  // Combine sections with summaries
  return sections.map((section, i) => ({
    ...section,
    summary: summaries[i].summary,
    bullets: summaries[i].bullets,
  }));
}

// Re-export types
export * from "./types";

