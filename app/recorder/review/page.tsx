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
import { extractSegmentWavFromBlob } from "@/lib/audio/extract-segment-wav";

function ReviewPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const recordingId = searchParams.get("id");
  const { user } = useAuth();

  const [sections, setSections] = useState<EditableSection[]>([]);
  const [transcriptChunks, setTranscriptChunks] = useState<Array<{ text: string; timestampMs: number; isFinal?: boolean; speaker?: string }>>([]);
  const [speakers, setSpeakers] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingSpeakers, setLoadingSpeakers] = useState(false);
  const [taggingSpeaker, setTaggingSpeaker] = useState<Record<string, boolean>>({}); // Track which section is being tagged
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeTabs, setActiveTabs] = useState<Record<string, "transcript" | "summary">>({});
  const [editingTranscripts, setEditingTranscripts] = useState<Record<string, boolean>>({});
  const [fullSummary, setFullSummary] = useState<string | null>(null);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  /** True when OpenAI or Anthropic key is configured (member summaries). */
  const [hasSummaryApiKey, setHasSummaryApiKey] = useState<boolean | null>(null);
  const [recording, setRecording] = useState<any>(null);
  const [churchSettings, setChurchSettings] = useState<{ church_name?: string; church_address?: string }>({});
  const [fixRangeBySection, setFixRangeBySection] = useState<Record<string, { startSec: string; endSec: string; speaker: string }>>({});
  const [assigningRange, setAssigningRange] = useState<Record<string, boolean>>({});

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

        // Store recording data for export
        setRecording(recording);

        // Store transcript chunks for speaker checking and updating
        if (recording.transcript_chunks && Array.isArray(recording.transcript_chunks)) {
          setTranscriptChunks(recording.transcript_chunks);
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
          // Combine all transcript chunks into one section, including speaker information
          const chunks = recording.transcript_chunks;
          let fullText = "";
          let currentSpeaker: string | null = null;
          
          for (const chunk of chunks) {
            // If this chunk has a speaker and it's different from current, add speaker label
            if (chunk.speaker && chunk.speaker !== currentSpeaker) {
              // Check if this is a tag line (already has speaker info in text)
              if (!chunk.text.startsWith("[") || (!chunk.text.includes(" sharing:]") && !chunk.text.includes(" speaking:]"))) {
                fullText += `\n[${chunk.speaker}]: `;
              }
              currentSpeaker = chunk.speaker;
            } else if (!chunk.speaker && currentSpeaker) {
              // Speaker ended, reset
              currentSpeaker = null;
            }
            
            fullText += chunk.text + " ";
          }
          
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

  // Check if user has OpenAI or Anthropic key configured (member summaries)
  useEffect(() => {
    const checkSummaryKeys = async () => {
      if (!user) {
        setHasSummaryApiKey(false);
        return;
      }

      try {
        const { supabase } = await import("@/lib/supabase/client");
        const { data: { session } } = await supabase.auth.getSession();

        if (!session?.access_token) {
          setHasSummaryApiKey(false);
          return;
        }

        const response = await fetch("/api/settings", {
          headers: {
            "Authorization": `Bearer ${session.access_token}`,
          },
        });

        if (response.ok) {
          const data = await response.json();
          const s = data.settings;
          const { resolveEffectiveMemberSummaryProvider } = await import(
            "@/lib/ai/summary-generation-settings"
          );
          setHasSummaryApiKey(resolveEffectiveMemberSummaryProvider(s) !== null);
        } else {
          setHasSummaryApiKey(false);
        }
      } catch (err) {
        console.error("Error checking API keys:", err);
        setHasSummaryApiKey(false);
      }
    };

    checkSummaryKeys();
  }, [user]);

  // Load church settings for export
  useEffect(() => {
    const loadChurchSettings = async () => {
      if (!user) {
        return;
      }

      try {
        const { supabase } = await import("@/lib/supabase/client");
        const { data: { session } } = await supabase.auth.getSession();

        if (!session?.access_token) {
          return;
        }

        const response = await fetch("/api/settings", {
          headers: {
            "Authorization": `Bearer ${session.access_token}`,
          },
        });

        if (response.ok) {
          const data = await response.json();
          if (data.settings) {
            setChurchSettings({
              church_name: data.settings.church_name || "CHURCH NAME",
              church_address: data.settings.church_address || "807 W Vantrees St. Washington, IN 47501",
            });
          }
        }
      } catch (err) {
        console.error("Error loading church settings:", err);
      }
    };

    loadChurchSettings();
  }, [user]);

  // Load speakers list
  useEffect(() => {
    const loadSpeakers = async () => {
      if (!user) {
        setSpeakers([]);
        return;
      }

      try {
        setLoadingSpeakers(true);
        const { supabase } = await import("@/lib/supabase/client");
        const { data: { session } } = await supabase.auth.getSession();

        if (!session?.access_token) {
          setLoadingSpeakers(false);
          return;
        }

        const response = await fetch("/api/speakers", {
          headers: {
            "Authorization": `Bearer ${session.access_token}`,
          },
        });

        if (response.ok) {
          const data = await response.json();
          if (data.speakers && Array.isArray(data.speakers)) {
            setSpeakers(data.speakers.map((s: any) => ({ id: s.id, name: s.name })));
          }
        }
      } catch (err) {
        console.error("Error loading speakers:", err);
      } finally {
        setLoadingSpeakers(false);
      }
    };

    loadSpeakers();
  }, [user]);

  const formatTime = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const handleDownloadSermonSegment = async (section: EditableSection) => {
    if (!recordingId || section.label !== "Sermon") return;

    try {
      const { supabase } = await import("@/lib/supabase/client");
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        alert("You must be logged in to download audio");
        return;
      }

      // Fetch recording to get audio URL
      const recordingResponse = await fetch(`/api/recordings/${recordingId}`, {
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
        },
      });

      if (!recordingResponse.ok) {
        throw new Error("Failed to fetch recording");
      }

      const recordingData = await recordingResponse.json();
      const audioUrl = recordingData.recording?.storage_url;

      if (!audioUrl) {
        throw new Error("Recording has no audio file");
      }

      // Show loading message
      const loadingMsg = `Extracting sermon segment from ${formatTime(section.startMs)} to ${section.endMs ? formatTime(section.endMs) : 'end'}...\n\nThis may take a moment.`;
      alert(loadingMsg);

      // Fetch the audio file
      const audioResponse = await fetch(audioUrl);
      if (!audioResponse.ok) {
        throw new Error("Failed to fetch audio file");
      }

      const audioBlob = await audioResponse.blob();

      const wavBlob = await extractSegmentWavFromBlob(
        audioBlob,
        section.startMs,
        section.endMs
      );
      if (!wavBlob) {
        throw new Error("Could not extract audio for this segment");
      }
      
      // Download the segment
      const url = window.URL.createObjectURL(wavBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sermon-segment-${recordingId}-${Date.now()}.wav`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      alert("Sermon segment downloaded! You can now upload this file to Spotify.");
    } catch (err) {
      console.error("Download error:", err);
      alert(err instanceof Error ? err.message : "Failed to download sermon segment");
    }
  };

  const handleDownloadSermonTranscript = (section: EditableSection) => {
    if (section.label !== "Sermon") return;

    const sermonStartMs = section.startMs;
    const sermonEndMs = section.endMs ?? Infinity;

    // Filter chunks that fall within the sermon time range
    const sermonChunks = transcriptChunks.filter(
      (chunk) => chunk.timestampMs >= sermonStartMs && chunk.timestampMs <= sermonEndMs
    );

    if (sermonChunks.length === 0) {
      alert("No transcript found for the sermon segment.");
      return;
    }

    // Build header
    const churchName = churchSettings.church_name ?? "Church";
    const date = recording?.created_at
      ? new Date(recording.created_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
      : new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

    let output = `Sermon Transcript\n${churchName} \u2013 ${date}\n\n`;

    // Group by speaker changes; omit the synthetic "Name - speaking:" tag lines from the body
    let currentSpeaker: string | null = null;
    for (const chunk of sermonChunks) {
      // Skip speaker-tag marker lines (they carry the speakerTag flag or end in "- speaking:" / "- sharing:")
      if ((chunk as any).speakerTag) continue;

      if (chunk.speaker && chunk.speaker !== currentSpeaker) {
        currentSpeaker = chunk.speaker;
        output += `\n${currentSpeaker} - speaking:\n`;
      }

      output += `${chunk.text} `;
    }

    output = output.trimEnd();

    // Trigger download
    const blob = new Blob([output], { type: "text/plain;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sermon-transcript-${recordingId ?? Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  const updateSection = (id: string, updates: Partial<EditableSection>) => {
    setSections((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...updates } : s))
    );
  };

  // Check if a section has any speaker tagged
  const sectionHasSpeaker = (section: EditableSection): boolean => {
    if (!transcriptChunks.length) return false;
    
    // Find chunks within this section's time range
    const sectionChunks = transcriptChunks.filter(
      (chunk) => chunk.timestampMs >= section.startMs && 
                 (section.endMs === null || chunk.timestampMs <= section.endMs)
    );
    
    // Check if any chunk has a speaker
    return sectionChunks.some((chunk) => chunk.speaker && chunk.speaker.trim() !== "");
  };

  // Tag a speaker for a section retroactively
  const handleTagSpeaker = async (sectionId: string, speakerName: string) => {
    if (!recordingId || !speakerName.trim()) return;

    const section = sections.find((s) => s.id === sectionId);
    if (!section) return;

    try {
      setTaggingSpeaker((prev) => ({ ...prev, [sectionId]: true }));

      const { supabase } = await import("@/lib/supabase/client");
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Not authenticated");
      }

      // Find chunks within this section's time range
      const sectionChunks = transcriptChunks.filter(
        (chunk) => chunk.timestampMs >= section.startMs && 
                   (section.endMs === null || chunk.timestampMs <= section.endMs)
      );

      if (sectionChunks.length === 0) {
        alert("No transcript chunks found in this section");
        return;
      }

      // Update chunks with speaker information (set speaker on ALL chunks in this section so tagged speaker is used everywhere, including member summary)
      const updatedChunks = transcriptChunks.map((chunk) => {
        if (
          chunk.timestampMs >= section.startMs &&
          (section.endMs === null || chunk.timestampMs <= section.endMs)
        ) {
          return { ...chunk, speaker: speakerName };
        }
        return chunk;
      });

      // Also add a speaker tag marker at the start of the section if it doesn't exist
      const hasTagMarker = sectionChunks.some(
        (chunk) =>
          (chunk.text.startsWith("[") && (chunk.text.includes(" sharing:]") || chunk.text.includes(" speaking:]") || chunk.text.includes(" sermon speaker:]"))) ||
          (chunk as any).speakerTag || chunk.text.includes(" - sermon speaker:") || chunk.text.includes(" - speaking:")
      );

      if (!hasTagMarker) {
        // Find the first chunk in the section and add a tag marker before it
        const firstChunkIndex = transcriptChunks.findIndex(
          (chunk) => chunk.timestampMs >= section.startMs
        );
        if (firstChunkIndex >= 0) {
          const tagText = section.label === "Sermon" 
            ? `${speakerName} - sermon speaker:` 
            : `[${speakerName} sharing:]`;
          const tagChunk = {
            text: tagText,
            timestampMs: section.startMs,
            isFinal: true,
            speaker: speakerName,
            ...(section.label === "Sermon" ? { speakerTag: true } : {}),
          };
          updatedChunks.splice(firstChunkIndex, 0, tagChunk);
        }
      }

      // Update recording in database
      const response = await fetch(`/api/recordings/${recordingId}/transcript-chunks`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          transcript_chunks: updatedChunks,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || errorData.error || "Failed to update transcript chunks");
      }

      // Update local state
      setTranscriptChunks(updatedChunks);

      // Reload sections to reflect updated transcript
      const recordResponse = await fetch(`/api/recordings/${recordingId}`, {
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
        },
      });

      if (recordResponse.ok) {
        const recordData = await recordResponse.json();
        const recording = recordData.recording;

        if (recording.transcript_chunks) {
          setTranscriptChunks(recording.transcript_chunks);
        }

        // Rebuild sections with updated transcript
        if (recording.segments && Array.isArray(recording.segments) && recording.segments.length > 0) {
          const firstSegment = recording.segments[0];
          if (firstSegment.label) {
            // These are already FinalSection objects, but we need to rebuild text with speaker info
            const updatedSections = recording.segments.map((s: FinalSection, i: number) => {
              // Rebuild text from transcript chunks with speaker information
              if (recording.transcript_chunks && Array.isArray(recording.transcript_chunks)) {
                const sectionChunks = recording.transcript_chunks.filter(
                  (chunk: any) => chunk.timestampMs >= s.startMs && 
                                 (s.endMs === null || chunk.timestampMs <= s.endMs)
                );
                
                let fullText = "";
                let currentSpeaker: string | null = null;
                
                for (const chunk of sectionChunks) {
                  if (chunk.speaker && chunk.speaker !== currentSpeaker) {
                    if (!chunk.text.startsWith("[") || (!chunk.text.includes(" sharing:]") && !chunk.text.includes(" speaking:]"))) {
                      fullText += `\n[${chunk.speaker}]: `;
                    }
                    currentSpeaker = chunk.speaker;
                  } else if (!chunk.speaker && currentSpeaker) {
                    currentSpeaker = null;
                  }
                  
                  fullText += chunk.text + " ";
                }
                
                return {
                  ...s,
                  id: `section-${i}`,
                  text: fullText.trim(),
                };
              }
              
              return {
                ...s,
                id: `section-${i}`,
              };
            });
            
            setSections(updatedSections);
          }
        }
      }

      alert(`Successfully tagged ${speakerName} for ${section.label} section. ${section.label === "Sermon" ? "Generate summary for members to see \"MESSAGE: " + speakerName + "\"." : ""}`);
    } catch (err) {
      console.error("Error tagging speaker:", err);
      alert(err instanceof Error ? err.message : "Failed to tag speaker");
    } finally {
      setTaggingSpeaker((prev) => ({ ...prev, [sectionId]: false }));
    }
  };

  const handleAssignSpeakerToRange = async (sectionId: string, startSec: string, endSec: string, speakerName: string) => {
    const section = sections.find((s) => s.id === sectionId);
    if (!recordingId || !section || !speakerName.trim()) return;
    const startMs = Math.max(0, parseInt(startSec, 10) * 1000) || 0;
    const endMs = parseInt(endSec, 10) * 1000;
    if (Number.isNaN(endMs) || endMs <= startMs) {
      alert("Please enter a valid time range (end must be after start, in seconds).");
      return;
    }
    try {
      setAssigningRange((prev) => ({ ...prev, [sectionId]: true }));
      const { supabase } = await import("@/lib/supabase/client");
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not authenticated");

      const updatedChunks = transcriptChunks.map((chunk) => {
        const inSection = chunk.timestampMs >= section.startMs && (section.endMs == null || chunk.timestampMs <= section.endMs);
        const inRange = chunk.timestampMs >= startMs && chunk.timestampMs <= endMs;
        if (inSection && inRange) {
          return { ...chunk, speaker: speakerName };
        }
        return chunk;
      });

      const response = await fetch(`/api/recordings/${recordingId}/transcript-chunks`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ transcript_chunks: updatedChunks }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || errorData.error || "Failed to update transcript");
      }
      setTranscriptChunks(updatedChunks);
      const count = updatedChunks.filter((c) => c.timestampMs >= startMs && c.timestampMs <= endMs && c.speaker === speakerName).length;
      alert(`Assigned ${speakerName} to ${count} chunk(s) in the selected time range.`);
      setFixRangeBySection((prev) => ({ ...prev, [sectionId]: { startSec: "", endSec: "", speaker: "" } }));

      const recordResponse = await fetch(`/api/recordings/${recordingId}`, {
        headers: { "Authorization": `Bearer ${session.access_token}` },
      });
      if (recordResponse.ok) {
        const recordData = await recordResponse.json();
        const rec = recordData.recording;
        if (rec?.transcript_chunks) setTranscriptChunks(rec.transcript_chunks);
        if (rec?.segments?.length > 0 && rec.segments[0].label) {
          const updatedSections = rec.segments.map((s: FinalSection, i: number) => {
            if (rec.transcript_chunks?.length) {
              const sectionChunks = rec.transcript_chunks.filter(
                (chunk: any) => chunk.timestampMs >= s.startMs && (s.endMs == null || chunk.timestampMs <= s.endMs)
              );
              let fullText = "";
              let currentSpeaker: string | null = null;
              for (const chunk of sectionChunks) {
                if (chunk.speaker && chunk.speaker !== currentSpeaker) {
                  if (!chunk.text.startsWith("[") || (!chunk.text.includes(" sharing:]") && !chunk.text.includes(" speaking:]"))) {
                    fullText += `\n[${chunk.speaker}]: `;
                  }
                  currentSpeaker = chunk.speaker;
                } else if (!chunk.speaker && currentSpeaker) currentSpeaker = null;
                fullText += chunk.text + " ";
              }
              return { ...s, id: `section-${i}`, text: fullText.trim() };
            }
            return { ...s, id: `section-${i}` };
          });
          setSections(updatedSections);
        }
      }
    } catch (err) {
      console.error("Error assigning speaker to range:", err);
      alert(err instanceof Error ? err.message : "Failed to assign speaker to range");
    } finally {
      setAssigningRange((prev) => ({ ...prev, [sectionId]: false }));
    }
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
      // Get the session token from Supabase client
      const { supabase } = await import("@/lib/supabase/client");
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Not authenticated");
      }

      const response = await fetch("/api/summarize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          text: section.text,
          label: section.label,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.message || errorData.error || "Summarization failed";
        
        // Check if it's an API key error
        if (errorMessage.includes("API key not configured") || errorMessage.includes("not available")) {
          setHasSummaryApiKey(false);
          alert("No API key configured for summarization. Add an OpenAI or Anthropic key in Settings.");
        }
        
        throw new Error(errorMessage);
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

    if (!hasSummaryApiKey) {
      setError("No API key for summaries. Add an OpenAI or Anthropic (Claude) key in Settings.");
      return;
    }

    setGeneratingSummary(true);
    setError(null);
    try {
      const { supabase } = await import("@/lib/supabase/client");
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Not authenticated");
      }

      // Combine all sections' transcripts
      const fullTranscript = sections.map((s) => s.text).join("\n\n");

      // Get sermon speaker for MESSAGE header.
      // Prefer explicit tagged lines like "Name - sermon speaker:" inside the sermon range,
      // then fall back to the most frequent speaker in that range.
      let sermonSpeakerName: string | null = null;
      const sermonSection = sections.find((s) => s.label === "Sermon");
      if (sermonSection && transcriptChunks.length > 0) {
        const sermonChunks = transcriptChunks.filter(
          (chunk) => chunk.timestampMs >= sermonSection.startMs &&
            (sermonSection.endMs == null || chunk.timestampMs <= sermonSection.endMs)
        );
        if (sermonChunks.length > 0) {
          const tagged = sermonChunks.find((chunk: any) => {
            const text = String(chunk.text || "");
            const lower = text.toLowerCase();
            return (
              chunk.speakerTag === true &&
              (lower.includes("sermon speaker:") || lower.includes("message speaker:"))
            );
          }) as any;
          if (tagged) {
            if (tagged.speaker && String(tagged.speaker).trim().length > 0) {
              sermonSpeakerName = String(tagged.speaker).trim();
            } else {
              const m = String(tagged.text || "").match(
                /^(.+?)\s*-\s*(?:sermon|message)\s+speaker\s*:/i
              );
              if (m?.[1]?.trim()) sermonSpeakerName = m[1].trim();
            }
          }
        }
        if (!sermonSpeakerName && sermonChunks.length > 0) {
          const withSpeaker = sermonChunks.filter(
            (chunk) => chunk.speaker && chunk.speaker.trim() !== ""
          );
          if (withSpeaker.length > 0) {
          const counts: Record<string, number> = {};
            withSpeaker.forEach((c) => {
              if (c.speaker) counts[c.speaker] = (counts[c.speaker] || 0) + 1;
            });
          sermonSpeakerName = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
          }
        }
      }

      const response = await fetch("/api/sermons/generate-summary", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          recordingId,
          transcript: fullTranscript,
          sermonSpeakerName: sermonSpeakerName ?? undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.message || errorData.error || "Failed to generate summary";
        
        // Check if it's an API key error
        if (errorMessage.includes("API key not configured") || errorMessage.includes("not available")) {
          setHasSummaryApiKey(false);
        }
        
        throw new Error(errorMessage);
      }

      const data = await response.json();
      let summaryText = data.summary;

      // Ensure MESSAGE header shows the tagged sermon speaker (AI sometimes omits it)
      if (sermonSpeakerName && summaryText && typeof summaryText === "string") {
        const lines = summaryText.split("\n");
        const messageHeaderPattern = /^([\d#\s.)\-]*)(MESSAGE)\s*:?\s*([^\n]*)$/im;
        for (let i = 0; i < lines.length; i++) {
          const m = lines[i].trim().match(messageHeaderPattern);
          if (m) {
            const prefix = m[1] || "";
            const rest = (m[3] || "").trim();
            if (!rest || !rest.includes(sermonSpeakerName)) {
              lines[i] = `${prefix}MESSAGE: ${sermonSpeakerName}${rest ? " – " + rest : ""}`.trim();
            }
            break;
          }
        }
        summaryText = lines.join("\n");
      }

      setFullSummary(summaryText);
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

  const exportToWord = async () => {
    if (!fullSummary) return;

    try {
      const { saveAs } = await import("file-saver");
      const { supabase } = await import("@/lib/supabase/client");
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        alert("You must be logged in to export.");
        return;
      }

      const response = await fetch("/api/bulletin/from-summary", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ summary: fullSummary }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const msg =
          typeof errData.message === "string"
            ? errData.message
            : typeof errData.error === "string"
              ? errData.error
              : `Export failed (${response.status})`;
        throw new Error(msg);
      }

      const blob = await response.blob();
      const cd = response.headers.get("Content-Disposition");
      const m = cd?.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i) ?? cd?.match(/filename="([^"]+)"/i);
      const fallback = `SundayBulletin_${new Date().toISOString().slice(0, 10)}.docx`;
      const filename = m?.[1]?.trim() || fallback;

      saveAs(blob, filename);
      alert(
        "Exported: bulletin-final/template/template.docx filled from your current member summary (same mapping as bulletin-final; no second AI call)."
      );
    } catch (err) {
      console.error("Failed to export bulletin:", err);
      alert(err instanceof Error ? err.message : "Failed to export Word document. Please try again.");
    }
  };

  const saveChanges = async () => {
    if (!recordingId) return;
    
    setSaving(true);
    try {
      const { supabase } = await import("@/lib/supabase/client");
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Not authenticated");
      }

      // Convert sections back to segments format for database
      const segments = sections.map((s) => ({
        label: s.label,
        startMs: s.startMs,
        endMs: s.endMs,
        text: s.text,
        summary: s.summary,
        bullets: s.bullets,
      }));

      // Update recording segments in database
      const response = await fetch(`/api/recordings/${recordingId}/segments`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ segments }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || errorData.error || "Failed to save segments");
      }

      setSaving(false);
      alert("Segment times saved successfully!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-teal-600" />
          <p className="mt-4 text-slate-600">Loading sections...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={() => router.back()}
            className="px-4 py-2 bg-slate-200 rounded hover:bg-slate-300"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <Header />
      <div className="flex-1 p-6">
        <div className="max-w-6xl mx-auto">
        <div className="mb-6 flex justify-between items-center">
          <h1 className="text-3xl font-bold text-slate-900">Review Sections</h1>
          <div className="space-x-4">
            {hasSummaryApiKey === false && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2 mr-4">
                <p className="text-sm text-yellow-800">
                  Configure an OpenAI or Anthropic (Claude) API key in{" "}
                  <a href="/settings" className="underline font-semibold">Settings</a> to generate member summaries
                </p>
              </div>
            )}
            <button
              type="button"
              onClick={generateFullSummary}
              disabled={generatingSummary || sections.length === 0 || hasSummaryApiKey === false}
              className="rounded-lg border border-teal-600 bg-teal-600 px-6 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
              title={hasSummaryApiKey === false ? "OpenAI or Anthropic API key required. Configure in Settings." : ""}
            >
              {generatingSummary ? "Generating..." : "Generate Summary for Members"}
            </button>
            <button
              type="button"
              onClick={() => router.back()}
              className="rounded-lg border border-teal-600 bg-teal-600 px-6 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-teal-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveChanges}
              disabled={saving}
              className="rounded-lg border border-teal-600 bg-teal-600 px-6 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-teal-700 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>

        {sections.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-6 text-center">
            <p className="text-slate-600">No transcriptions found for this recording.</p>
            <p className="text-sm text-slate-500 mt-2">
              If this recording was just uploaded, transcriptions may still be processing.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {sections.map((section) => (
            <div
              key={section.id}
              className="rounded-2xl border border-slate-200/80 border-l-4 border-l-teal-500 bg-white p-6 shadow-sm"
            >
              <div className="flex justify-between items-start mb-4">
                <div className="flex-1">
                  <h2 className="text-xl font-semibold text-slate-900">
                    {section.label}
                  </h2>
                  {/* Segment Time Editing */}
                  <div className="mt-2 flex gap-4 items-center">
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-slate-600">Start:</label>
                      <input
                        type="number"
                        value={Math.floor(section.startMs / 1000)}
                        onChange={(e) => {
                          const seconds = parseInt(e.target.value) || 0;
                          updateSection(section.id, { startMs: seconds * 1000 });
                        }}
                        className="w-20 px-2 py-1 text-xs border border-slate-300 rounded"
                        placeholder="seconds"
                      />
                      <span className="text-xs text-slate-500">
                        ({formatTime(section.startMs)})
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-slate-600">End:</label>
                      <input
                        type="number"
                        value={section.endMs ? Math.floor(section.endMs / 1000) : ""}
                        onChange={(e) => {
                          const seconds = parseInt(e.target.value);
                          updateSection(section.id, { endMs: seconds && seconds > 0 ? seconds * 1000 : undefined });
                        }}
                        className="w-20 px-2 py-1 text-xs border border-slate-300 rounded"
                        placeholder="seconds"
                      />
                      <span className="text-xs text-slate-500">
                        {section.endMs ? `(${formatTime(section.endMs)})` : "(end of recording)"}
                      </span>
                    </div>
                  </div>
                </div>
                {section.label === "Sermon" && (
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={() => handleDownloadSermonSegment(section)}
                      className="rounded-lg border border-teal-600 bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-teal-700"
                    >
                      Download Sermon Segment (WAV)
                    </button>
                    <button
                      onClick={() => handleDownloadSermonTranscript(section)}
                      className="rounded-lg border border-teal-600 bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-teal-700"
                    >
                      Download Sermon Transcript (TXT)
                    </button>
                  </div>
                )}
              </div>

              {/* Speaker Tagging Notice for Sharing/Sermon sections */}
              {(section.label === "Sharing" || section.label === "Sermon") && !sectionHasSpeaker(section) && (
                <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-yellow-800 mb-2">
                        ⚠️ No speaker was tagged during {section.label === "Sermon" ? "the message" : "sharing"}
                      </p>
                      <p className="text-xs text-yellow-700 mb-3">
                        {section.label === "Sermon"
                          ? "Add the sermon speaker so the summary for members shows \"MESSAGE: [Name]\"."
                          : "Would you like to add a speaker from your speaker list? This will tag all transcript chunks in this section."}
                      </p>
                      {speakers.length > 0 ? (
                        <div className="flex gap-2">
                          <select
                            id={`speaker-select-${section.id}`}
                            className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded focus:ring-2 focus:ring-teal-500/40"
                            defaultValue=""
                          >
                            <option value="">Select a speaker...</option>
                            {speakers.map((speaker) => (
                              <option key={speaker.id} value={speaker.name}>
                                {speaker.name}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => {
                              const select = document.getElementById(`speaker-select-${section.id}`) as HTMLSelectElement;
                              const speakerName = select?.value;
                              if (speakerName) {
                                handleTagSpeaker(section.id, speakerName);
                              } else {
                                alert("Please select a speaker");
                              }
                            }}
                            disabled={taggingSpeaker[section.id] || loadingSpeakers}
                            className="px-4 py-2 bg-teal-600 text-white text-sm rounded hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {taggingSpeaker[section.id] ? "Tagging..." : "Tag Speaker"}
                          </button>
                        </div>
                      ) : (
                        <p className="text-xs text-yellow-600">
                          No speakers available. Add speakers in Settings first.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Fix wrong attribution: assign speaker to a time range within this section */}
              {(section.label === "Sharing" || section.label === "Sermon") && (
                <div className="mb-4 p-4 bg-slate-50 border border-slate-200 rounded-lg">
                  <p className="text-sm font-medium text-slate-700 mb-2">Fix wrong attribution</p>
                  <p className="text-xs text-slate-600 mb-3">
                    If some speech was attributed to the wrong person, assign a speaker to a time range (recording time in seconds). Section: {formatTime(section.startMs)} – {section.endMs != null ? formatTime(section.endMs) : "end"}.
                  </p>
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-slate-600">Start (sec)</span>
                      <input
                        type="number"
                        min={0}
                        value={fixRangeBySection[section.id]?.startSec ?? ""}
                        onChange={(e) =>
                          setFixRangeBySection((prev) => ({
                            ...prev,
                            [section.id]: { ...(prev[section.id] ?? { startSec: "", endSec: "", speaker: "" }), startSec: e.target.value },
                          }))
                        }
                        placeholder={String(Math.floor(section.startMs / 1000))}
                        className="w-24 px-2 py-1.5 text-sm border border-slate-300 rounded"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-slate-600">End (sec)</span>
                      <input
                        type="number"
                        min={0}
                        value={fixRangeBySection[section.id]?.endSec ?? ""}
                        onChange={(e) =>
                          setFixRangeBySection((prev) => ({
                            ...prev,
                            [section.id]: { ...(prev[section.id] ?? { startSec: "", endSec: "", speaker: "" }), endSec: e.target.value },
                          }))
                        }
                        placeholder={section.endMs != null ? String(Math.floor(section.endMs / 1000)) : "—"}
                        className="w-24 px-2 py-1.5 text-sm border border-slate-300 rounded"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-slate-600">Speaker</span>
                      <select
                        value={fixRangeBySection[section.id]?.speaker ?? ""}
                        onChange={(e) =>
                          setFixRangeBySection((prev) => ({
                            ...prev,
                            [section.id]: { ...(prev[section.id] ?? { startSec: "", endSec: "", speaker: "" }), speaker: e.target.value },
                          }))
                        }
                        className="px-3 py-1.5 text-sm border border-slate-300 rounded"
                      >
                        <option value="">Select...</option>
                        {speakers.map((s) => (
                          <option key={s.id} value={s.name}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      onClick={() => {
                        const r = fixRangeBySection[section.id];
                        if (r?.startSec != null && r?.endSec != null && r?.speaker) {
                          handleAssignSpeakerToRange(section.id, r.startSec, r.endSec, r.speaker);
                        } else {
                          alert("Enter start time, end time, and select a speaker.");
                        }
                      }}
                      disabled={assigningRange[section.id] || !fixRangeBySection[section.id]?.speaker}
                      className="px-4 py-1.5 bg-teal-600 text-white text-sm rounded hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {assigningRange[section.id] ? "Applying..." : "Assign speaker to range"}
                    </button>
                  </div>
                </div>
              )}

              {/* Tabs */}
              <div className="mb-4">
                <div className="border-b border-slate-200">
                  <nav className="-mb-px flex space-x-8">
                    <button
                      onClick={() => setActiveTab(section.id, "transcript")}
                      className={`py-2 px-1 border-b-2 font-medium text-sm ${
                        (activeTabs[section.id] || "transcript") === "transcript"
                          ? "border-teal-500 text-teal-600"
                          : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
                      }`}
                    >
                      Transcript
                    </button>
                    <button
                      onClick={() => setActiveTab(section.id, "summary")}
                      className={`py-2 px-1 border-b-2 font-medium text-sm ${
                        activeTabs[section.id] === "summary"
                          ? "border-teal-500 text-teal-600"
                          : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
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
                    <label className="block text-sm font-medium text-slate-700">
                      Transcript
                    </label>
                    <button
                      onClick={() => toggleEditTranscript(section.id)}
                      className="px-3 py-1 text-xs bg-slate-100 rounded hover:bg-slate-200"
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
                      className="w-full px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-teal-500/40 font-mono text-sm"
                      rows={15}
                    />
                  ) : (
                    <div className="w-full px-3 py-2 border border-slate-200 rounded bg-slate-50 font-mono text-sm whitespace-pre-wrap">
                      {section.text}
                    </div>
                  )}
                </div>
              ) : (
                <div className="mb-4">
                  <div className="flex justify-between items-center mb-2">
                    <label className="block text-sm font-medium text-slate-700">
                      Summary
                    </label>
                    <button
                      onClick={() => regenerateSummary(section.id)}
                      disabled={section.isRegeneratingSummary}
                      className="px-3 py-1 text-xs bg-slate-100 rounded hover:bg-slate-200 disabled:opacity-50"
                    >
                      {section.isRegeneratingSummary ? "Regenerating..." : "Regenerate"}
                    </button>
                  </div>
                  <textarea
                    value={section.summary || ""}
                    onChange={(e) =>
                      updateSection(section.id, { summary: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-teal-500/40"
                    rows={3}
                  />

                  {/* Editable Bullets (Sermon only) */}
                  {section.label === "Sermon" && section.bullets && (
                    <div className="mt-4">
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Key Points
                      </label>
                      <textarea
                        value={section.bullets.join("\n")}
                        onChange={(e) =>
                          updateSection(section.id, {
                            bullets: e.target.value.split("\n").filter((b) => b.trim()),
                          })
                        }
                        className="w-full px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-teal-500/40"
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
              <div className="p-6 border-b border-slate-200 flex justify-between items-center">
                <h2 className="text-2xl font-bold text-slate-900">Sermon Summary for Members</h2>
                <button
                  onClick={() => setShowSummaryModal(false)}
                  className="text-slate-400 hover:text-slate-600 text-2xl"
                >
                  ×
                </button>
              </div>
              <div className="p-6 overflow-y-auto flex-1">
                <div className="prose max-w-none whitespace-pre-wrap text-slate-700">
                  {fullSummary}
                </div>
              </div>
              <div className="p-6 border-t border-slate-200 flex justify-end space-x-4">
                <button
                  onClick={copySummaryToClipboard}
                  className="rounded-lg border border-teal-600 bg-teal-600 px-6 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-teal-700"
                >
                  Copy to Clipboard
                </button>
                <button
                  onClick={exportToWord}
                  className="rounded-lg border border-teal-600 bg-teal-600 px-6 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-teal-700"
                >
                  Export to Word
                </button>
                <button
                  onClick={() => setShowSummaryModal(false)}
                  className="px-6 py-2 bg-slate-200 rounded hover:bg-slate-300"
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
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-teal-600" />
          <p className="text-slate-600">Loading...</p>
        </div>
      </div>
    }>
      <ReviewPageContent />
    </Suspense>
  );
}

