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

  // Filter out "Other" sections and only summarize Announcements, Sharing, and Sermon
  const sectionsToSummarize = sections.filter(
    (section) => section.label !== "Other"
  ) as Array<FinalSection & { label: "Announcements" | "Sharing" | "Sermon" }>;

  // Process sections in parallel for efficiency
  const summaries = await Promise.all(
    sectionsToSummarize.map((section) =>
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
  const summarizedSections = sectionsToSummarize.map((section, i) => ({
    ...section,
    summary: summaries[i].summary,
    bullets: summaries[i].bullets,
  }));

  // Return all sections (including "Other" sections without summaries)
  const otherSections = sections.filter((section) => section.label === "Other");
  return [...summarizedSections, ...otherSections];
}

// Re-export types
export * from "./types";

