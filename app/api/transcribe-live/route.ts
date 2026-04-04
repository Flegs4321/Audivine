/**
 * Lightweight Whisper proxy for live transcription during recording.
 * POST /api/transcribe-live
 *
 * Accepts a short audio chunk (FormData with "file" field), forwards it to
 * OpenAI Whisper, and returns plain text. No retries, no DB writes — this is
 * ephemeral live display only.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserOpenAISettings } from "@/lib/openai/user-settings";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    // --- Auth (same pattern as /api/sermons/transcribe) ---
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ error: "Server not configured" }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // --- Get user's OpenAI key ---
    const userSettings = await getUserOpenAISettings(user.id, token);

    if (!userSettings?.apiKey) {
      return NextResponse.json(
        { error: "OpenAI API key not configured" },
        { status: 400 }
      );
    }

    // --- Read audio blob from FormData ---
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
    }

    // --- Forward to OpenAI Whisper ---
    const whisperForm = new FormData();
    whisperForm.append("file", file, "chunk.webm");
    whisperForm.append("model", "whisper-1");
    whisperForm.append("response_format", "text"); // Plain text — fastest for live

    const whisperResponse = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${userSettings.apiKey}` },
        body: whisperForm,
      }
    );

    if (!whisperResponse.ok) {
      const errText = await whisperResponse.text().catch(() => "");
      console.warn("[transcribe-live] Whisper error:", whisperResponse.status, errText);
      return NextResponse.json(
        { error: `Whisper API error: ${whisperResponse.status}` },
        { status: 502 }
      );
    }

    // response_format: text returns raw string, not JSON
    const text = (await whisperResponse.text()).trim();

    return NextResponse.json({ text });
  } catch (error) {
    console.error("[transcribe-live] Unexpected error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
