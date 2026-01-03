/**
 * API route for deleting a speaker
 * DELETE /api/speakers/[id]
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;

    if (!token) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to update speakers" },
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
        { error: "Unauthorized", message: "You must be logged in to update speakers" },
        { status: 401 }
      );
    }

    const { id } = await params;
    const body = await request.json();
    const { tagged, name } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Bad request", message: "Speaker ID is required" },
        { status: 400 }
      );
    }

    if (tagged !== undefined && typeof tagged !== "boolean") {
      return NextResponse.json(
        { error: "Bad request", message: "tagged must be a boolean" },
        { status: 400 }
      );
    }

    if (name !== undefined && (typeof name !== "string" || !name.trim())) {
      return NextResponse.json(
        { error: "Bad request", message: "name must be a non-empty string" },
        { status: 400 }
      );
    }

    // Update speaker using PostgREST API
    const updateUrl = `${supabaseUrl}/rest/v1/speakers?id=eq.${id}&user_id=eq.${user.id}`;
    
    // Build update body with provided fields
    const updateBody: any = {};
    if (tagged !== undefined) {
      updateBody.tagged = tagged;
    }
    if (name !== undefined) {
      updateBody.name = name.trim();
    }

    const updateResponse = await fetch(updateUrl, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
        "Content-Type": "application/json",
        "Prefer": "return=representation",
      },
      body: JSON.stringify(updateBody),
    });

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error("[SPEAKERS] Error updating speaker:", errorText);
      
      // If the error is about tagged column not existing, return a helpful message
      try {
        const errorData = JSON.parse(errorText);
        if (errorData.code === "42703" && errorData.message?.includes("tagged")) {
          return NextResponse.json(
            { 
              error: "Tagged column not available", 
              message: "The tagged feature requires a database migration. Please apply migration 016_add_speaker_tagged_field.sql in your Supabase dashboard." 
            },
            { status: 400 }
          );
        }
      } catch {
        // If we can't parse the error, continue with original error
      }
      
      return NextResponse.json(
        { error: "Failed to update speaker", message: errorText },
        { status: updateResponse.status }
      );
    }

    const result = await updateResponse.json();
    const speaker = Array.isArray(result) ? result[0] : result;

    return NextResponse.json({
      success: true,
      speaker,
    });
  } catch (error) {
    console.error("Update speaker API error:", error);
    return NextResponse.json(
      {
        error: "Failed to update speaker",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

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

