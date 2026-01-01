/**
 * LLM-based section classification
 * Abstracted to allow swapping providers (OpenAI, Anthropic, local, etc.)
 */

import type { CandidateSegment, ClassifiedSegment, SectionLabel } from "./types";

export interface ClassificationProvider {
  /**
   * Classify a single segment
   * @returns Classification result with label and confidence
   */
  classify(segment: CandidateSegment): Promise<{
    label: SectionLabel;
    confidence: number;
  }>;

  /**
   * Classify multiple segments in batch (for efficiency)
   * @returns Array of classification results in same order as input
   */
  classifyBatch(segments: CandidateSegment[]): Promise<Array<{
    label: SectionLabel;
    confidence: number;
  }>>;
}

/**
 * OpenAI-based classification provider
 */
export class OpenAIClassificationProvider implements ClassificationProvider {
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

  async classify(segment: CandidateSegment): Promise<{
    label: SectionLabel;
    confidence: number;
  }> {
    const results = await this.classifyBatch([segment]);
    return results[0];
  }

  async classifyBatch(segments: CandidateSegment[]): Promise<Array<{
    label: SectionLabel;
    confidence: number;
  }>> {
    // Use single API call with structured output
    const prompt = `You are analyzing transcript segments from a church service. Classify each segment into one of these categories:

- "Announcements": Upcoming events, reminders, community information, scheduling
- "Sharing": Personal testimonies, prayer requests, praise reports, personal stories
- "Sermon": Teaching, Bible study, scriptural message, theological content
- "Other": Music, prayers, silence, transitions, or unclear content

Return JSON object with format: {"results": [{"label": "Announcements" | "Sharing" | "Sermon" | "Other", "confidence": 0.0-1.0}, ...]}

Segments to classify:
${segments.map((s, i) => `\n[${i}] ${s.text.substring(0, 500)}`).join("\n")}`;

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
              content: "You are a helpful assistant that classifies church service transcript segments. Always return valid JSON with a 'results' array.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.3,
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

      // Parse JSON response
      const parsed = JSON.parse(content);
      // Handle both {results: [...]} and [...] formats
      const results = Array.isArray(parsed) ? parsed : parsed.results || parsed.classifications || [];

      // Validate and return
      return results.slice(0, segments.length).map((r: any) => ({
        label: (r.label || r.category || "Other") as SectionLabel,
        confidence: typeof r.confidence === "number" ? r.confidence : 0.8,
      }));
    } catch (error) {
      console.error("Classification error:", error);
      // Fallback: return "Other" for all segments
      return segments.map(() => ({
        label: "Other" as SectionLabel,
        confidence: 0.0,
      }));
    }
  }
}

/**
 * Mock classification provider for testing/development
 */
export class MockClassificationProvider implements ClassificationProvider {
  async classify(segment: CandidateSegment): Promise<{
    label: SectionLabel;
    confidence: number;
  }> {
    // Simple keyword-based mock
    const text = segment.text.toLowerCase();
    if (segment.keywords?.some((k) => k.includes("announce"))) {
      return { label: "Announcements", confidence: 0.9 };
    }
    if (segment.keywords?.some((k) => k.includes("shar") || k.includes("testimony"))) {
      return { label: "Sharing", confidence: 0.9 };
    }
    if (segment.keywords?.some((k) => k.includes("sermon") || k.includes("message") || k.includes("scripture"))) {
      return { label: "Sermon", confidence: 0.9 };
    }
    return { label: "Other", confidence: 0.5 };
  }

  async classifyBatch(segments: CandidateSegment[]): Promise<Array<{
    label: SectionLabel;
    confidence: number;
  }>> {
    return Promise.all(segments.map((s) => this.classify(s)));
  }
}

/**
 * Factory function to create classification provider
 */
export function createClassificationProvider(): ClassificationProvider {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const baseUrl = process.env.OPENAI_BASE_URL;

  if (apiKey) {
    return new OpenAIClassificationProvider({ apiKey, model, baseUrl });
  }

  console.warn("No OPENAI_API_KEY found, using mock classifier");
  return new MockClassificationProvider();
}

