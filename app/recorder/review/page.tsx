/**
 * Human review and edit page for automatically detected sections
 */

"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { FinalSection } from "@/lib/segmenter/types";
import type { EditableSection } from "./types";

export default function ReviewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const recordingId = searchParams.get("id");

  const [sections, setSections] = useState<EditableSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Load sections from recording (TODO: implement API to fetch)
  useEffect(() => {
    // For now, try to load from localStorage or API
    const loadSections = async () => {
      try {
        // TODO: Replace with actual API call
        // const response = await fetch(`/api/recordings/${recordingId}`);
        // const data = await response.json();
        // setSections(data.sections.map((s: FinalSection, i: number) => ({
        //   ...s,
        //   id: `section-${i}`,
        // })));

        // Temporary: load from localStorage
        const stored = localStorage.getItem(`recording-sections-${recordingId}`);
        if (stored) {
          const parsed = JSON.parse(stored);
          setSections(
            parsed.map((s: FinalSection, i: number) => ({
              ...s,
              id: `section-${i}`,
            }))
          );
        }
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load sections");
        setLoading(false);
      }
    };

    if (recordingId) {
      loadSections();
    } else {
      setError("No recording ID provided");
      setLoading(false);
    }
  }, [recordingId]);

  const formatTime = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  };

  const updateSection = (id: string, updates: Partial<EditableSection>) => {
    setSections((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...updates } : s))
    );
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

      if (!response.ok) throw new Error("Summarization failed");

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
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6 flex justify-between items-center">
          <h1 className="text-3xl font-bold text-gray-900">Review Sections</h1>
          <div className="space-x-4">
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
                  <p className="text-sm text-gray-500 mt-1">
                    {formatTime(section.startMs)} - {formatTime(section.endMs)}
                  </p>
                </div>
                <button
                  onClick={() => regenerateSummary(section.id)}
                  disabled={section.isRegeneratingSummary}
                  className="px-3 py-1 text-sm bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50"
                >
                  {section.isRegeneratingSummary ? "Regenerating..." : "Regenerate Summary"}
                </button>
              </div>

              {/* Editable Summary */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Summary
                </label>
                <textarea
                  value={section.summary || ""}
                  onChange={(e) =>
                    updateSection(section.id, { summary: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                  rows={3}
                />
              </div>

              {/* Editable Bullets (Sermon only) */}
              {section.label === "Sermon" && section.bullets && (
                <div className="mb-4">
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

              {/* Editable Text (collapsible) */}
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900">
                  View/Edit Full Text
                </summary>
                <textarea
                  value={section.text}
                  onChange={(e) =>
                    updateSection(section.id, { text: e.target.value })
                  }
                  className="w-full mt-2 px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                  rows={10}
                />
              </details>

              {/* Time Adjustments */}
              <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <label className="block text-gray-700 mb-1">Start Time (ms)</label>
                  <input
                    type="number"
                    value={section.startMs}
                    onChange={(e) =>
                      updateSection(section.id, {
                        startMs: parseInt(e.target.value) || 0,
                      })
                    }
                    className="w-full px-3 py-1 border border-gray-300 rounded"
                  />
                </div>
                <div>
                  <label className="block text-gray-700 mb-1">End Time (ms)</label>
                  <input
                    type="number"
                    value={section.endMs}
                    onChange={(e) =>
                      updateSection(section.id, {
                        endMs: parseInt(e.target.value) || 0,
                      })
                    }
                    className="w-full px-3 py-1 border border-gray-300 rounded"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

