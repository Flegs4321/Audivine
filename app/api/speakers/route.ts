/**
 * API route for managing speakers
 * GET: Fetch all speakers for the authenticated user
 * POST: Create a new speaker
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;

    if (!token) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to view speakers" },
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
        { error: "Unauthorized", message: "You must be logged in to view speakers" },
        { status: 401 }
      );
    }

    // Fetch speakers using PostgREST API (more reliable for RLS)
    // Try with tagged column first, fallback to without if column doesn't exist
    let fetchUrl = `${supabaseUrl}/rest/v1/speakers?user_id=eq.${user.id}&select=id,name,created_at,tagged&order=tagged.desc.nullslast,name.asc`;
    let fetchResponse = await fetch(fetchUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
        "Content-Type": "application/json",
      },
    });

    // If the query fails because tagged column doesn't exist, retry without it
    if (!fetchResponse.ok) {
      const errorText = await fetchResponse.text();
      try {
        const errorData = JSON.parse(errorText);
        // Check if it's a column doesn't exist error
        if (errorData.code === "42703" && errorData.message?.includes("tagged")) {
          console.log("[SPEAKERS] tagged column doesn't exist yet, fetching without it");
          // Retry without tagged column
          fetchUrl = `${supabaseUrl}/rest/v1/speakers?user_id=eq.${user.id}&select=id,name,created_at&order=name.asc`;
          fetchResponse = await fetch(fetchUrl, {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
              apikey: supabaseAnonKey,
              "Content-Type": "application/json",
            },
          });
        }
      } catch {
        // If we can't parse the error, continue with original error
      }
    }

    if (!fetchResponse.ok) {
      const errorText = await fetchResponse.text();
      console.error("[SPEAKERS] Error fetching speakers:", errorText);
      return NextResponse.json(
        { error: "Failed to fetch speakers", message: errorText },
        { status: fetchResponse.status }
      );
    }

    const speakers = await fetchResponse.json();
    
    // Add tagged: false to speakers if the column doesn't exist
    const speakersWithTagged = Array.isArray(speakers) 
      ? speakers.map((s: any) => ({ ...s, tagged: s.tagged ?? false }))
      : [];
    
    console.log("[GET /api/speakers] Fetched speakers:", speakersWithTagged);

    return NextResponse.json({
      success: true,
      speakers: speakersWithTagged,
    });
  } catch (error) {
    console.error("Get speakers API error:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch speakers",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;

    if (!token) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to create speakers" },
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
        { error: "Unauthorized", message: "You must be logged in to create speakers" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { name } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json(
        { error: "Bad request", message: "Speaker name is required" },
        { status: 400 }
      );
    }

    // Insert speaker using PostgREST API (more reliable for RLS)
    const insertUrl = `${supabaseUrl}/rest/v1/speakers`;
    const insertResponse = await fetch(insertUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
        "Content-Type": "application/json",
        "Prefer": "return=representation",
      },
      body: JSON.stringify({
        user_id: user.id,
        name: name.trim(),
      }),
    });

    if (!insertResponse.ok) {
      const errorText = await insertResponse.text();
      console.error("[SPEAKERS] Error inserting speaker:", errorText);
      
      // Check if it's a duplicate error
      if (errorText.includes("duplicate") || errorText.includes("unique")) {
        return NextResponse.json(
          { error: "Duplicate speaker", message: "A speaker with this name already exists" },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { error: "Failed to create speaker", message: errorText },
        { status: insertResponse.status }
      );
    }

    const result = await insertResponse.json();
    const speaker = Array.isArray(result) ? result[0] : result;

    return NextResponse.json({
      success: true,
      speaker,
    });
  } catch (error) {
    console.error("Create speaker API error:", error);
    return NextResponse.json(
      {
        error: "Failed to create speaker",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

