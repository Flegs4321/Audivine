/**
 * API route for updating recording segments
 * PUT /api/recordings/[id]/segments
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;

    if (!token) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to update segments" },
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
        { error: "Unauthorized", message: "You must be logged in to update segments" },
        { status: 401 }
      );
    }

    const resolvedParams = await Promise.resolve(params);
    const recordingId = resolvedParams.id;

    if (!recordingId) {
      return NextResponse.json(
        { error: "Recording ID is required" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { segments } = body;

    if (!Array.isArray(segments)) {
      return NextResponse.json(
        { error: "Bad request", message: "segments must be an array" },
        { status: 400 }
      );
    }

    // Update segments in database using PostgREST API
    const updateUrl = `${supabaseUrl}/rest/v1/recordings?id=eq.${recordingId}&user_id=eq.${user.id}`;
    const updateResponse = await fetch(updateUrl, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
        "Content-Type": "application/json",
        "Prefer": "return=representation",
      },
      body: JSON.stringify({
        segments: segments,
      }),
    });

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error("[UPDATE SEGMENTS] Error updating segments:", errorText);
      return NextResponse.json(
        { error: "Failed to update segments", message: errorText },
        { status: updateResponse.status }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Segments updated successfully",
    });
  } catch (error) {
    console.error("Update segments API error:", error);
    return NextResponse.json(
      {
        error: "Failed to update segments",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

