/**
 * Simple test endpoint to verify OpenAI connection
 * GET /api/test-openai
 * Uses user's API key if configured, otherwise falls back to environment variable
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserOpenAISettings } from "@/lib/openai/user-settings";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;

    if (!token) {
      return NextResponse.json({
        connected: false,
        error: "Authentication required",
        message: "You must be logged in to test OpenAI connection",
      });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({
        connected: false,
        error: "Server configuration error",
        message: "Supabase not configured",
      });
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
      return NextResponse.json({
        connected: false,
        error: "Authentication failed",
        message: "You must be logged in to test OpenAI connection",
      });
    }

    // Get user's API key (does NOT fall back to environment variables)
    const userSettings = await getUserOpenAISettings(user.id, token);

    if (!userSettings || !userSettings.apiKey) {
      return NextResponse.json({
        connected: false,
        error: "OpenAI API key not configured",
        message: "Please configure your OpenAI API key in Settings to use OpenAI features. Without your own API key, summarization and analysis features will not be available.",
      });
    }

    const openaiApiKey = userSettings.apiKey;
    const model = userSettings.model;

    // Test with a simple API call
    const testResponse = await fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${openaiApiKey}`,
      },
    });

    if (!testResponse.ok) {
      const errorText = await testResponse.text();
      return NextResponse.json({
        connected: false,
        error: `OpenAI API error: ${testResponse.status} ${testResponse.statusText}`,
        details: errorText,
        message: "API key may be invalid or expired",
      });
    }

    const models = await testResponse.json();
    
    // Get all available model IDs
    const availableModelIds = models.data?.map((m: any) => m.id) || [];
    
    // Check if the selected model is available
    const isModelAvailable = availableModelIds.includes(model);
    
    // Filter to only chat/completion models (exclude deprecated and non-chat models)
    const chatModels = availableModelIds.filter((id: string) => 
      id.startsWith("gpt-") && 
      !id.includes("instruct") && 
      !id.includes("deprecated")
    );
    
    return NextResponse.json({
      connected: true,
      message: isModelAvailable 
        ? "OpenAI API is connected and working!" 
        : `OpenAI API is connected, but the selected model "${model}" may not be available. Using available models instead.`,
      apiKeyPrefix: openaiApiKey.substring(0, 7) + "...", // Show first 7 chars for verification
      model: model,
      isModelAvailable: isModelAvailable,
      availableModels: chatModels,
      allAvailableModels: availableModelIds,
    });
  } catch (error) {
    return NextResponse.json({
      connected: false,
      error: "Failed to connect to OpenAI",
      message: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}

