/**
 * LLM-based summarization
 * Abstracted to allow swapping providers
 */

import type { SectionSummary, SummarizationProvider } from "./types";

/**
 * OpenAI-based summarization provider
 */
export class OpenAISummarizationProvider implements SummarizationProvider {
  private apiKey: string;
  private model: string;
  private baseUrl?: string;

  constructor(options: {
    apiKey: string;
    model?: string;
    baseUrl?: string;
  }) {
    this.apiKey = options.apiKey;
    this.model = options.model || "gpt-4o-mini";
    this.baseUrl = options.baseUrl;
  }

  async summarize(
    text: string,
    label: "Announcements" | "Sharing" | "Sermon" | "Other"
  ): Promise<SectionSummary> {
    const isSermon = label === "Sermon";

    const prompt = isSermon
      ? `Summarize this ${label.toLowerCase()} section from a church service transcript. Provide:
1. A concise summary paragraph (2-4 sentences) capturing the main message
2. 5-10 bullet points highlighting key points, scriptures, and takeaways

Return JSON: {"summary": "2-4 sentence summary", "bullets": ["bullet 1", "bullet 2", ...]}

Transcript:
${text.substring(0, 8000)}`
      : label === "Other"
      ? `Summarize this section from a church service transcript in 2-4 sentences. Capture the key information, events, or points shared. This section may contain various types of content.

Return JSON: {"summary": "2-4 sentence summary"}

Transcript:
${text.substring(0, 8000)}`
      : `Summarize this ${label.toLowerCase()} section from a church service transcript in 2-4 sentences. Capture the key information, events, or points shared.

Return JSON: {"summary": "2-4 sentence summary"}

Transcript:
${text.substring(0, 8000)}`;

    try {
      const response = await fetch(this.baseUrl || "https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: "system",
              content: "You are a helpful assistant that summarizes church service content. Always return valid JSON.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.5,
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content;
      if (!content) {
        throw new Error("No response content from OpenAI");
      }

      const parsed = JSON.parse(content);
      return {
        summary: parsed.summary || "Summary not available.",
        bullets: parsed.bullets || (isSermon ? [] : undefined),
      };
    } catch (error) {
      console.error("Summarization error:", error);
      return {
        summary: "Summary generation failed. Please review the transcript manually.",
        bullets: isSermon ? [] : undefined,
      };
    }
  }
}

/**
 * Mock summarization provider for testing/development
 */
export class MockSummarizationProvider implements SummarizationProvider {
  async summarize(
    text: string,
    label: "Announcements" | "Sharing" | "Sermon" | "Other"
  ): Promise<SectionSummary> {
    const isSermon = label === "Sermon";

    return {
      summary: isSermon 
        ? "The message covers important biblical themes and practical applications."
        : "Key information and updates were shared with the congregation.",
      bullets: isSermon
        ? [
            "Key point from the message",
            "Scriptural reference discussed",
            "Practical application shared",
            "Important takeaway for daily life",
            "Call to action or reflection",
          ]
        : undefined,
    };
  }
}

/**
 * Factory function to create summarization provider
 */
export function createSummarizationProvider(): SummarizationProvider {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const baseUrl = process.env.OPENAI_BASE_URL;

  if (apiKey) {
    return new OpenAISummarizationProvider({ apiKey, model, baseUrl });
  }

  console.warn("No OPENAI_API_KEY found, using mock summarizer");
  return new MockSummarizationProvider();
}

