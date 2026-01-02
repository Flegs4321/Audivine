/**
 * API route for analyzing transcript with OpenAI
 * POST /api/sermons/analyze-with-openai
 * 
 * Segments transcript into Announcements, Sharing, Sermon
 * Generates summaries and bullet points using OpenAI
 * Returns structured JSON output
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserOpenAISettings } from "@/lib/openai/user-settings";

export const runtime = "nodejs";

interface AnalyzeRequest {
  recordingId: string;
  transcript?: string; // Optional: if not provided, fetched from DB
}

interface SectionAnalysis {
  summary: string;
  bullets?: string[];
}

interface AnalyzeResponse {
  success: boolean;
  sections: {
    announcements: SectionAnalysis;
    sharing: SectionAnalysis;
    sermon: SectionAnalysis & { key_points: string[] };
  };
  recordingId: string;
}

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000];

async function analyzeWithRetry(
  prompt: string,
  apiKey: string,
  model: string,
  retryCount = 0
): Promise<any> {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that analyzes church service transcripts. Always return valid JSON matching the exact schema requested.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3, // Lower temperature for more consistent structure
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      
      // Retry on rate limits or server errors
      if ((response.status === 429 || response.status >= 500) && retryCount < MAX_RETRIES) {
        const delay = RETRY_DELAYS[retryCount] || 8000;
        console.log(`[ANALYZE] Retry ${retryCount + 1}/${MAX_RETRIES} after ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return analyzeWithRetry(prompt, apiKey, model, retryCount + 1);
      }
      
      throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;
    
    if (!content) {
      throw new Error('No response content from OpenAI');
    }

    return JSON.parse(content);
  } catch (error) {
    if (retryCount < MAX_RETRIES && error instanceof Error && error.message.includes('429')) {
      const delay = RETRY_DELAYS[retryCount] || 8000;
      await new Promise(resolve => setTimeout(resolve, delay));
      return analyzeWithRetry(prompt, apiKey, model, retryCount + 1);
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
        { error: "Unauthorized", message: "You must be logged in to analyze recordings" },
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
        { error: "Unauthorized", message: "You must be logged in to analyze recordings" },
        { status: 401 }
      );
    }

    // Get user's OpenAI settings (does NOT fall back to env vars)
    const userSettings = await getUserOpenAISettings(user.id, token);

    if (!userSettings || !userSettings.apiKey) {
      return NextResponse.json(
        { 
          error: "OpenAI API key not configured", 
          message: "Please configure your OpenAI API key in Settings to analyze recordings. Without your own API key, this feature is not available." 
        },
        { status: 400 }
      );
    }

    const openaiApiKey = userSettings.apiKey;
    const openaiModel = userSettings.model;

    const body: AnalyzeRequest = await request.json();
    const { recordingId, transcript: providedTranscript } = body;

    if (!recordingId) {
      return NextResponse.json(
        { error: "Bad request", message: "recordingId is required" },
        { status: 400 }
      );
    }

    // Get transcript from DB if not provided
    let fullTranscript = providedTranscript;
    if (!fullTranscript) {
      const { data: recording, error: fetchError } = await supabase
        .from("recordings")
        .select("transcript_chunks")
        .eq("id", recordingId)
        .eq("user_id", user.id)
        .single();

      if (fetchError || !recording) {
        return NextResponse.json(
          { error: "Recording not found", message: "Could not find the recording" },
          { status: 404 }
        );
      }

      if (recording.transcript_chunks && Array.isArray(recording.transcript_chunks)) {
        fullTranscript = recording.transcript_chunks
          .map((chunk: any) => chunk.text)
          .join(" ");
      } else {
        return NextResponse.json(
          { error: "No transcript found", message: "This recording has no transcript. Please transcribe it first." },
          { status: 400 }
        );
      }
    }

    if (!fullTranscript || fullTranscript.trim().length === 0) {
      return NextResponse.json(
        { error: "Empty transcript", message: "The transcript is empty" },
        { status: 400 }
      );
    }

    // Create prompt for OpenAI
    let basePrompt = `Analyze this church service transcript and segment it into three sections: Announcements, Sharing Time, and Sermon.

For each section, provide:
1. A concise summary (2-4 sentences)
2. Key bullet points (3-5 for Announcements/Sharing, 5-10 for Sermon)

For the Sermon section, also provide key_points (5-10 main takeaways).

Return JSON in this exact format:
{
  "announcements": {
    "summary": "2-4 sentence summary",
    "bullets": ["bullet 1", "bullet 2", ...]
  },
  "sharing": {
    "summary": "2-4 sentence summary",
    "bullets": ["bullet 1", "bullet 2", ...]
  },
  "sermon": {
    "summary": "2-4 sentence summary",
    "bullets": ["bullet 1", "bullet 2", ...],
    "key_points": ["key point 1", "key point 2", ...]
  }
}`;

    // Append custom prompt if provided
    if (userSettings.prompt && userSettings.prompt.trim().length > 0) {
      basePrompt += `\n\nAdditional Instructions:\n${userSettings.prompt.trim()}`;
    }

    const prompt = `${basePrompt}\n\nTranscript:\n${fullTranscript.substring(0, 16000)}`;

    // Call OpenAI with retry logic
    const analysisResult = await analyzeWithRetry(prompt, openaiApiKey, openaiModel);

    // Validate and format response
    const sections = {
      announcements: {
        summary: analysisResult.announcements?.summary || "No announcements section found.",
        bullets: analysisResult.announcements?.bullets || [],
      },
      sharing: {
        summary: analysisResult.sharing?.summary || "No sharing section found.",
        bullets: analysisResult.sharing?.bullets || [],
      },
      sermon: {
        summary: analysisResult.sermon?.summary || "No sermon section found.",
        bullets: analysisResult.sermon?.bullets || [],
        key_points: analysisResult.sermon?.key_points || [],
      },
    };

    // Store analysis in database
    const segments = [
      {
        label: "Announcements",
        startMs: 0,
        endMs: null,
        text: fullTranscript.substring(0, Math.floor(fullTranscript.length / 3)),
        summary: sections.announcements.summary,
        bullets: sections.announcements.bullets,
      },
      {
        label: "Sharing",
        startMs: null,
        endMs: null,
        text: fullTranscript.substring(Math.floor(fullTranscript.length / 3), Math.floor(fullTranscript.length * 2 / 3)),
        summary: sections.sharing.summary,
        bullets: sections.sharing.bullets,
      },
      {
        label: "Sermon",
        startMs: null,
        endMs: null,
        text: fullTranscript.substring(Math.floor(fullTranscript.length * 2 / 3)),
        summary: sections.sermon.summary,
        bullets: sections.sermon.bullets,
        key_points: sections.sermon.key_points,
      },
    ];

    const { error: updateError } = await supabase
      .from("recordings")
      .update({
        segments: segments,
      })
      .eq("id", recordingId)
      .eq("user_id", user.id);

    if (updateError) {
      console.error("[ANALYZE] Error storing segments:", updateError);
      // Continue anyway - return the analysis even if DB update fails
    }

    return NextResponse.json({
      success: true,
      sections,
      recordingId,
    });
  } catch (error) {
    console.error("Analyze API error:", error);
    return NextResponse.json(
      {
        error: "Analysis failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

