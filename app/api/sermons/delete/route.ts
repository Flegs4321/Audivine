/**
 * API route for deleting sermons
 * DELETE /api/sermons/delete
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { id } = body;

    console.log("[DELETE] Request received for ID:", id, "Type:", typeof id);

    if (!id) {
      return NextResponse.json(
        { error: "Recording ID is required" },
        { status: 400 }
      );
    }

    // First, get the recording to find the file path
    // Try to fetch the recording - log what we're searching for
    console.log("[DELETE] Searching for recording with ID:", id, "Type:", typeof id);
    
    // Use .maybeSingle() instead of .single() to handle "not found" more gracefully
    const { data: recording, error: fetchError } = await supabase
      .from("recordings")
      .select("file_path, id, filename")
      .eq("id", id)
      .maybeSingle();

    console.log("[DELETE] Fetch result:", { 
      recording: recording ? { id: recording.id, filename: recording.filename } : null, 
      error: fetchError ? {
        message: fetchError.message,
        code: fetchError.code,
        details: fetchError.details,
        hint: fetchError.hint
      } : null
    });

    if (fetchError) {
      console.error("Error fetching recording:", fetchError);
      // Check if it's a permissions/RLS issue
      if (fetchError.code === 'PGRST301' || fetchError.code === '42501' || fetchError.message?.includes('permission') || fetchError.message?.includes('policy')) {
        return NextResponse.json(
          { error: "Permission denied", message: "You don't have permission to access this recording. Check RLS policies.", details: fetchError.message, code: fetchError.code },
          { status: 403 }
        );
      }
      return NextResponse.json(
        { error: "Failed to fetch recording", message: fetchError.message, code: fetchError.code, details: fetchError.details, hint: fetchError.hint },
        { status: 500 }
      );
    }

    if (!recording) {
      console.error("Recording not found with ID:", id);
      return NextResponse.json(
        { error: "Recording not found", message: `No recording found with ID: ${id}` },
        { status: 404 }
      );
    }

    // Delete from storage if file_path exists
    if (recording.file_path) {
      const { error: storageError } = await supabase.storage
        .from("Audivine")
        .remove([recording.file_path]);

      if (storageError) {
        console.error("Error deleting from storage:", storageError);
        // Continue to delete from DB even if storage delete fails
      }
    }

    // Delete from database
    console.log("[DELETE] Attempting to delete recording with ID:", id);
    const { error: dbError, data: deleteData } = await supabase
      .from("recordings")
      .delete()
      .eq("id", id)
      .select(); // Select to see what was deleted

    console.log("[DELETE] Delete result:", { deleteData, error: dbError });

    if (dbError) {
      console.error("Error deleting from database:", dbError);
      return NextResponse.json(
        { error: "Failed to delete recording", message: dbError.message, code: dbError.code, details: dbError.details },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
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

