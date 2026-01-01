/**
 * API route for regenerating summaries
 * POST /api/summarize
 */

import { NextRequest, NextResponse } from "next/server";
import { createSummarizationProvider } from "@/lib/summarizer/summarize";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, label } = body;

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "Invalid request: text required" },
        { status: 400 }
      );
    }

    if (!["Announcements", "Sharing", "Sermon"].includes(label)) {
      return NextResponse.json(
        { error: "Invalid label" },
        { status: 400 }
      );
    }

    const summarizer = createSummarizationProvider();
    const result = await summarizer.summarize(text, label);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Summarization error:", error);
    return NextResponse.json(
      {
        error: "Summarization failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

