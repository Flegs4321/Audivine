/**
 * API route for regenerating summaries
 * POST /api/summarize
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSummarizationProvider } from "@/lib/summarizer/summarize";
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
    const userOpenAISettings = await getUserOpenAISettings(user.id, token);

    if (!userOpenAISettings || !userOpenAISettings.apiKey) {
      return NextResponse.json(
        { 
          error: "OpenAI API key not configured", 
          message: "Please configure your OpenAI API key in Settings to generate summaries. Without your own API key, this feature is not available." 
        },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { text, label } = body;

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "Invalid request: text required" },
        { status: 400 }
      );
    }

    if (!["Announcements", "Sharing", "Sermon", "Other"].includes(label)) {
      return NextResponse.json(
        { error: "Invalid label" },
        { status: 400 }
      );
    }

    const summarizer = createSummarizationProvider({
      apiKey: userOpenAISettings.apiKey,
      model: userOpenAISettings.model,
      prompt: userOpenAISettings.prompt,
    });
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

