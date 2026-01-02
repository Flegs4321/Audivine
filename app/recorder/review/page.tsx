/**
 * Human review and edit page for automatically detected sections
 */

"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { FinalSection } from "@/lib/segmenter/types";
import type { EditableSection } from "./types";
import { useAuth } from "@/app/auth/context/AuthProvider";
import Header from "@/app/components/Header";

function ReviewPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const recordingId = searchParams.get("id");
  const { user } = useAuth();

  const [sections, setSections] = useState<EditableSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeTabs, setActiveTabs] = useState<Record<string, "transcript" | "summary">>({});
  const [editingTranscripts, setEditingTranscripts] = useState<Record<string, boolean>>({});
  const [fullSummary, setFullSummary] = useState<string | null>(null);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [showSummaryModal, setShowSummaryModal] = useState(false);

  // Load sections from recording
  useEffect(() => {
    const loadSections = async () => {
      if (!recordingId) {
        setError("No recording ID provided");
        setLoading(false);
        return;
      }

      if (!user) {
        setError("You must be logged in to view recordings");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        // Get the session token from Supabase client
        const { supabase } = await import("@/lib/supabase/client");
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!session?.access_token) {
          throw new Error("Not authenticated. Please log in.");
        }

        // Fetch recording from API
        const response = await fetch(`/api/recordings/${recordingId}`, {
          headers: {
            "Authorization": `Bearer ${session.access_token}`,
          },
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message || errorData.error || `Failed to load recording: ${response.status}`);
        }

        const data = await response.json();
        const recording = data.recording;

        if (!recording) {
          throw new Error("Recording not found");
        }

        // Check if we have sections already (from analysis)
        // If segments exist and have label property, use them as sections
        let loadedSections: FinalSection[] = [];

        if (recording.segments && Array.isArray(recording.segments) && recording.segments.length > 0) {
          // Check if segments have label (they're already classified sections)
          const firstSegment = recording.segments[0];
          if (firstSegment.label) {
            // These are already FinalSection objects
            loadedSections = recording.segments as FinalSection[];
          }
        }

        // If no sections, convert transcript_chunks into a simple section
        if (loadedSections.length === 0 && recording.transcript_chunks && Array.isArray(recording.transcript_chunks) && recording.transcript_chunks.length > 0) {
          // Combine all transcript chunks into one section
          const chunks = recording.transcript_chunks;
          const fullText = chunks.map((chunk: any) => chunk.text).join(" ");
          const startMs = chunks[0]?.timestampMs || 0;
          const endMs = chunks[chunks.length - 1]?.timestampMs || (recording.duration * 1000);

          loadedSections = [{
            label: "Other" as const,
            startMs,
            endMs,
            text: fullText,
          }];
        }

        // Convert to EditableSection format
        setSections(
          loadedSections.map((s: FinalSection, i: number) => ({
            ...s,
            id: `section-${i}`,
          }))
        );

        setLoading(false);
      } catch (err) {
        console.error("Error loading sections:", err);
        setError(err instanceof Error ? err.message : "Failed to load sections");
        setLoading(false);
      }
    };

    loadSections();
  }, [recordingId, user]);

  const updateSection = (id: string, updates: Partial<EditableSection>) => {
    setSections((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...updates } : s))
    );
  };

  const setActiveTab = (sectionId: string, tab: "transcript" | "summary") => {
    setActiveTabs((prev) => ({ ...prev, [sectionId]: tab }));
  };

  const toggleEditTranscript = (sectionId: string) => {
    setEditingTranscripts((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
  };

  const regenerateSummary = async (sectionId: string) => {
    const section = sections.find((s) => s.id === sectionId);
    if (!section) return;

    updateSection(sectionId, { isRegeneratingSummary: true });

    try {
      const response = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: section.text,
          label: section.label,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || errorData.error || "Summarization failed");
      }

      const data = await response.json();
      updateSection(sectionId, {
        summary: data.summary,
        bullets: data.bullets,
        isRegeneratingSummary: false,
      });
    } catch (err) {
      console.error("Regeneration error:", err);
      updateSection(sectionId, { isRegeneratingSummary: false });
    }
  };

  const generateFullSummary = async () => {
    if (!recordingId) return;

    setGeneratingSummary(true);
    try {
      const { supabase } = await import("@/lib/supabase/client");
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Not authenticated");
      }

      // Combine all sections' transcripts
      const fullTranscript = sections.map((s) => s.text).join("\n\n");

      const response = await fetch("/api/sermons/generate-summary", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          recordingId,
          transcript: fullTranscript,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || errorData.error || "Failed to generate summary");
      }

      const data = await response.json();
      setFullSummary(data.summary);
      setShowSummaryModal(true);
    } catch (err) {
      console.error("Error generating summary:", err);
      setError(err instanceof Error ? err.message : "Failed to generate summary");
    } finally {
      setGeneratingSummary(false);
    }
  };

  const copySummaryToClipboard = async () => {
    if (!fullSummary) return;
    try {
      await navigator.clipboard.writeText(fullSummary);
      alert("Summary copied to clipboard!");
    } catch (err) {
      console.error("Failed to copy:", err);
      alert("Failed to copy to clipboard");
    }
  };

  const saveChanges = async () => {
    setSaving(true);
    try {
      // TODO: Implement API to save edited sections
      // await fetch(`/api/recordings/${recordingId}/sections`, {
      //   method: "PUT",
      //   headers: { "Content-Type": "application/json" },
      //   body: JSON.stringify({ sections }),
      // });

      // Temporary: save to localStorage
      localStorage.setItem(
        `recording-sections-${recordingId}`,
        JSON.stringify(sections)
      );

      setSaving(false);
      alert("Changes saved successfully!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading sections...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={() => router.back()}
            className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Header />
      <div className="flex-1 p-6">
        <div className="max-w-6xl mx-auto">
        <div className="mb-6 flex justify-between items-center">
          <h1 className="text-3xl font-bold text-gray-900">Review Sections</h1>
          <div className="space-x-4">
            <button
              onClick={generateFullSummary}
              disabled={generatingSummary || sections.length === 0}
              className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
            >
              {generatingSummary ? "Generating..." : "Generate Summary for Members"}
            </button>
            <button
              onClick={() => router.back()}
              className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={saveChanges}
              disabled={saving}
              className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>

        {sections.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-6 text-center">
            <p className="text-gray-600">No transcriptions found for this recording.</p>
            <p className="text-sm text-gray-500 mt-2">
              If this recording was just uploaded, transcriptions may still be processing.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {sections.map((section) => (
            <div
              key={section.id}
              className="bg-white rounded-lg shadow p-6 border-l-4 border-blue-500"
            >
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">
                    {section.label}
                  </h2>
                </div>
              </div>

              {/* Tabs */}
              <div className="mb-4">
                <div className="border-b border-gray-200">
                  <nav className="-mb-px flex space-x-8">
                    <button
                      onClick={() => setActiveTab(section.id, "transcript")}
                      className={`py-2 px-1 border-b-2 font-medium text-sm ${
                        (activeTabs[section.id] || "transcript") === "transcript"
                          ? "border-blue-500 text-blue-600"
                          : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                      }`}
                    >
                      Transcript
                    </button>
                    <button
                      onClick={() => setActiveTab(section.id, "summary")}
                      className={`py-2 px-1 border-b-2 font-medium text-sm ${
                        activeTabs[section.id] === "summary"
                          ? "border-blue-500 text-blue-600"
                          : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                      }`}
                    >
                      Summary
                    </button>
                  </nav>
                </div>
              </div>

              {/* Tab Content */}
              {(activeTabs[section.id] || "transcript") === "transcript" ? (
                <div className="mb-4">
                  <div className="flex justify-between items-center mb-2">
                    <label className="block text-sm font-medium text-gray-700">
                      Transcript
                    </label>
                    <button
                      onClick={() => toggleEditTranscript(section.id)}
                      className="px-3 py-1 text-xs bg-gray-100 rounded hover:bg-gray-200"
                    >
                      {editingTranscripts[section.id] ? "View" : "Edit"}
                    </button>
                  </div>
                  {editingTranscripts[section.id] ? (
                    <textarea
                      value={section.text}
                      onChange={(e) =>
                        updateSection(section.id, { text: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                      rows={15}
                    />
                  ) : (
                    <div className="w-full px-3 py-2 border border-gray-200 rounded bg-gray-50 font-mono text-sm whitespace-pre-wrap">
                      {section.text}
                    </div>
                  )}
                </div>
              ) : (
                <div className="mb-4">
                  <div className="flex justify-between items-center mb-2">
                    <label className="block text-sm font-medium text-gray-700">
                      Summary
                    </label>
                    <button
                      onClick={() => regenerateSummary(section.id)}
                      disabled={section.isRegeneratingSummary}
                      className="px-3 py-1 text-xs bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50"
                    >
                      {section.isRegeneratingSummary ? "Regenerating..." : "Regenerate"}
                    </button>
                  </div>
                  <textarea
                    value={section.summary || ""}
                    onChange={(e) =>
                      updateSection(section.id, { summary: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                    rows={3}
                  />

                  {/* Editable Bullets (Sermon only) */}
                  {section.label === "Sermon" && section.bullets && (
                    <div className="mt-4">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Key Points
                      </label>
                      <textarea
                        value={section.bullets.join("\n")}
                        onChange={(e) =>
                          updateSection(section.id, {
                            bullets: e.target.value.split("\n").filter((b) => b.trim()),
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                        rows={section.bullets.length + 2}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          </div>
        )}

        {/* Summary Modal */}
        {showSummaryModal && fullSummary && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
              <div className="p-6 border-b border-gray-200 flex justify-between items-center">
                <h2 className="text-2xl font-bold text-gray-900">Sermon Summary for Members</h2>
                <button
                  onClick={() => setShowSummaryModal(false)}
                  className="text-gray-400 hover:text-gray-600 text-2xl"
                >
                  ×
                </button>
              </div>
              <div className="p-6 overflow-y-auto flex-1">
                <div className="prose max-w-none whitespace-pre-wrap text-gray-700">
                  {fullSummary}
                </div>
              </div>
              <div className="p-6 border-t border-gray-200 flex justify-end space-x-4">
                <button
                  onClick={copySummaryToClipboard}
                  className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Copy to Clipboard
                </button>
                <button
                  onClick={() => setShowSummaryModal(false)}
                  className="px-6 py-2 bg-gray-200 rounded hover:bg-gray-300"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

export default function ReviewPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    }>
      <ReviewPageContent />
    </Suspense>
  );
}

