/**
 * Sermons Library Page
 * - Upload new sermon files
 * - View all sermons
 */

"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../auth/context/AuthProvider";
import Header from "../components/Header";
import SermonAudioPlayer from "../components/SermonAudioPlayer";
import { downloadBlob, sanitizeFilename, urlToMp3 } from "@/lib/audio/encode-mp3";
import { runSermonTranscription } from "@/lib/sermons/run-transcription-client";
import { hasCompleteBackedTranscript } from "@/lib/transcript/whisper-backed-stats";

interface Sermon {
  id: string;
  title: string | null;
  filename: string;
  duration: number;
  created_at: string;
  storage_url?: string;
  file_path?: string;
  sermon_date?: string | null;
  sermon_time?: string | null;
  speaker?: string | null;
  transcript_chunks?: Array<{
    text: string;
    timestampMs: number;
    isFinal?: boolean;
    speaker?: string;
    speakerTag?: boolean;
    source?: "whisper" | "whisper-live";
  }>;
}

interface Speaker {
  id: string;
  name: string;
  created_at: string;
}

/** Slightly tighter than px-4 py-2 but same labels/readability as the original row actions. */
const sermonRowActionClass =
  "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50";

/** Plain transcript for export: omit speaker-tag marker lines so the file reads like speech + captions. */
function transcriptChunksToPlainText(
  chunks: NonNullable<Sermon["transcript_chunks"]>
): string {
  return [...chunks]
    .filter((c) => {
      if (!c.text?.trim()) return false;
      if (c.speakerTag) return false;
      return true;
    })
    .sort((a, b) => (a.timestampMs ?? 0) - (b.timestampMs ?? 0))
    .map((c) => c.text.trim())
    .join("\n\n");
}

export default function SermonsPage() {
  const router = useRouter();
  const { user, signOut, loading: authLoading } = useAuth();
  const [sermons, setSermons] = useState<Sermon[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Sermon>>({});
  const [saving, setSaving] = useState(false);
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [loadingSpeakers, setLoadingSpeakers] = useState(false);
  const [mp3DownloadingId, setMp3DownloadingId] = useState<string | null>(null);
  const [mp3Progress, setMp3Progress] = useState<number>(0);
  const [transcriptWorkingId, setTranscriptWorkingId] = useState<string | null>(null);
  const [transcriptStatus, setTranscriptStatus] = useState<string | null>(null);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login?redirect=/sermons");
    }
  }, [user, authLoading, router]);

  const loadSpeakers = useCallback(async () => {
    try {
      setLoadingSpeakers(true);
      const { supabase } = await import("@/lib/supabase/client");
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session?.access_token) return;

      const response = await fetch("/api/speakers", {
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setSpeakers(data.speakers || []);
      }
    } catch (err) {
      console.error("Error loading speakers:", err);
    } finally {
      setLoadingSpeakers(false);
    }
  }, []);

  const loadSermons = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      console.log("[Client] Fetching sermons...");
      
      const { supabase } = await import("@/lib/supabase/client");
      const { data: { session } } = await supabase.auth.getSession();
      
      const headers: HeadersInit = {
        "Cache-Control": "no-cache",
      };
      
      if (session?.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
        console.log("[Client] Added auth token to request");
      } else {
        console.warn("[Client] No session token available");
      }
      
      const response = await fetch(`/api/sermons?_=${Date.now()}`, {
        cache: "no-store",
        headers: headers,
      });
      
      console.log("[Client] Response status:", response.status, response.statusText);
      
      if (response.ok) {
        const data = await response.json();
        console.log("[Client] Loaded sermons:", data.sermons?.length || 0);
        setSermons(data.sermons || []);
      } else {
        let errorText = "";
        try {
          errorText = await response.text();
          console.log("[Client] Error response body:", errorText);
        } catch (e) {
          console.error("[Client] Could not read error response:", e);
          errorText = `HTTP ${response.status}: ${response.statusText}`;
        }
        
        let errorData: any = {};
        if (errorText) {
          try {
            errorData = JSON.parse(errorText);
          } catch (e) {
            errorData = { error: errorText, message: errorText };
          }
        } else {
          errorData = { 
            error: `HTTP ${response.status}: ${response.statusText}`,
            message: `Server returned ${response.status} ${response.statusText}`
          };
        }
        
        console.error("[Client] HTTP Status:", response.status);
        console.error("[Client] Error Data:", errorData);
        
        const errorMessage = errorData.error || errorData.message || `Failed to load sermons (HTTP ${response.status})`;
        console.error("[Client] Setting error message:", errorMessage);
        setError(errorMessage);
      }
    } catch (err) {
      console.error("[Client] Exception loading sermons:", err);
      setError(err instanceof Error ? err.message : "Failed to load sermons. Please check your Supabase connection.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) {
      void loadSermons();
      void loadSpeakers();
    }
  }, [user, loadSermons, loadSpeakers]);

  useEffect(() => {
    if (!user) return;
    const refresh = () => void loadSermons();
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [user, loadSermons]);

  const handleFileUpload = async () => {
    if (!uploadFile) return;

    setUploading(true);
    setError(null);

    try {
      // Get the session token from Supabase client
      const { supabase } = await import("@/lib/supabase/client");
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session?.access_token) {
        throw new Error("Not authenticated. Please log in to upload sermons.");
      }

      const formData = new FormData();
      formData.append("file", uploadFile);
      formData.append("title", uploadFile.name.replace(/\.[^/.]+$/, "")); // Remove extension

      const response = await fetch("/api/sermons/upload", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Upload failed", message: `HTTP ${response.status}: ${response.statusText}` }));
        const errorMessage = errorData.message || errorData.error || `Upload failed: ${response.status} ${response.statusText}`;
        throw new Error(errorMessage);
      }

      // Reload sermons from Supabase
      await loadSermons();
      setUploadFile(null);
      setError(null); // Clear any previous errors
      alert("Sermon uploaded successfully to Supabase!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      console.error("Upload error:", err);
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteSermon = async (id: string, title: string) => {
    if (!confirm(`Are you sure you want to delete "${title}"? This action cannot be undone.`)) {
      return;
    }

    console.log("Deleting sermon with ID:", id, "Type:", typeof id);

    setError(null);

    try {
      // Get the session token from Supabase client
      const { supabase } = await import("@/lib/supabase/client");
      const { data: { session } } = await supabase.auth.getSession();
      
      const headers: HeadersInit = {
        "Content-Type": "application/json",
      };
      
      // Add authorization header if we have a session
      if (session?.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
      }
      
      console.log("Sending delete request to /api/sermons/delete with ID:", id);
      const response = await fetch("/api/sermons/delete", {
        method: "DELETE",
        headers: headers,
        body: JSON.stringify({ id }),
      });

      console.log("Delete response status:", response.status, response.statusText);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error || errorData.message || `Delete failed: ${response.status} ${response.statusText}`;
        console.error("Delete API error:", errorData);
        
        // If the recording wasn't found (404), it might have already been deleted
        // Just refresh the list silently instead of showing an error
        if (response.status === 404) {
          console.log("Recording not found - may have been already deleted, refreshing list...");
          await loadSermons();
          return; // Exit early, no error shown
        }
        
        // Reload sermons to restore the optimistic update if delete failed
        await loadSermons();
        throw new Error(errorMessage);
      }

      // Refresh from Supabase to ensure consistency
      await loadSermons();
    } catch (err) {
      // If delete failed, reload to restore the sermon
      await loadSermons();
      const errorMessage = err instanceof Error ? err.message : "Failed to delete sermon";
      setError(errorMessage);
      console.error("Delete error:", err);
      // Only show alert for non-404 errors
      if (!errorMessage.includes("not found")) {
        alert(`Failed to delete: ${errorMessage}`);
      }
    }
  };

  const handleEditSermon = (sermon: Sermon) => {
    setEditingId(sermon.id);
    setEditForm({
      title: sermon.title || "",
      filename: sermon.filename || "",
      sermon_date: sermon.sermon_date || "",
      sermon_time: sermon.sermon_time || "",
      speaker: sermon.speaker || "",
    });
    // Refresh speakers list when opening edit form (in case new ones were added in Settings)
    loadSpeakers();
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  const handleSaveEdit = async (sermonId: string) => {
    setSaving(true);
    setError(null);

    try {
      const { supabase } = await import("@/lib/supabase/client");
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session?.access_token) {
        throw new Error("Not authenticated");
      }

      const response = await fetch("/api/sermons/update", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          id: sermonId,
          ...editForm,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.message || errorData.error || "Failed to update sermon";
        
        // Show a helpful message if migration is needed
        if (errorData.error === "Database migration required") {
          alert(`Database migration required!\n\n${errorMessage}\n\nPlease apply the migration file: supabase/migrations/008_add_sermon_metadata_fields.sql`);
        }
        
        throw new Error(errorMessage);
      }

      // Reload sermons
      await loadSermons();
      setEditingId(null);
      setEditForm({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update sermon");
      console.error("Update error:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleTranscriptionDownload = async (sermon: Sermon) => {
    if (!sermon.storage_url) {
      setError("This sermon has no audio file to transcribe.");
      return;
    }
    if (transcriptWorkingId !== null) return;

    const baseName = sanitizeFilename(
      sermon.title || sermon.filename?.replace(/\.[^/.]+$/, "") || `sermon-${sermon.id}`
    );

    const chunksUnknown = sermon.transcript_chunks as unknown[] | undefined;
    const hasFullBacked =
      chunksUnknown?.length &&
      hasCompleteBackedTranscript(chunksUnknown, sermon.duration ?? 0);

    if (hasFullBacked && sermon.transcript_chunks) {
      const text = transcriptChunksToPlainText(sermon.transcript_chunks);
      if (!text.trim()) {
        setError("Saved transcript is empty; try transcribing again.");
        return;
      }
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      downloadBlob(blob, `${baseName} transcription.txt`);
      setError(null);
      return;
    }

    setTranscriptWorkingId(sermon.id);
    setTranscriptStatus(null);
    setError(null);

    try {
      const { supabase } = await import("@/lib/supabase/client");
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Not authenticated. Please log in.");
      }

      const chunks = await runSermonTranscription({
        recordingId: sermon.id,
        storageUrl: sermon.storage_url,
        accessToken: session.access_token,
        onStatus: (status) => setTranscriptStatus(status),
      });

      const text = transcriptChunksToPlainText(chunks);
      if (!text.trim()) {
        throw new Error("Transcription returned no text.");
      }

      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      downloadBlob(blob, `${baseName} transcription.txt`);
      // Match saved transcript locally so the list stays accurate without reloading everything else.
      setSermons((prev) =>
        prev.map((s) =>
          s.id === sermon.id
            ? {
                ...s,
                transcript_chunks: chunks.map((c) => ({
                  text: c.text,
                  timestampMs: c.timestampMs,
                  isFinal: c.isFinal ?? true,
                  speaker: c.speaker,
                  speakerTag: c.speakerTag,
                  ...(c.source ? { source: c.source } : {}),
                })),
              }
            : s
        )
      );
    } catch (err) {
      console.error("Transcription download error:", err);
      setError(err instanceof Error ? err.message : "Transcription failed.");
    } finally {
      setTranscriptWorkingId(null);
      setTranscriptStatus(null);
    }
  };

  const handleDownloadMp3 = async (sermon: Sermon) => {
    if (!sermon.storage_url) {
      setError("This sermon has no audio file available to download.");
      return;
    }
    if (mp3DownloadingId) return; // Don't allow concurrent conversions

    setMp3DownloadingId(sermon.id);
    setMp3Progress(0);
    setError(null);

    try {
      const baseName = sanitizeFilename(
        sermon.title || sermon.filename?.replace(/\.[^/.]+$/, "") || `sermon-${sermon.id}`
      );
      const mp3Blob = await urlToMp3(sermon.storage_url, {
        bitrateKbps: 128,
        onProgress: (p) => setMp3Progress(p),
      });
      downloadBlob(mp3Blob, `${baseName}.mp3`);
    } catch (err) {
      console.error("MP3 download error:", err);
      setError(err instanceof Error ? err.message : "Failed to convert sermon to MP3.");
    } finally {
      setMp3DownloadingId(null);
      setMp3Progress(0);
    }
  };

  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
    return `${minutes}:${secs.toString().padStart(2, "0")}`;
  };

  const formatTimestamp = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  // Show loading state while checking authentication
  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-teal-600" />
          <p className="text-sm text-slate-600">Loading…</p>
        </div>
      </div>
    );
  }

  // Don't render if not authenticated (will redirect)
  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Header />

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h2 className="text-3xl font-semibold tracking-tight text-slate-900">Sermons library</h2>
          <p className="mt-1 text-slate-600">Upload and manage sermon recordings</p>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-6 rounded-xl border border-red-200/80 bg-red-50/90 p-4">
            <p className="text-red-800">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Upload Section */}
          <div className="lg:col-span-1">
            <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-xl font-semibold text-slate-900">Upload sermon</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Audio File
                  </label>
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                    className="block w-full text-sm text-slate-500 file:mr-4 file:rounded-lg file:border-0 file:bg-teal-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-teal-900 hover:file:bg-teal-100"
                  />
                </div>
                {uploadFile && (
                  <div className="text-sm text-slate-600">
                    Selected: {uploadFile.name} ({(uploadFile.size / 1024 / 1024).toFixed(2)} MB)
                  </div>
                )}
                <button
                  onClick={handleFileUpload}
                  disabled={!uploadFile || uploading}
                  className="w-full rounded-xl bg-teal-600 px-6 py-2.5 text-white shadow-sm hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {uploading ? "Uploading..." : "Upload Sermon"}
                </button>
              </div>
            </div>
          </div>

          {/* Library Section */}
          <div className="lg:col-span-2">
            <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-200 p-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-slate-900">
                    All sermons ({sermons.length})
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Loaded live from Supabase — refreshes when you open this tab or click refresh.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void loadSermons()}
                  disabled={loading || !user}
                  className={sermonRowActionClass}
                  title="Reload the sermon list from the database"
                >
                  {loading ? "Loading…" : "Refresh list"}
                </button>
              </div>
              {loading ? (
                <div className="p-6 text-center text-slate-500">Loading...</div>
              ) : sermons.length === 0 ? (
                <div className="p-6 text-center text-slate-500">
                  No sermons found. Upload a sermon to get started.
                </div>
              ) : (
                <div className="divide-y divide-slate-200">
                  {sermons.map((sermon) => (
                    <div key={sermon.id} className="p-6 hover:bg-slate-50">
                      {editingId === sermon.id ? (
                        <div className="space-y-4">
                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">
                              Title
                            </label>
                            <input
                              type="text"
                              value={editForm.title || ""}
                              onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                              className="w-full px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-teal-500/40"
                              placeholder="Sermon title"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">
                              Recording Name (Filename)
                            </label>
                            <input
                              type="text"
                              value={editForm.filename || ""}
                              onChange={(e) => setEditForm({ ...editForm, filename: e.target.value })}
                              className="w-full px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-teal-500/40"
                              placeholder="Recording filename"
                            />
                            <p className="mt-1 text-xs text-slate-500">This is the original filename. Changing it won't rename the file in storage.</p>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="block text-sm font-medium text-slate-700 mb-1">
                                Date
                              </label>
                              <input
                                type="date"
                                value={editForm.sermon_date || ""}
                                onChange={(e) => setEditForm({ ...editForm, sermon_date: e.target.value })}
                                className="w-full px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-teal-500/40"
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-slate-700 mb-1">
                                Time
                              </label>
                              <input
                                type="time"
                                value={editForm.sermon_time || ""}
                                onChange={(e) => setEditForm({ ...editForm, sermon_time: e.target.value })}
                                className="w-full px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-teal-500/40"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">
                              Speaker
                            </label>
                            <select
                              value={editForm.speaker || ""}
                              onChange={(e) => setEditForm({ ...editForm, speaker: e.target.value })}
                              className="w-full px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-teal-500/40"
                            >
                              <option value="">Select a speaker...</option>
                              {speakers.map((speaker) => (
                                <option key={speaker.id} value={speaker.name}>
                                  {speaker.name}
                                </option>
                              ))}
                            </select>
                            {speakers.length === 0 && (
                              <p className="mt-1 text-xs text-slate-500">
                                No speakers available. <Link href="/settings" className="text-blue-600 hover:underline">Add speakers in Settings</Link>
                              </p>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleSaveEdit(sermon.id)}
                              disabled={saving}
                              className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 text-sm"
                            >
                              {saving ? "Saving..." : "Save"}
                            </button>
                            <button
                              onClick={handleCancelEdit}
                              disabled={saving}
                              className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 disabled:opacity-50 text-sm"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex flex-col gap-4">
                            <div className="min-w-0 w-full">
                              <h3 className="text-lg font-semibold text-slate-900 break-words">
                                {sermon.title || sermon.filename}
                              </h3>
                              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
                                <span>{formatDuration(sermon.duration)}</span>
                                {sermon.sermon_date && (
                                  <span>{new Date(sermon.sermon_date).toLocaleDateString()}</span>
                                )}
                                {sermon.sermon_time && (
                                  <span>{sermon.sermon_time}</span>
                                )}
                                {sermon.speaker && (
                                  <span className="font-medium">{sermon.speaker}</span>
                                )}
                                <span className="text-xs text-slate-400">
                                  Recorded: {formatTimestamp(sermon.created_at)}
                                </span>
                              </div>
                            </div>
                            <div className="flex w-full flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => handleEditSermon(sermon)}
                                className={sermonRowActionClass}
                              >
                                Edit details
                              </button>
                              {sermon.storage_url && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => setPlayingId(playingId === sermon.id ? null : sermon.id)}
                                    className={sermonRowActionClass}
                                  >
                                    {playingId === sermon.id ? "Hide Player" : "Play"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => router.push(`/recorder/review?id=${sermon.id}`)}
                                    className={sermonRowActionClass}
                                    title="Transcript, tags, segments, and summaries"
                                  >
                                    Review
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDownloadMp3(sermon)}
                                    disabled={mp3DownloadingId !== null}
                                    className={sermonRowActionClass}
                                    title="Convert and download this recording as an MP3 file"
                                  >
                                    {mp3DownloadingId === sermon.id
                                      ? `Converting… ${Math.round(mp3Progress * 100)}%`
                                      : "Download MP3"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleTranscriptionDownload(sermon)}
                                    disabled={transcriptWorkingId !== null}
                                    className={sermonRowActionClass}
                                    title="Downloads spoken transcript text (.txt). Speaker-tag-only captions don’t count — if you only see tags or short previews from live captions, this runs Whisper on your recording (same as Review). Large files split automatically; uses your OpenAI key in Settings."
                                  >
                                    {transcriptWorkingId === sermon.id
                                      ? "Transcribing…"
                                      : "Download transcript (.txt)"}
                                  </button>
                                </>
                              )}
                              <button
                                type="button"
                                onClick={() => handleDeleteSermon(sermon.id, sermon.title || sermon.filename)}
                                className={sermonRowActionClass}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                      {editingId !== sermon.id &&
                        transcriptWorkingId === sermon.id &&
                        transcriptStatus && (
                          <p className="mt-2 text-sm text-slate-600">{transcriptStatus}</p>
                        )}
                      {/* Audio Player */}
                      {playingId === sermon.id && sermon.storage_url && (
                        <div className="mt-4 pt-4 border-t border-slate-200">
                          <SermonAudioPlayer
                            src={sermon.storage_url}
                            knownDuration={sermon.duration}
                            autoPlay
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

