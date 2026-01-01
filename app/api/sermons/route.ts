/**
 * API route for fetching sermons
 * GET /api/sermons
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    // Fetch all recordings from Supabase (including those from recorder page and sermons upload)
    // Note: title column may not exist if migration 002 hasn't been run, so we'll select it conditionally
    const { data, error } = await supabase
      .from("recordings")
      .select("id, filename, duration, created_at, storage_url, file_path")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Database query error:", error);
      return NextResponse.json(
        { error: "Failed to fetch sermons", message: error.message, details: error },
        { status: 500 }
      );
    }

    // Map the data to include title (use filename if title doesn't exist)
    const sermons = (data || []).map((recording: any) => ({
      id: recording.id,
      title: recording.title || recording.filename || "Untitled",
      filename: recording.filename,
      duration: recording.duration || 0,
      created_at: recording.created_at,
      storage_url: recording.storage_url,
      file_path: recording.file_path,
    }));

    return NextResponse.json({ sermons });
  } catch (error) {
    console.error("Sermons API error:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch sermons",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

