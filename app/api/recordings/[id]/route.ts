/**
 * API route for fetching a single recording by ID
 * GET /api/recordings/[id]
 * Returns recording with transcript_chunks and segments
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    // Get token from request
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
    
    if (!token) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to view recordings" },
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
    
    // Create Supabase client
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
    
    // Get user from token
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to view recordings", details: authError?.message },
        { status: 401 }
      );
    }
    
    // Handle async params for Next.js 15+
    const resolvedParams = await Promise.resolve(params);
    const recordingId = resolvedParams.id;
    
    if (!recordingId) {
      return NextResponse.json(
        { error: "Recording ID is required" },
        { status: 400 }
      );
    }
    
    // Fetch the recording using PostgREST API directly (for RLS)
    const fetchUrl = `${supabaseUrl}/rest/v1/recordings?id=eq.${recordingId}&user_id=eq.${user.id}&select=*`;
    
    const fetchResponse = await fetch(fetchUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': supabaseAnonKey,
        'Content-Type': 'application/json',
      },
    });
    
    if (!fetchResponse.ok) {
      const errorText = await fetchResponse.text();
      console.error("[GET Recording] Error fetching recording:", errorText);
      return NextResponse.json(
        { error: "Failed to fetch recording", message: `HTTP ${fetchResponse.status}: ${errorText}` },
        { status: fetchResponse.status }
      );
    }
    
    const recordings = await fetchResponse.json();
    const recording = Array.isArray(recordings) && recordings.length > 0 ? recordings[0] : null;
    
    if (!recording) {
      return NextResponse.json(
        { error: "Recording not found", message: `No recording found with ID: ${recordingId}` },
        { status: 404 }
      );
    }
    
    // Return the recording with transcript_chunks and segments
    return NextResponse.json({
      recording: {
        id: recording.id,
        filename: recording.filename,
        duration: recording.duration,
        transcript_chunks: recording.transcript_chunks || [],
        segments: recording.segments || [],
        created_at: recording.created_at,
        storage_url: recording.storage_url,
      }
    });
  } catch (error) {
    console.error("Get recording API error:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch recording",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

