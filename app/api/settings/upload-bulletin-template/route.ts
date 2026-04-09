/**
 * API route for uploading a user-specific bulletin .docx template
 * POST /api/settings/upload-bulletin-template
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function templatePathForUser(userId: string): string {
  return `bulletin-templates/${userId}/template.docx`;
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
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

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const lowerName = String(file.name || "").toLowerCase();
    const isDocx =
      file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      lowerName.endsWith(".docx");
    if (!isDocx) {
      return NextResponse.json({ error: "Template must be a .docx file" }, { status: 400 });
    }

    const storageKey = supabaseServiceRoleKey || supabaseAnonKey;
    const storageClient = createClient(supabaseUrl, storageKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      ...(supabaseServiceRoleKey
        ? {}
        : { global: { headers: { Authorization: `Bearer ${token}` } } }),
    });

    const arrayBuffer = await file.arrayBuffer();
    const blob = new Blob([arrayBuffer], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    const path = templatePathForUser(user.id);
    const { error: uploadError } = await storageClient.storage.from("Audivine").upload(path, blob, {
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: true,
    });

    if (uploadError) {
      return NextResponse.json(
        { error: "Failed to upload template", message: uploadError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, path });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Upload failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

