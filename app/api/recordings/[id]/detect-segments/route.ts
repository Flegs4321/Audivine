/**
 * API route for auto-detecting recording segments using OpenAI
 * POST /api/recordings/[id]/detect-segments
 * 
 * Analyzes the transcript to automatically detect where Announcements, Sharing, and Sermon sections begin
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserOpenAISettings } from "@/lib/openai/user-settings";

export const runtime = "nodejs";

interface TranscriptChunk {
  text: string;
  timestampMs: number;
  isFinal?: boolean;
}

interface DetectedSegment {
  label: "Announcements" | "Sharing" | "Sermon";
  startMs: number;
  endMs: number;
  confidence?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;

    if (!token) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in" },
        { status: 401 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        { error: "Server configuration error", message: "Supabase not configured" },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in" },
        { status: 401 }
      );
    }

    // Get user's OpenAI settings
    const userSettings = await getUserOpenAISettings(user.id, token);
    if (!userSettings || !userSettings.apiKey) {
      return NextResponse.json(
        { error: "OpenAI not configured", message: "Please configure your OpenAI API key in settings" },
        { status: 400 }
      );
    }

    const resolvedParams = await Promise.resolve(params);
    const recordingId = resolvedParams.id;

    if (!recordingId) {
      return NextResponse.json(
        { error: "Recording ID is required" },
        { status: 400 }
      );
    }

    // Fetch the recording
    const { data: recording, error: fetchError } = await supabase
      .from("recordings")
      .select("id, transcript_chunks, duration, user_id")
      .eq("id", recordingId)
      .eq("user_id", user.id)
      .single();

    if (fetchError || !recording) {
      return NextResponse.json(
        { error: "Recording not found", message: fetchError?.message },
        { status: 404 }
      );
    }

    if (!recording.transcript_chunks || !Array.isArray(recording.transcript_chunks) || recording.transcript_chunks.length === 0) {
      return NextResponse.json(
        { error: "No transcript available", message: "This recording has no transcript to analyze" },
        { status: 400 }
      );
    }

    // Build transcript with timestamps for OpenAI analysis
    const chunks: TranscriptChunk[] = recording.transcript_chunks;
    const transcriptWithTimestamps = chunks
      .map((chunk, index) => {
        const timeInSeconds = Math.floor(chunk.timestampMs / 1000);
        const minutes = Math.floor(timeInSeconds / 60);
        const seconds = timeInSeconds % 60;
        const timeString = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        return `[${timeString}] ${chunk.text}`;
      })
      .join("\n");

    const fullTranscript = chunks.map(c => c.text).join(" ");
    const totalDurationMs = recording.duration * 1000;

    // Use OpenAI to detect segments
    const prompt = `You are analyzing a church service recording transcript. Your task is to identify where different sections begin and end.

The transcript includes timestamps in the format [MM:SS] before each chunk of text.

Identify THREE main sections:
1. **Announcements** - Usually at the beginning, includes announcements about events, prayer requests, church business, etc.
2. **Sharing** - Testimonies, sharing time, member stories, etc.
3. **Sermon** - The main message/sermon/preaching

Analyze the transcript and determine the approximate time (in seconds from the start) where each section begins and ends.

Return your response as a JSON object with this exact format:
{
  "segments": [
    {
      "label": "Announcements",
      "startSeconds": 0,
      "endSeconds": 300,
      "reasoning": "Brief explanation of why this is the announcements section"
    },
    {
      "label": "Sharing",
      "startSeconds": 300,
      "endSeconds": 900,
      "reasoning": "Brief explanation of why this is the sharing section"
    },
    {
      "label": "Sermon",
      "startSeconds": 900,
      "endSeconds": 3600,
      "reasoning": "Brief explanation of why this is the sermon section"
    }
  ]
}

IMPORTANT:
- Start times should be in seconds from the beginning (0 = start of recording)
- End times should be in seconds from the beginning
- If a section doesn't exist, you can omit it or set startSeconds equal to endSeconds
- The segments should not overlap
- Be as accurate as possible based on the content

Transcript with timestamps:
${transcriptWithTimestamps}

Full transcript (for context):
${fullTranscript.substring(0, 10000)}${fullTranscript.length > 10000 ? '...' : ''}

Total recording duration: ${recording.duration} seconds

Return ONLY the JSON object, no other text.`;

    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${userSettings.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: userSettings.model || "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are a helpful assistant that analyzes church service transcripts to identify different sections. Always return valid JSON only.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.3,
        response_format: { type: "json_object" },
      }),
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      console.error("[DETECT SEGMENTS] OpenAI error:", errorText);
      return NextResponse.json(
        { error: "OpenAI API error", message: "Failed to analyze transcript" },
        { status: 500 }
      );
    }

    const openaiData = await openaiResponse.json();
    const content = openaiData.choices?.[0]?.message?.content;

    if (!content) {
      return NextResponse.json(
        { error: "Invalid response from OpenAI", message: "No content returned" },
        { status: 500 }
      );
    }

    let parsedResponse;
    try {
      parsedResponse = JSON.parse(content);
    } catch (parseError) {
      console.error("[DETECT SEGMENTS] JSON parse error:", parseError, "Content:", content);
      return NextResponse.json(
        { error: "Invalid JSON response from OpenAI", message: "Failed to parse response" },
        { status: 500 }
      );
    }

    // Convert OpenAI response to our segment format
    const detectedSegments: DetectedSegment[] = [];
    if (parsedResponse.segments && Array.isArray(parsedResponse.segments)) {
      for (const seg of parsedResponse.segments) {
        if (seg.label && typeof seg.startSeconds === 'number' && typeof seg.endSeconds === 'number') {
          // Validate label
          const validLabels = ["Announcements", "Sharing", "Sermon"];
          if (!validLabels.includes(seg.label)) {
            continue;
          }

          detectedSegments.push({
            label: seg.label as "Announcements" | "Sharing" | "Sermon",
            startMs: Math.max(0, seg.startSeconds * 1000),
            endMs: Math.min(totalDurationMs, seg.endSeconds * 1000),
            confidence: seg.reasoning || "Auto-detected",
          });
        }
      }
    }

    if (detectedSegments.length === 0) {
      return NextResponse.json(
        { error: "No segments detected", message: "OpenAI could not identify any segments in the transcript" },
        { status: 400 }
      );
    }

    // Sort segments by start time
    detectedSegments.sort((a, b) => a.startMs - b.startMs);

    // Populate transcript text for each segment from transcript_chunks
    const segmentsWithText = detectedSegments.map(seg => {
      // Find all chunks that fall within this segment's time range
      const segmentChunks = chunks.filter(chunk => {
        const chunkMs = chunk.timestampMs;
        return chunkMs >= seg.startMs && chunkMs < seg.endMs;
      });

      // Combine chunk text, filtering out tags like [Member Name sharing:]
      const segmentText = segmentChunks
        .map(chunk => chunk.text)
        .filter(text => !text.match(/^\[.*\](:)?$/)) // Remove tag-only chunks
        .join(" ")
        .trim();

      return {
        label: seg.label,
        startMs: seg.startMs,
        endMs: seg.endMs,
        text: segmentText || "", // Populate from transcript chunks
        output: "",
        bullets: seg.label === "Sermon" ? "" : undefined,
      };
    });

    // Update the recording with detected segments
    const updateUrl = `${supabaseUrl}/rest/v1/recordings?id=eq.${recordingId}&user_id=eq.${user.id}`;
    const updateResponse = await fetch(updateUrl, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
        "Content-Type": "application/json",
        "Prefer": "return=representation",
      },
      body: JSON.stringify({
        segments: segmentsWithText,
      }),
    });

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error("[DETECT SEGMENTS] Update error:", errorText);
      return NextResponse.json(
        { error: "Failed to save segments", message: errorText },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      segments: detectedSegments,
      message: `Successfully detected ${detectedSegments.length} segment(s)`,
    });
  } catch (error) {
    console.error("Detect segments API error:", error);
    return NextResponse.json(
      {
        error: "Failed to detect segments",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

