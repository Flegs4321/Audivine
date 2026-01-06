/**
 * API route for transcribing audio using OpenAI Whisper
 * POST /api/sermons/transcribe
 * 
 * Handles audio file transcription with retry logic and chunking for large files
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserOpenAISettings } from "@/lib/openai/user-settings";

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

    // Get user's OpenAI settings (does NOT fall back to env vars)
    const userSettings = await getUserOpenAISettings(user.id, token);

    if (!userSettings || !userSettings.apiKey) {
      return NextResponse.json(
        { 
          error: "OpenAI API key not configured", 
          message: "Please configure your OpenAI API key in Settings to transcribe recordings. Without your own API key, this feature is not available." 
        },
        { status: 400 }
      );
    }

    const openaiApiKey = userSettings.apiKey;

    const body: TranscribeRequest = await request.json();
    const { recordingId, audioUrl } = body;

    if (!recordingId) {
      return NextResponse.json(
        { error: "Bad request", message: "recordingId is required" },
        { status: 400 }
      );
    }

    // Check if already transcribed (idempotency)
    // Also get existing chunks to preserve speaker information
    const { data: existingRecording } = await supabase
      .from("recordings")
      .select("transcript_chunks, file_path")
      .eq("id", recordingId)
      .eq("user_id", user.id)
      .single();

    if (existingRecording?.transcript_chunks && Array.isArray(existingRecording.transcript_chunks) && existingRecording.transcript_chunks.length > 0) {
      // Check if chunks already have Whisper transcription (have timestamps and are final)
      // If they do, return existing
      const hasWhisperTranscription = existingRecording.transcript_chunks.some(
        (chunk: any) => chunk.isFinal && typeof chunk.timestampMs === 'number'
      );
      
      if (hasWhisperTranscription) {
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
    }
    
    // Get existing browser chunks to preserve speaker information
    const existingBrowserChunks = existingRecording?.transcript_chunks || [];

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
    // Preserve speaker information from existing browser chunks
    const whisperChunks = transcriptionData.segments?.map((seg: any) => {
      const whisperTimestamp = Math.round(seg.start * 1000);
      
      // Find the most recent browser chunk with a speaker before or at this timestamp
      let speaker: string | undefined;
      let speakerTag: boolean | undefined;
      
      // First, check for speaker tag chunks (these mark when a speaker starts)
      for (let i = existingBrowserChunks.length - 1; i >= 0; i--) {
        const browserChunk = existingBrowserChunks[i];
        // If we find a speaker tag chunk before this timestamp, use its speaker
        if (browserChunk.speakerTag && browserChunk.speaker && browserChunk.timestampMs <= whisperTimestamp) {
          speaker = browserChunk.speaker;
          speakerTag = false; // This is a regular chunk, not a tag
          break;
        }
      }
      
      // If no speaker tag found, look for any chunk with a speaker
      if (!speaker) {
        for (let i = existingBrowserChunks.length - 1; i >= 0; i--) {
          const browserChunk = existingBrowserChunks[i];
          if (browserChunk.speaker && browserChunk.timestampMs <= whisperTimestamp) {
            speaker = browserChunk.speaker;
            speakerTag = browserChunk.speakerTag;
            break;
          }
        }
      }
      
      // Format text with speaker name prefix if speaker exists
      // Format: "Speaker - text"
      let formattedText = seg.text.trim();
      if (speaker) {
        // Check if text already has a speaker prefix to avoid double-prefixing
        const alreadyHasSpeakerTag = /^\[[^\]]+\]:\s*/.test(formattedText) || /^[A-Za-z][A-Za-z\s]+\s+-\s+/.test(formattedText);
        if (!alreadyHasSpeakerTag) {
          formattedText = `${speaker} - ${formattedText}`;
          console.log(`[TRANSCRIBE] Added speaker prefix: "${speaker} - ${formattedText.substring(0, 50)}..."`);
        } else {
          console.log(`[TRANSCRIBE] Text already has speaker tag: "${formattedText.substring(0, 50)}..."`);
        }
      } else {
        console.log(`[TRANSCRIBE] No speaker found for chunk at ${whisperTimestamp}ms: "${formattedText.substring(0, 50)}..."`);
      }
      
      return {
        text: formattedText,
        timestampMs: whisperTimestamp,
        isFinal: true,
        speaker: speaker,
        speakerTag: speakerTag || false,
      };
    }) || [{
      text: transcriptionData.text || "",
      timestampMs: 0,
      isFinal: true,
    }];
    
    console.log(`[TRANSCRIBE] Preserved speaker info: ${whisperChunks.filter((c: any) => c.speaker).length} chunks with speakers out of ${whisperChunks.length} total`);
    
    // Also preserve any speaker tag chunks from browser transcription
    const speakerTagChunks = existingBrowserChunks.filter((chunk: any) => 
      chunk.speakerTag === true
    );
    
    // Merge speaker tags with Whisper chunks, maintaining chronological order
    const allChunks = [...whisperChunks, ...speakerTagChunks]
      .sort((a: any, b: any) => a.timestampMs - b.timestampMs);

    // Store transcript in database with preserved speaker information
    const { error: updateError } = await supabase
      .from("recordings")
      .update({
        transcript_chunks: allChunks,
      })
      .eq("id", recordingId)
      .eq("user_id", user.id);

    if (updateError) {
      console.error("[TRANSCRIBE] Error storing transcript:", updateError);
      // Continue anyway - return the transcript even if DB update fails
    }

    const fullTranscript = transcriptionData.text || allChunks.map((c: any) => c.text).join(" ");

    return NextResponse.json({
      success: true,
      transcript: fullTranscript,
      chunks: allChunks,
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

