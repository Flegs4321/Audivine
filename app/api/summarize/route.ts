/**
 * API route for regenerating summaries
 * POST /api/summarize
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSummarizationProviderFromGenSettings } from "@/lib/summarizer/summarize";
import { getUserSummaryGenerationSettings } from "@/lib/ai/summary-generation-settings";
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

    let genSettings = await getUserSummaryGenerationSettings(user.id, token, supabase);

    if (!genSettings) {
      const openaiOnly = await getUserOpenAISettings(user.id, token);
      if (openaiOnly?.apiKey) {
        genSettings = {
          provider: "openai",
          prompt: openaiOnly.prompt ?? null,
          openai: {
            apiKey: openaiOnly.apiKey,
            model: openaiOnly.model,
          },
        };
      }
    }

    const summarizer = genSettings ? createSummarizationProviderFromGenSettings(genSettings) : null;

    if (!summarizer) {
      return NextResponse.json(
        {
          error: "API key not configured",
          message:
            "Add an Anthropic (Claude) API key or an OpenAI API key in Settings to generate section summaries.",
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

