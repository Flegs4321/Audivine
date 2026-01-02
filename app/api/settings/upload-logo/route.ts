/**
 * API route for uploading church logo
 * POST /api/settings/upload-logo
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
    
    if (!token) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to upload logo" },
        { status: 401 }
      );
    }
    
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
    // Optionally use service role key for storage operations (bypasses RLS)
    // Only use this if storage bucket RLS policies are not configured
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    
    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        { error: "Server configuration error", message: "Supabase not configured" },
        { status: 500 }
      );
    }
    
    // Create client for auth operations
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
        { error: "Unauthorized", message: "You must be logged in to upload logo" },
        { status: 401 }
      );
    }
    
    // Create storage client - use service role key if available (bypasses RLS)
    // Otherwise use anon key with user token (requires storage bucket RLS policies)
    const storageKey = supabaseServiceRoleKey || supabaseAnonKey;
    const storageClient = createClient(supabaseUrl, storageKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      // Only set Authorization header if using anon key with user token
      // Service role key doesn't need Authorization header
      ...(supabaseServiceRoleKey ? {} : {
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      }),
    });
    
    // Only set session if using anon key (not needed for service role)
    if (!supabaseServiceRoleKey) {
      const { error: sessionError } = await storageClient.auth.setSession({
        access_token: token,
        refresh_token: '',
      });
      
      if (sessionError) {
        console.error("[UPLOAD-LOGO] Error setting session:", sessionError);
        // Continue anyway - the Authorization header should work
      }
    }
    
    const formData = await request.formData();
    const file = formData.get("file") as File;
    
    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }
    
    // Validate file type
    if (!file.type.startsWith("image/")) {
      return NextResponse.json(
        { error: "File must be an image" },
        { status: 400 }
      );
    }
    
    // Generate filename with user ID to ensure each user has their own logo
    // This prevents conflicts and ensures user-specific storage
    const extension = file.name.split(".").pop() || "png";
    const filename = `church-logo-${user.id}.${extension}`;
    const filePath = `logos/${filename}`; // User-specific path: logos/church-logo-{user-id}.{ext}
    
    // Convert file to blob
    const arrayBuffer = await file.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: file.type });
    
    // Upload to Supabase Storage using the client with the user's token
    // This ensures storage bucket RLS policies can access auth.uid()
    const { data: uploadData, error: uploadError } = await storageClient.storage
      .from("Audivine")
      .upload(filePath, blob, {
        contentType: file.type,
        upsert: true, // Overwrite if exists
      });
    
    if (uploadError) {
      const errorMessage = uploadError.message || "Unknown error";
      const errorStatus = (uploadError as any).statusCode || (uploadError as any).status || null;
      
      console.error("[UPLOAD-LOGO] Upload error:", {
        error: uploadError,
        message: errorMessage,
        statusCode: errorStatus,
      });
      
      // Check if it's an RLS violation
      if (errorMessage.includes("row-level security") || errorStatus === '403' || errorStatus === 403) {
        return NextResponse.json(
          { 
            error: "Permission denied", 
            message: "Storage bucket RLS policy violation. The storage bucket 'Audivine' needs to allow authenticated users to upload files. Please check your storage bucket policies in Supabase.",
            details: errorMessage
          },
          { status: 403 }
        );
      }
      
      return NextResponse.json(
        { error: "Failed to upload logo", message: errorMessage },
        { status: 500 }
      );
    }
    
    // Get public URL
    const {
      data: { publicUrl },
    } = storageClient.storage.from("Audivine").getPublicUrl(filePath);
    
    return NextResponse.json({
      success: true,
      url: publicUrl,
      path: filePath,
    });
  } catch (error) {
    console.error("Upload logo API error:", error);
    return NextResponse.json(
      {
        error: "Upload failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

