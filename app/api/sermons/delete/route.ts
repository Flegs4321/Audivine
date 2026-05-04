/**
 * API route for deleting sermons
 * DELETE /api/sermons/delete
 * Only allows users to delete their own recordings
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest) {
  try {
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
        {
          error: "Unauthorized",
          message: "You must be logged in to delete sermons",
          details: authError?.message,
        },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { id } = body as { id?: string };

    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "Recording ID is required" }, { status: 400 });
    }

    const { data: row, error: fetchError } = await supabase
      .from("recordings")
      .select("file_path,id,filename,user_id")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (fetchError) {
      console.error("[DELETE] Fetch error:", fetchError);
      return NextResponse.json(
        { error: "Failed to fetch recording", message: fetchError.message },
        { status: 500 }
      );
    }

    if (!row) {
      console.warn("[DELETE] No recording for id / owner:", id, user.id);
      return NextResponse.json(
        { error: "Recording not found", message: `No recording found with ID: ${id}` },
        { status: 404 }
      );
    }

    let storageDeleted = false;
    if (row.file_path) {
      const { error: storageError } = await supabase.storage.from("Audivine").remove([row.file_path]);
      if (storageError) {
        console.error("[DELETE] Storage remove:", storageError.message, row.file_path);
      } else {
        storageDeleted = true;
      }
    }

    const { data: deletedRows, error: deleteError } = await supabase
      .from("recordings")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id");

    if (deleteError) {
      console.error("[DELETE] Delete error:", deleteError);
      return NextResponse.json(
        {
          error: "Failed to delete recording",
          message: deleteError.message,
          hint:
            deleteError.code === "23503"
              ? "Another row still references this recording. Check foreign keys / migrations."
              : undefined,
        },
        { status: 500 }
      );
    }

    if (!deletedRows?.length) {
      console.warn("[DELETE] Zero rows deleted after fetch succeeded — RLS or race?", id);
      return NextResponse.json(
        {
          error: "Recording not deleted",
          message:
            "Delete did not remove any row. Check Supabase RLS policy on recordings FOR DELETE (must allow auth.uid() = user_id).",
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      storageDeleted,
      message: storageDeleted
        ? "Recording and file deleted successfully"
        : "Recording deleted from database" +
          (row.file_path ? " (storage object may already be gone)" : ""),
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
