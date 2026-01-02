/**
 * API route for exporting a specific segment of a recording
 * POST /api/recordings/[id]/export-segment
 * Extracts audio segment and returns it as a downloadable file
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;

    if (!token) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to export segments" },
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
        { error: "Unauthorized", message: "You must be logged in to export segments" },
        { status: 401 }
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

    const body = await request.json();
    const { startMs, endMs } = body;

    if (typeof startMs !== "number" || (endMs !== null && typeof endMs !== "number")) {
      return NextResponse.json(
        { error: "Bad request", message: "startMs and endMs must be numbers" },
        { status: 400 }
      );
    }

    // Fetch recording to get storage URL
    const fetchUrl = `${supabaseUrl}/rest/v1/recordings?id=eq.${recordingId}&user_id=eq.${user.id}&select=storage_url,file_path`;
    const fetchResponse = await fetch(fetchUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
        "Content-Type": "application/json",
      },
    });

    if (!fetchResponse.ok) {
      return NextResponse.json(
        { error: "Recording not found", message: "Could not find the recording" },
        { status: 404 }
      );
    }

    const recordings = await fetchResponse.json();
    const recording = Array.isArray(recordings) && recordings.length > 0 ? recordings[0] : null;

    if (!recording || !recording.storage_url) {
      return NextResponse.json(
        { error: "Recording not found", message: "Recording has no audio file" },
        { status: 404 }
      );
    }

    // For now, return the full audio URL with instructions
    // In a production system, you would:
    // 1. Download the audio file from storage
    // 2. Use ffmpeg or similar to extract the segment
    // 3. Return the extracted segment as a blob
    
    // Since we can't do server-side audio processing easily without ffmpeg,
    // we'll return a response that tells the client to download the full file
    // and handle extraction client-side, or provide instructions
    
    return NextResponse.json(
      {
        error: "Audio extraction not yet implemented",
        message: "Server-side audio extraction requires ffmpeg. For now, you can download the full recording and extract the segment manually using the timestamps provided.",
        recordingUrl: recording.storage_url,
        startMs,
        endMs,
        durationMs: endMs ? endMs - startMs : null,
      },
      { status: 501 }
    );

    // TODO: Implement actual audio extraction using ffmpeg or similar
    // This would require:
    // 1. Downloading the audio file from Supabase storage
    // 2. Using ffmpeg to extract the segment: ffmpeg -i input.webm -ss startTime -t duration output.mp3
    // 3. Returning the extracted audio as a blob
  } catch (error) {
    console.error("Export segment API error:", error);
    return NextResponse.json(
      {
        error: "Failed to export segment",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

