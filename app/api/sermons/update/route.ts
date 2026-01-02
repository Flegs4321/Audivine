/**
 * API route for updating sermon metadata
 * PUT /api/sermons/update
 * Updates title, sermon_date, sermon_time, and speaker for a recording
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function PUT(request: NextRequest) {
  try {
    // Get token from request
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
    
    if (!token) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to update sermons" },
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
        { error: "Unauthorized", message: "You must be logged in to update sermons", details: authError?.message },
        { status: 401 }
      );
    }
    
    const body = await request.json();
    const { id, title, filename, sermon_date, sermon_time, speaker } = body;
    
    if (!id) {
      return NextResponse.json(
        { error: "Recording ID is required" },
        { status: 400 }
      );
    }
    
    // Update the recording using PostgREST API directly (for RLS)
    const updateUrl = `${supabaseUrl}/rest/v1/recordings?id=eq.${id}`;
    
    // Build update data - only include fields that are provided
    const updateData: any = {};
    if (title !== undefined) updateData.title = title || null;
    if (filename !== undefined) updateData.filename = filename || null;
    
    // Only include new fields if they're provided (they may not exist in DB yet if migration not applied)
    // We'll try to update them, but handle errors gracefully
    if (sermon_date !== undefined) updateData.sermon_date = sermon_date || null;
    if (sermon_time !== undefined) updateData.sermon_time = sermon_time || null;
    if (speaker !== undefined) updateData.speaker = speaker || null;
    
    const updateResponse = await fetch(updateUrl, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': supabaseAnonKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify(updateData),
    });
    
    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error("[UPDATE] Error updating recording:", errorText);
      
      // Check if error is due to missing columns (migration not applied)
      if (errorText.includes("Could not find") && errorText.includes("column")) {
        return NextResponse.json(
          { 
            error: "Database migration required", 
            message: "Please apply the migration 008_add_sermon_metadata_fields.sql to add the sermon metadata columns (sermon_date, sermon_time, speaker) to your database.",
            details: errorText
          },
          { status: 400 }
        );
      }
      
      return NextResponse.json(
        { error: "Failed to update recording", message: `HTTP ${updateResponse.status}: ${errorText}` },
        { status: updateResponse.status }
      );
    }
    
    const updateResult = await updateResponse.json();
    console.log("[UPDATE] Update result:", updateResult);
    
    return NextResponse.json({ success: true, recording: Array.isArray(updateResult) ? updateResult[0] : updateResult });
  } catch (error) {
    console.error("Update API error:", error);
    return NextResponse.json(
      {
        error: "Update failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

