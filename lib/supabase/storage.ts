import { supabase } from "./client";

export interface RecordingMetadata {
  filename: string;
  duration: number; // in seconds
  segments: Array<{
    type: string;
    startMs: number;
    endMs: number | null;
  }>;
  transcriptChunks: Array<{
    text: string;
    timestampMs: number;
    isFinal: boolean;
  }>;
  mimeType: string;
  fileSize: number; // in bytes
}

export interface UploadResult {
  success: boolean;
  url?: string;
  path?: string;
  recordingId?: string;
  error?: string;
}

/**
 * Upload audio recording to Supabase Storage
 */
export async function uploadRecording(
  audioBlob: Blob,
  metadata: RecordingMetadata
): Promise<UploadResult> {
  try {
    // Check if Supabase is configured
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseKey || supabaseUrl.includes("placeholder")) {
      return {
        success: false,
        error: "Supabase is not configured. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables.",
      };
    }

    // Generate unique filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const extension = metadata.mimeType.includes("webm")
      ? "webm"
      : metadata.mimeType.includes("ogg")
      ? "ogg"
      : "mp4";
    const filename = `${metadata.filename}-${timestamp}.${extension}`;
    const filePath = `recordings/${filename}`;

    // Upload audio file to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("Audivine")
      .upload(filePath, audioBlob, {
        contentType: metadata.mimeType,
        upsert: false, // Don't overwrite existing files
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      return {
        success: false,
        error: uploadError.message,
      };
    }

    // Get public URL for the uploaded file
    const {
      data: { publicUrl },
    } = supabase.storage.from("Audivine").getPublicUrl(filePath);

    // Store metadata in the database
    const { data: dbData, error: dbError } = await supabase
      .from("recordings")
      .insert({
        filename: metadata.filename,
        file_path: filePath,
        storage_url: publicUrl,
        duration: metadata.duration,
        segments: metadata.segments,
        transcript_chunks: metadata.transcriptChunks,
        mime_type: metadata.mimeType,
        file_size: metadata.fileSize,
      })
      .select()
      .single();

    if (dbError) {
      console.error("Database insert error:", dbError);
      // Still return success for storage upload, but log the DB error
      // You might want to handle this differently based on your needs
    }

    return {
      success: true,
      url: publicUrl,
      path: filePath,
      recordingId: dbData?.id,
    };
  } catch (error) {
    console.error("Error uploading recording:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

/**
 * Get public URL for a recording
 */
export function getRecordingUrl(filePath: string): string {
  const {
    data: { publicUrl },
  } = supabase.storage.from("Audivine").getPublicUrl(filePath);
  return publicUrl;
}

/**
 * Get all recordings from the database
 */
export async function getAllRecordings() {
  const { data, error } = await supabase
    .from("recordings")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching recordings:", error);
    throw error;
  }

  return data;
}

/**
 * Get a single recording by ID
 */
export async function getRecordingById(id: string) {
  const { data, error } = await supabase
    .from("recordings")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    console.error("Error fetching recording:", error);
    throw error;
  }

  return data;
}

/**
 * Delete a recording (both from database and storage)
 */
export async function deleteRecording(id: string) {
  // First, get the recording to find the file path
  const recording = await getRecordingById(id);

  // Delete from storage
  const { error: storageError } = await supabase.storage
    .from("Audivine")
    .remove([recording.file_path]);

  if (storageError) {
    console.error("Error deleting from storage:", storageError);
    // Continue to delete from DB even if storage delete fails
  }

  // Delete from database
  const { error: dbError } = await supabase
    .from("recordings")
    .delete()
    .eq("id", id);

  if (dbError) {
    console.error("Error deleting from database:", dbError);
    throw dbError;
  }

  return { success: true };
}

