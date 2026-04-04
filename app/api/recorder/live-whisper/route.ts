/**
 * POST /api/recorder/live-whisper
 * Transcribes a short audio slice (e.g. MediaRecorder timeslice) for live captions
 * while recording. Uses the user's OpenAI API key from settings.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserOpenAISettings } from "@/lib/openai/user-settings";

export const runtime = "nodejs";

const MIN_BYTES = 1800;
const MAX_BYTES = 12 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;

    if (!token) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in" },
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

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized", message: "Invalid session" },
        { status: 401 }
      );
    }

    const userSettings = await getUserOpenAISettings(user.id, token);
    if (!userSettings?.apiKey) {
      return NextResponse.json(
        {
          error: "OpenAI not configured",
          message: "Add your OpenAI API key in Settings to use live Whisper captions.",
        },
        { status: 400 }
      );
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json(
        { error: "Bad request", message: "Expected multipart field \"file\"" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length < MIN_BYTES) {
      return NextResponse.json({ text: "", skipped: true });
    }
    if (buffer.length > MAX_BYTES) {
      return NextResponse.json(
        { error: "Payload too large", message: "Audio slice exceeds maximum size" },
        { status: 400 }
      );
    }

    const mime = file.type || "audio/webm";
    const openaiForm = new FormData();
    openaiForm.append("file", new Blob([new Uint8Array(buffer)], { type: mime }), "slice.webm");
    openaiForm.append("model", "whisper-1");
    openaiForm.append("response_format", "json");

    const openaiRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${userSettings.apiKey}` },
      body: openaiForm,
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      return NextResponse.json(
        { error: "Transcription failed", message: errText || openaiRes.statusText },
        { status: openaiRes.status >= 500 ? 502 : 400 }
      );
    }

    const data = (await openaiRes.json()) as { text?: string };
    const text = typeof data.text === "string" ? data.text.trim() : "";

    return NextResponse.json({ text, skipped: false });
  } catch (e) {
    console.error("[live-whisper]", e);
    return NextResponse.json(
      { error: "Internal error", message: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
