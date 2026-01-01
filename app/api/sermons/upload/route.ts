/**
 * API route for uploading sermon files
 * POST /api/sermons/upload
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
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

    // Insert into database
    // Note: title column may not exist if migration 002 hasn't been run
    // We'll insert it if the column exists, otherwise just use filename
    const insertData: any = {
      filename: title,
      file_path: filePath,
      storage_url: publicUrl,
      duration: duration,
      segments: [],
      transcript_chunks: [],
      mime_type: file.type || "audio/mpeg",
      file_size: file.size,
    };
    
    // Try to add title if column exists (from migration 002)
    // If migration hasn't been run, this will just be ignored
    insertData.title = title;

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

