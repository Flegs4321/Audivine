/**
 * Transcribe a single audio chunk with OpenAI Whisper.
 *
 * POST /api/sermons/transcribe-chunk  (multipart/form-data)
 *   - audio:   File         The audio chunk to transcribe (e.g. a small MP3).
 *   - offsetMs:string        How far this chunk starts inside the original recording (ms).
 *   - recordingId:string     For ownership checks; the recording is NOT modified here.
 *
 * Returns Whisper's verbose_json result with timestamps shifted by `offsetMs`.
 * This endpoint never reads, writes, or replaces the original audio file in
 * Supabase Storage — it only forwards the uploaded chunk to OpenAI.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserOpenAISettings } from "@/lib/openai/user-settings";

export const runtime = "nodejs";
// Allow chunks up to ~10 MB. Client-side splitting targets ~3 MB chunks.
export const maxDuration = 300;

interface ChunkTranscriptResult {
  text: string;
  timestampMs: number;
  isFinal: true;
  source: "whisper";
}

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000];

async function transcribeChunkWithRetry(
  audioBuffer: ArrayBuffer,
  fileName: string,
  contentType: string,
  apiKey: string,
  model: string,
  retryCount = 0
): Promise<{ text: string; segments?: Array<{ start: number; end: number; text: string }> }> {
  try {
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(audioBuffer)], { type: contentType });
    formData.append("file", blob, fileName);
    formData.append("model", model || "whisper-1");
    formData.append("response_format", "verbose_json");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      if ((response.status === 429 || response.status >= 500) && retryCount < MAX_RETRIES) {
        const delay = RETRY_DELAYS[retryCount] || 8000;
        await new Promise((resolve) => setTimeout(resolve, delay));
        return transcribeChunkWithRetry(audioBuffer, fileName, contentType, apiKey, model, retryCount + 1);
      }
      throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    if (retryCount < MAX_RETRIES && error instanceof Error && error.message.includes("429")) {
      const delay = RETRY_DELAYS[retryCount] || 8000;
      await new Promise((resolve) => setTimeout(resolve, delay));
      return transcribeChunkWithRetry(audioBuffer, fileName, contentType, apiKey, model, retryCount + 1);
    }
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
    if (!token) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to transcribe sermons" },
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
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to transcribe sermons" },
        { status: 401 }
      );
    }

    const userSettings = await getUserOpenAISettings(user.id, token);
    if (!userSettings || !userSettings.apiKey) {
      return NextResponse.json(
        {
          error: "OpenAI API key not configured",
          message:
            "Please configure your OpenAI API key in Settings to transcribe recordings.",
        },
        { status: 400 }
      );
    }

    const formData = await request.formData();
    const audio = formData.get("audio") as File | null;
    const offsetMsRaw = (formData.get("offsetMs") as string) || "0";
    const recordingId = (formData.get("recordingId") as string) || "";

    if (!audio) {
      return NextResponse.json(
        { error: "Bad request", message: "No audio chunk provided" },
        { status: 400 }
      );
    }

    if (recordingId) {
      // Verify the user actually owns this recording. We do NOT modify the
      // original recording row here; this is purely an authorization check
      // so users can't waste another account's API quota.
      const { data: ownership, error: ownershipError } = await supabase
        .from("recordings")
        .select("id")
        .eq("id", recordingId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (ownershipError) {
        return NextResponse.json(
          { error: "Database error", message: ownershipError.message },
          { status: 500 }
        );
      }
      if (!ownership) {
        return NextResponse.json(
          { error: "Not found", message: "Recording not found or not owned by current user" },
          { status: 404 }
        );
      }
    }

    const offsetMs = Math.max(0, Math.floor(Number(offsetMsRaw) || 0));
    const arrayBuffer = await audio.arrayBuffer();

    const data = await transcribeChunkWithRetry(
      arrayBuffer,
      audio.name || "chunk.mp3",
      audio.type || "audio/mpeg",
      userSettings.apiKey,
      userSettings.transcriptionModel || "whisper-1"
    );

    const chunks: ChunkTranscriptResult[] =
      Array.isArray(data.segments) && data.segments.length > 0
        ? data.segments
            .filter((seg) => seg && typeof seg.text === "string")
            .map((seg) => ({
              text: seg.text.trim(),
              timestampMs: offsetMs + Math.round((seg.start || 0) * 1000),
              isFinal: true,
              source: "whisper" as const,
            }))
        : [
            {
              text: (data.text || "").trim(),
              timestampMs: offsetMs,
              isFinal: true,
              source: "whisper" as const,
            },
          ];

    return NextResponse.json({
      success: true,
      chunks,
      text: data.text || "",
      offsetMs,
    });
  } catch (error) {
    console.error("Transcribe-chunk API error:", error);
    return NextResponse.json(
      {
        error: "Transcription failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
