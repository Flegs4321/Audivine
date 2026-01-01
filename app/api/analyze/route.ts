/**
 * API route for automatic section detection and summarization
 * POST /api/analyze
 */

import { NextRequest, NextResponse } from "next/server";
import { segmentTranscript } from "@/lib/segmenter";
import { summarizeSections } from "@/lib/summarizer";
import type { TranscriptChunk, SegmentationResult } from "@/lib/segmenter/types";
import type { FinalSection } from "@/lib/segmenter/types";

export const runtime = "nodejs";

export interface AnalyzeRequest {
  /** Transcript chunks with timestamps */
  chunks: TranscriptChunk[];
  /** Total recording duration in milliseconds */
  totalDurationMs: number;
  /** Optional: skip summarization (classification only) */
  skipSummarization?: boolean;
}

export interface AnalyzeResponse {
  /** Final sections with summaries */
  sections: FinalSection[];
  /** Ignored segments */
  ignored: Array<{
    startMs: number;
    endMs: number;
    reason: string;
  }>;
  /** Metadata */
  metadata?: {
    candidateCount: number;
    classifiedCount: number;
    processingTimeMs?: number;
  };
}

export async function POST(request: NextRequest) {
  try {
    const startTime = Date.now();
    const body: AnalyzeRequest = await request.json();

    // Validate input
    if (!body.chunks || !Array.isArray(body.chunks)) {
      return NextResponse.json(
        { error: "Invalid request: chunks array required" },
        { status: 400 }
      );
    }

    if (typeof body.totalDurationMs !== "number" || body.totalDurationMs <= 0) {
      return NextResponse.json(
        { error: "Invalid request: totalDurationMs must be a positive number" },
        { status: 400 }
      );
    }

    // Step 1: Segment and classify
    const segmentationResult: SegmentationResult = await segmentTranscript(
      body.chunks,
      body.totalDurationMs
    );

    // Step 2: Summarize (if requested)
    let finalSections = segmentationResult.sections;
    if (!body.skipSummarization) {
      finalSections = await summarizeSections(segmentationResult.sections);
    }

    const processingTime = Date.now() - startTime;

    // Return response
    const response: AnalyzeResponse = {
      sections: finalSections,
      ignored: segmentationResult.ignored,
      metadata: {
        candidateCount: segmentationResult.candidates?.length || 0,
        classifiedCount: segmentationResult.classified?.length || 0,
        processingTimeMs: processingTime,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Analysis error:", error);
    return NextResponse.json(
      {
        error: "Analysis failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

