/**
 * API route for generating a comprehensive sermon summary
 * POST /api/sermons/generate-summary
 * Generates a nice, formatted summary suitable for sending to church members
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserOpenAISettings } from "@/lib/openai/user-settings";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;

    if (!token) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to generate summaries" },
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
        { error: "Unauthorized", message: "You must be logged in to generate summaries" },
        { status: 401 }
      );
    }

    // Get user's OpenAI settings (does NOT fall back to env vars)
    const userSettings = await getUserOpenAISettings(user.id, token);

    if (!userSettings || !userSettings.apiKey) {
      return NextResponse.json(
        { 
          error: "OpenAI API key not configured", 
          message: "Please configure your OpenAI API key in Settings to generate summaries. Without your own API key, this feature is not available." 
        },
        { status: 400 }
      );
    }

    const openaiApiKey = userSettings.apiKey;
    const openaiModel = userSettings.model;

    const body = await request.json();
    const { recordingId, transcript } = body;

    if (!recordingId && !transcript) {
      return NextResponse.json(
        { error: "Bad request", message: "Either recordingId or transcript must be provided" },
        { status: 400 }
      );
    }

    let fullTranscript = transcript;

    // If recordingId is provided, fetch the transcript from the recording
    if (recordingId && !transcript) {
      const { data: recording, error: fetchError } = await supabase
        .from("recordings")
        .select("*, segments, transcript_chunks")
        .eq("id", recordingId)
        .eq("user_id", user.id)
        .single();

      if (fetchError || !recording) {
        return NextResponse.json(
          { error: "Recording not found", message: "Could not find the recording" },
          { status: 404 }
        );
      }

      // Combine all transcript chunks into full text, including speaker information
      if (recording.transcript_chunks && Array.isArray(recording.transcript_chunks)) {
        // Since speaker names are now included in the text itself (e.g., "[John]: Hello..."),
        // we can simply concatenate all chunks, ensuring proper spacing
        let transcriptWithSpeakers = "";
        
        for (const chunk of recording.transcript_chunks) {
          // If this is a speaker tag (e.g., "[John sharing:]"), add it with proper spacing
          if (chunk.speakerTag === true) {
            transcriptWithSpeakers += "\n" + chunk.text + "\n";
          } else {
            // Regular transcript chunk - check if it already has speaker prefix
            // If the text already starts with "[Name]:", it's already formatted correctly
            const hasSpeakerPrefix = /^\[[^\]]+\]:\s*/.test(chunk.text);
            
            if (hasSpeakerPrefix) {
              // Already has speaker prefix, just add it
              transcriptWithSpeakers += chunk.text + " ";
            } else {
              // No speaker prefix, add as-is (this handles chunks without speakers)
              transcriptWithSpeakers += chunk.text + " ";
            }
          }
        }
        
        fullTranscript = transcriptWithSpeakers.trim();
      } else if (recording.segments && Array.isArray(recording.segments)) {
        // Fallback to segments if transcript_chunks not available
        fullTranscript = recording.segments
          .map((segment: any) => segment.text)
          .join(" ");
      } else {
        return NextResponse.json(
          { error: "No transcript found", message: "This recording has no transcript available" },
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

    // Generate comprehensive summary using OpenAI
    // Use only the custom prompt if provided, otherwise use default
    let prompt: string;
    if (userSettings.prompt && userSettings.prompt.trim().length > 0) {
      // Use only the custom prompt and transcript
      prompt = `${userSettings.prompt.trim()}\n\nTranscript (with speaker names indicated by [Speaker Name]:):\n${fullTranscript.substring(0, 16000)}`;
    } else {
      // Fallback to default prompt if no custom prompt
      prompt = `You are creating a summary of a church service sermon to send to all church members. 

The transcript includes speaker names indicated by [Speaker Name]: before their words. Use this information to identify who is speaking during different parts of the service (sharing time, sermon, etc.).

Please create a well-formatted, engaging summary that includes:
1. A compelling title for the sermon
2. A brief introduction (1-2 sentences)
3. Main message/theme (2-3 paragraphs)
4. Key points or takeaways (5-7 bullet points)
5. Scripture references mentioned (if any)
6. A closing thought or call to action (1-2 sentences)
7. If multiple speakers are mentioned, note who spoke during sharing time and who delivered the sermon

Make it warm, accessible, and inspiring. Format it in a way that's easy to read and share.

Sermon Transcript (with speaker names):
${fullTranscript.substring(0, 16000)}`;
    }

    // Use minimal system message when custom prompt is provided, otherwise use default
    const systemMessage = userSettings.prompt && userSettings.prompt.trim().length > 0
      ? "You are a helpful assistant. Follow the user's instructions exactly."
      : "You are a helpful assistant that creates engaging, well-formatted summaries of church sermons for distribution to members. Always format your response clearly with sections and bullet points.";

    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: openaiModel,
        messages: [
          {
            role: "system",
            content: systemMessage,
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      console.error("OpenAI API error:", errorText);
      return NextResponse.json(
        { error: "OpenAI API error", message: `Failed to generate summary: ${openaiResponse.statusText}` },
        { status: 500 }
      );
    }

    const openaiData = await openaiResponse.json();
    const summary = openaiData.choices[0]?.message?.content;

    if (!summary) {
      return NextResponse.json(
        { error: "No summary generated", message: "OpenAI did not return a summary" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      summary,
      transcriptLength: fullTranscript.length,
    });
  } catch (error) {
    console.error("Generate summary API error:", error);
    return NextResponse.json(
      {
        error: "Failed to generate summary",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

