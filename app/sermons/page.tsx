/**
 * Sermons Library Page
 * - Upload new sermon files
 * - View all sermons
 */

"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../auth/context/AuthProvider";

interface Sermon {
  id: string;
  title: string | null;
  filename: string;
  duration: number;
  created_at: string;
  storage_url?: string;
  file_path?: string;
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

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login?redirect=/sermons");
    }
  }, [user, authLoading, router]);

  // Load sermons from database
  useEffect(() => {
    if (user) {
      loadSermons();
    }
  }, [user]);

  const loadSermons = async () => {
    try {
      setLoading(true);
      setError(null);
      
      console.log("[Client] Fetching sermons...");
      
      // Get the session token from Supabase client
      const { supabase } = await import("@/lib/supabase/client");
      const { data: { session } } = await supabase.auth.getSession();
      
      const headers: HeadersInit = {
        "Cache-Control": "no-cache",
      };
      
      // Add authorization header if we have a session
      if (session?.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
        console.log("[Client] Added auth token to request");
      } else {
        console.warn("[Client] No session token available");
      }
      
      // Add cache-busting to ensure fresh data
      const response = await fetch("/api/sermons", {
        cache: "no-store",
        headers: headers,
      });
      
      console.log("[Client] Response status:", response.status, response.statusText);
      console.log("[Client] Response headers:", Object.fromEntries(response.headers.entries()));
      
      if (response.ok) {
        const data = await response.json();
        console.log("[Client] Loaded sermons:", data.sermons?.length || 0);
        setSermons(data.sermons || []);
      } else {
        // Try to get error text
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
            // Not JSON, use as plain text
            errorData = { error: errorText, message: errorText };
          }
        } else {
          errorData = { 
            error: `HTTP ${response.status}: ${response.statusText}`,
            message: `Server returned ${response.status} ${response.statusText}`
          };
        }
        
        // Log each piece separately for better visibility
        console.error("[Client] HTTP Status:", response.status);
        console.error("[Client] Status Text:", response.statusText);
        console.error("[Client] Error Text:", errorText);
        console.error("[Client] Error Data:", errorData);
        console.error("[Client] Full error object:", {
          status: response.status,
          statusText: response.statusText,
          errorText: errorText,
          errorData: errorData
        });
        
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
  };

  const handleFileUpload = async () => {
    if (!uploadFile) return;

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", uploadFile);
      formData.append("title", uploadFile.name.replace(/\.[^/.]+$/, "")); // Remove extension

      const response = await fetch("/api/sermons/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Upload failed");
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

    // Optimistically remove from UI immediately
    setSermons((prev) => prev.filter((sermon) => sermon.id !== id));
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

  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
    return `${minutes}:${secs.toString().padStart(2, "0")}`;
  };

  // Show loading state while checking authentication
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Don't render if not authenticated (will redirect)
  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto py-4 flex items-center justify-between gap-4 px-6">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              Home
            </Link>
            <Link
              href="/recorder"
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Record
            </Link>
            <Link
              href="/sermons"
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              Sermons Library
            </Link>
            <h1 className="text-3xl font-bold text-gray-900">Audivine</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">{user.email}</span>
            <button
              onClick={signOut}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto p-6">
        <div className="mb-6">
          <h2 className="text-3xl font-bold text-gray-900 mb-2">Sermons Library</h2>
          <p className="text-gray-600">Upload and manage your sermon recordings</p>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Upload Section */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-xl font-semibold mb-4">Upload Sermon</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Audio File
                  </label>
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                    className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                  />
                </div>
                {uploadFile && (
                  <div className="text-sm text-gray-600">
                    Selected: {uploadFile.name} ({(uploadFile.size / 1024 / 1024).toFixed(2)} MB)
                  </div>
                )}
                <button
                  onClick={handleFileUpload}
                  disabled={!uploadFile || uploading}
                  className="w-full px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {uploading ? "Uploading..." : "Upload Sermon"}
                </button>
              </div>
            </div>
          </div>

          {/* Library Section */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow">
              <div className="p-6 border-b border-gray-200">
                <h2 className="text-xl font-semibold">All Sermons ({sermons.length})</h2>
              </div>
              {loading ? (
                <div className="p-6 text-center text-gray-500">Loading...</div>
              ) : sermons.length === 0 ? (
                <div className="p-6 text-center text-gray-500">
                  No sermons found. Upload a sermon to get started.
                </div>
              ) : (
                <div className="divide-y divide-gray-200">
                  {sermons.map((sermon) => (
                    <div key={sermon.id} className="p-6 hover:bg-gray-50">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h3 className="text-lg font-semibold text-gray-900">
                            {sermon.title || sermon.filename}
                          </h3>
                          <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                            <span>{formatDuration(sermon.duration)}</span>
                            <span>{new Date(sermon.created_at).toLocaleDateString()}</span>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          {sermon.storage_url && (
                            <>
                              <button
                                onClick={() => setPlayingId(playingId === sermon.id ? null : sermon.id)}
                                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
                              >
                                {playingId === sermon.id ? "Hide Player" : "Play"}
                              </button>
                              <button
                                onClick={() => router.push(`/recorder/review?id=${sermon.id}`)}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
                              >
                                Review
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => handleDeleteSermon(sermon.id, sermon.title || sermon.filename)}
                            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                      {/* Audio Player */}
                      {playingId === sermon.id && sermon.storage_url && (
                        <div className="mt-4 pt-4 border-t border-gray-200">
                          <audio
                            controls
                            src={sermon.storage_url}
                            className="w-full"
                            autoPlay
                          >
                            Your browser does not support the audio element.
                          </audio>
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

