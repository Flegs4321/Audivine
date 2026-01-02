/**
 * API route for uploading sermon files
 * POST /api/sermons/upload
 * Associates uploaded sermons with the authenticated user
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

export async function POST(request: NextRequest) {
  try {
    // Get token from request
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
    
    if (!token) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to upload sermons" },
        { status: 401 }
      );
    }
    
    // Create Supabase client and get user directly from token
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    
    // Get user directly from token
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to upload sermons", details: authError?.message },
        { status: 401 }
      );
    }
    
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const title = (formData.get("title") as string) || file.name;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    // Generate filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const extension = file.name.split(".").pop() || "mp3";
    const filename = `${title}-${timestamp}.${extension}`;
    const filePath = `sermons/${filename}`;

    // Convert file to blob (works in both Node.js and Edge runtime)
    const arrayBuffer = await file.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: file.type || "audio/mpeg" });

    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("Audivine")
      .upload(filePath, blob, {
        contentType: file.type || "audio/mpeg",
        upsert: false,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      return NextResponse.json(
        { error: "Failed to upload file", message: uploadError.message },
        { status: 500 }
      );
    }

    // Get public URL
    const {
      data: { publicUrl },
    } = supabase.storage.from("Audivine").getPublicUrl(filePath);

    // Get audio duration (simplified - in production you might want to extract this from the file)
    // For now, we'll set it to 0 and let the user update it later
    const duration = 0;

    // Insert into database with user_id
    const insertData: any = {
      filename: title,
      file_path: filePath,
      storage_url: publicUrl,
      duration: duration,
      segments: [],
      transcript_chunks: [],
      mime_type: file.type || "audio/mpeg",
      file_size: file.size,
      title: title,
      user_id: user.id, // Associate with the authenticated user
    };

    const { data: dbData, error: dbError } = await supabase
      .from("recordings")
      .insert(insertData)
      .select()
      .single();

    if (dbError) {
      console.error("Database insert error:", dbError);
      return NextResponse.json(
        { error: "Failed to save sermon", message: dbError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      recording: dbData,
    });
  } catch (error) {
    console.error("Upload API error:", error);
    return NextResponse.json(
      {
        error: "Upload failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

