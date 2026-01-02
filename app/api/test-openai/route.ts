/**
 * Simple test endpoint to verify OpenAI connection
 * GET /api/test-openai
 */

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const openaiApiKey = process.env.OPENAI_API_KEY || "";

    if (!openaiApiKey) {
      return NextResponse.json({
        connected: false,
        error: "OPENAI_API_KEY not found in environment variables",
        message: "Please add OPENAI_API_KEY to your .env.local file",
      });
    }

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
    
    return NextResponse.json({
      connected: true,
      message: "OpenAI API is connected and working!",
      apiKeyPrefix: openaiApiKey.substring(0, 7) + "...", // Show first 7 chars for verification
      availableModels: models.data?.slice(0, 5).map((m: any) => m.id) || [],
    });
  } catch (error) {
    return NextResponse.json({
      connected: false,
      error: "Failed to connect to OpenAI",
      message: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}

