/**
 * API route for deleting sermons
 * DELETE /api/sermons/delete
 * Only allows users to delete their own sermons
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const runtime = "nodejs";

async function getSupabaseClient() {
  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  
  // Supabase stores cookies with pattern: sb-<project-ref>-auth-token
  // Extract project ref from URL
  const urlParts = supabaseUrl.replace('https://', '').replace('http://', '').split('.');
  const projectRef = urlParts[0] || '';
  
  // Get all cookies that might contain the session
  const allCookies = cookieStore.getAll();
  let accessToken: string | null = null;
  let refreshToken: string | null = null;
  
  // Look for the auth token cookie
  for (const cookie of allCookies) {
    if (cookie.name.includes('auth-token')) {
      try {
        const sessionData = JSON.parse(cookie.value);
        if (sessionData.access_token) {
          accessToken = sessionData.access_token;
          refreshToken = sessionData.refresh_token || null;
          break;
        }
      } catch (e) {
        // Not JSON, continue
      }
    }
  }
  
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  
  // Set session if we found tokens
  if (accessToken) {
    try {
      await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken || '',
      });
    } catch (e) {
      console.error("Error setting session:", e);
    }
  }
  
  return supabase;
}

export async function DELETE(request: NextRequest) {
  try {
    // Get token from request
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
    
    if (!token) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to delete sermons" },
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
    
    // Create Supabase client to get user and for storage operations
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
    
    // Get user directly from token
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to delete sermons", details: authError?.message },
        { status: 401 }
      );
    }
    
    // Set session for storage operations (required for authenticated storage access)
    await supabase.auth.setSession({
      access_token: token,
      refresh_token: '', // Not needed for storage operations
    });
    
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Recording ID is required" },
        { status: 400 }
      );
    }

    // Fetch the recording using PostgREST API directly (for RLS)
    const fetchUrl = `${supabaseUrl}/rest/v1/recordings?id=eq.${id}&user_id=eq.${user.id}&select=file_path,id,filename,user_id`;
    
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
      console.error("[DELETE] Error fetching recording:", errorText);
      return NextResponse.json(
        { error: "Failed to fetch recording", message: `HTTP ${fetchResponse.status}: ${errorText}` },
        { status: fetchResponse.status }
      );
    }

    const recordings = await fetchResponse.json();
    const recording = Array.isArray(recordings) && recordings.length > 0 ? recordings[0] : null;

    console.log("[DELETE] Fetch result:", { 
      recording: recording ? { id: recording.id, filename: recording.filename } : null
    });

    if (!recording) {
      console.error("Recording not found with ID:", id);
      return NextResponse.json(
        { error: "Recording not found", message: `No recording found with ID: ${id}` },
        { status: 404 }
      );
    }

    // Delete from storage if file_path exists
    let storageDeleted = false;
    if (recording.file_path) {
      console.log("[DELETE] Attempting to delete file from storage:", recording.file_path);
      const { error: storageError } = await supabase.storage
        .from("Audivine")
        .remove([recording.file_path]);

      if (storageError) {
        console.error("[DELETE] Error deleting from storage:", {
          error: storageError,
          message: storageError.message,
          file_path: recording.file_path
        });
        // Continue to delete from DB even if storage delete fails
        // (file might already be deleted or not exist)
      } else {
        storageDeleted = true;
        console.log("[DELETE] Successfully deleted file from storage:", recording.file_path);
      }
    } else {
      console.warn("[DELETE] No file_path found for recording, skipping storage deletion");
    }

    // Delete from database using PostgREST API directly (for RLS)
    console.log("[DELETE] Attempting to delete recording with ID:", id);
    const deleteUrl = `${supabaseUrl}/rest/v1/recordings?id=eq.${id}`;
    
    const deleteResponse = await fetch(deleteUrl, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': supabaseAnonKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
    });

    if (!deleteResponse.ok) {
      const errorText = await deleteResponse.text();
      console.error("[DELETE] Error deleting from database:", errorText);
      return NextResponse.json(
        { error: "Failed to delete recording", message: `HTTP ${deleteResponse.status}: ${errorText}` },
        { status: deleteResponse.status }
      );
    }

    const deleteData = await deleteResponse.json();
    console.log("[DELETE] Delete result:", { 
      deleteData,
      storageDeleted,
      file_path: recording.file_path 
    });

    return NextResponse.json({ 
      success: true,
      storageDeleted,
      message: storageDeleted 
        ? "Recording and file deleted successfully" 
        : "Recording deleted from database" + (recording.file_path ? " (storage deletion may have failed)" : "")
    });
  } catch (error) {
    console.error("Delete API error:", error);
    return NextResponse.json(
      {
        error: "Delete failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

