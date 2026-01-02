/**
 * API route for transcribing audio using OpenAI Whisper
 * POST /api/sermons/transcribe
 * 
 * Handles audio file transcription with retry logic and chunking for large files
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

interface TranscribeRequest {
  recordingId: string;
  audioUrl?: string; // Optional: if audio is already uploaded
}

interface TranscribeResponse {
  success: boolean;
  transcript: string;
  chunks?: Array<{
    text: string;
    start: number;
    end: number;
  }>;
  recordingId: string;
}

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000]; // Exponential backoff in ms

async function transcribeWithRetry(
  audioBuffer: Buffer,
  apiKey: string,
  retryCount = 0
): Promise<string> {
  try {
    const formData = new FormData();
    // Convert Buffer to Uint8Array for Blob compatibility
    const uint8Array = new Uint8Array(audioBuffer);
    const blob = new Blob([uint8Array], { type: 'audio/webm' });
    formData.append('file', blob, 'recording.webm');
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'verbose_json'); // Get timestamps

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      
      // Retry on rate limits or server errors
      if ((response.status === 429 || response.status >= 500) && retryCount < MAX_RETRIES) {
        const delay = RETRY_DELAYS[retryCount] || 8000;
        console.log(`[TRANSCRIBE] Retry ${retryCount + 1}/${MAX_RETRIES} after ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return transcribeWithRetry(audioBuffer, apiKey, retryCount + 1);
      }
      
      throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    return JSON.stringify(data); // Return full response with timestamps
  } catch (error) {
    if (retryCount < MAX_RETRIES && error instanceof Error && error.message.includes('429')) {
      const delay = RETRY_DELAYS[retryCount] || 8000;
      await new Promise(resolve => setTimeout(resolve, delay));
      return transcribeWithRetry(audioBuffer, apiKey, retryCount + 1);
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
        { error: "Unauthorized", message: "You must be logged in to transcribe recordings" },
        { status: 401 }
      );
    }

    const openaiApiKey = process.env.OPENAI_API_KEY || "";
    if (!openaiApiKey) {
      return NextResponse.json(
        { error: "Server configuration error", message: "OpenAI API key not configured" },
        { status: 500 }
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
        { error: "Unauthorized", message: "You must be logged in to transcribe recordings" },
        { status: 401 }
      );
    }

    const body: TranscribeRequest = await request.json();
    const { recordingId, audioUrl } = body;

    if (!recordingId) {
      return NextResponse.json(
        { error: "Bad request", message: "recordingId is required" },
        { status: 400 }
      );
    }

    // Check if already transcribed (idempotency)
    const { data: existingRecording } = await supabase
      .from("recordings")
      .select("transcript_chunks, file_path")
      .eq("id", recordingId)
      .eq("user_id", user.id)
      .single();

    if (existingRecording?.transcript_chunks && Array.isArray(existingRecording.transcript_chunks) && existingRecording.transcript_chunks.length > 0) {
      // Already transcribed, return existing
      const transcript = existingRecording.transcript_chunks
        .map((chunk: any) => chunk.text)
        .join(" ");
      
      return NextResponse.json({
        success: true,
        transcript,
        chunks: existingRecording.transcript_chunks,
        recordingId,
      });
    }

    // Get audio file from storage
    const filePath = existingRecording?.file_path || audioUrl;
    if (!filePath) {
      return NextResponse.json(
        { error: "Audio file not found", message: "No file path or audio URL provided" },
        { status: 404 }
      );
    }

    // Download audio file from Supabase Storage
    let audioBuffer: Buffer;
    if (filePath.startsWith('http')) {
      // External URL
      const response = await fetch(filePath);
      if (!response.ok) {
        throw new Error(`Failed to download audio: ${response.statusText}`);
      }
      audioBuffer = Buffer.from(await response.arrayBuffer());
    } else {
      // Supabase Storage path
      const { data, error: downloadError } = await supabase.storage
        .from("Audivine")
        .download(filePath);

      if (downloadError || !data) {
        return NextResponse.json(
          { error: "Failed to download audio", message: downloadError?.message || "File not found" },
          { status: 404 }
        );
      }

      audioBuffer = Buffer.from(await data.arrayBuffer());
    }

    // Check file size (25MB limit for OpenAI)
    const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
    if (audioBuffer.length > MAX_FILE_SIZE) {
      // TODO: Implement chunking for large files
      return NextResponse.json(
        { error: "File too large", message: `File size (${(audioBuffer.length / 1024 / 1024).toFixed(2)}MB) exceeds 25MB limit. Chunking not yet implemented.` },
        { status: 400 }
      );
    }

    // Transcribe with retry logic
    const transcriptionResult = await transcribeWithRetry(audioBuffer, openaiApiKey);
    const transcriptionData = JSON.parse(transcriptionResult);

    // Format transcript chunks with timestamps
    const chunks = transcriptionData.segments?.map((seg: any) => ({
      text: seg.text,
      timestampMs: Math.round(seg.start * 1000),
      isFinal: true,
    })) || [{
      text: transcriptionData.text || "",
      timestampMs: 0,
      isFinal: true,
    }];

    // Store transcript in database
    const { error: updateError } = await supabase
      .from("recordings")
      .update({
        transcript_chunks: chunks,
      })
      .eq("id", recordingId)
      .eq("user_id", user.id);

    if (updateError) {
      console.error("[TRANSCRIBE] Error storing transcript:", updateError);
      // Continue anyway - return the transcript even if DB update fails
    }

    const fullTranscript = transcriptionData.text || chunks.map((c: any) => c.text).join(" ");

    return NextResponse.json({
      success: true,
      transcript: fullTranscript,
      chunks,
      recordingId,
    });
  } catch (error) {
    console.error("Transcribe API error:", error);
    return NextResponse.json(
      {
        error: "Transcription failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

