/**
 * API route for deleting a speaker
 * DELETE /api/speakers/[id]
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;

    if (!token) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to delete speakers" },
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
        { error: "Unauthorized", message: "You must be logged in to delete speakers" },
        { status: 401 }
      );
    }

    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: "Bad request", message: "Speaker ID is required" },
        { status: 400 }
      );
    }

    // Delete speaker using PostgREST API (more reliable for RLS)
    const deleteUrl = `${supabaseUrl}/rest/v1/speakers?id=eq.${id}&user_id=eq.${user.id}`;
    const deleteResponse = await fetch(deleteUrl, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
        "Content-Type": "application/json",
        "Prefer": "return=representation",
      },
    });

    if (!deleteResponse.ok) {
      const errorText = await deleteResponse.text();
      console.error("[SPEAKERS] Error deleting speaker:", errorText);
      return NextResponse.json(
        { error: "Failed to delete speaker", message: errorText },
        { status: deleteResponse.status }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Speaker deleted successfully",
    });
  } catch (error) {
    console.error("Delete speaker API error:", error);
    return NextResponse.json(
      {
        error: "Failed to delete speaker",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

