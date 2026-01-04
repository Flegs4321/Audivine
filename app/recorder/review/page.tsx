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
  const [detectingSegments, setDetectingSegments] = useState(false);
  const [activeTabs, setActiveTabs] = useState<Record<string, "transcript" | "summary">>({});
  const [editingTranscripts, setEditingTranscripts] = useState<Record<string, boolean>>({});
  const [fullSummary, setFullSummary] = useState<string | null>(null);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [hasOpenAIKey, setHasOpenAIKey] = useState<boolean | null>(null);

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

  // Check if user has OpenAI API key configured
  useEffect(() => {
    const checkOpenAIKey = async () => {
      if (!user) {
        setHasOpenAIKey(false);
        return;
      }

      try {
        const { supabase } = await import("@/lib/supabase/client");
        const { data: { session } } = await supabase.auth.getSession();

        if (!session?.access_token) {
          setHasOpenAIKey(false);
          return;
        }

        const response = await fetch("/api/settings", {
          headers: {
            "Authorization": `Bearer ${session.access_token}`,
          },
        });

        if (response.ok) {
          const data = await response.json();
          // Check if API key exists (even if masked in response, it means user has configured one)
          // Masked keys will be like "sk-xxxx...xxxx" which is still > 10 chars
          const hasKey = data.settings?.openai_api_key && 
                        data.settings.openai_api_key.length > 10 &&
                        data.settings.openai_api_key.startsWith("sk-");
          setHasOpenAIKey(hasKey);
        } else {
          setHasOpenAIKey(false);
        }
      } catch (err) {
        console.error("Error checking OpenAI key:", err);
        setHasOpenAIKey(false);
      }
    };

    checkOpenAIKey();
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
      const audioArrayBuffer = await audioBlob.arrayBuffer();

      // Create audio context and decode audio
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(audioArrayBuffer);

      // Calculate segment boundaries
      const startSample = Math.floor((section.startMs / 1000) * audioBuffer.sampleRate);
      const endSample = section.endMs 
        ? Math.floor((section.endMs / 1000) * audioBuffer.sampleRate)
        : audioBuffer.length;
      const segmentLength = endSample - startSample;

      // Create new audio buffer for the segment
      const segmentBuffer = audioContext.createBuffer(
        audioBuffer.numberOfChannels,
        segmentLength,
        audioBuffer.sampleRate
      );

      // Copy the segment data
      for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
        const inputData = audioBuffer.getChannelData(channel);
        const outputData = segmentBuffer.getChannelData(channel);
        for (let i = 0; i < segmentLength; i++) {
          outputData[i] = inputData[startSample + i];
        }
      }

      // Convert audio buffer to WAV format
      const wavBlob = audioBufferToWav(segmentBuffer);
      
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

  // Helper function to convert AudioBuffer to WAV blob
  const audioBufferToWav = (buffer: AudioBuffer): Blob => {
    const length = buffer.length;
    const numberOfChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const arrayBuffer = new ArrayBuffer(44 + length * numberOfChannels * 2);
    const view = new DataView(arrayBuffer);
    const channels: Float32Array[] = [];
    let offset = 0;
    let pos = 0;

    // Write WAV header
    const setUint16 = (data: number) => {
      view.setUint16(pos, data, true);
      pos += 2;
    };
    const setUint32 = (data: number) => {
      view.setUint32(pos, data, true);
      pos += 4;
    };

    // RIFF identifier
    setUint32(0x46464952); // "RIFF"
    setUint32(36 + length * numberOfChannels * 2); // File size - 8
    setUint32(0x45564157); // "WAVE"
    setUint32(0x20746d66); // "fmt "
    setUint32(16); // Format chunk size
    setUint16(1); // Audio format (1 = PCM)
    setUint16(numberOfChannels);
    setUint32(sampleRate);
    setUint32(sampleRate * numberOfChannels * 2); // Byte rate
    setUint16(numberOfChannels * 2); // Block align
    setUint16(16); // Bits per sample
    setUint32(0x61746164); // "data"
    setUint32(length * numberOfChannels * 2); // Data chunk size

    // Write audio data
    for (let i = 0; i < numberOfChannels; i++) {
      channels.push(buffer.getChannelData(i));
    }

    while (pos < arrayBuffer.byteLength) {
      for (let i = 0; i < numberOfChannels; i++) {
        let sample = Math.max(-1, Math.min(1, channels[i][offset]));
        sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(pos, sample, true);
        pos += 2;
      }
      offset++;
    }

    return new Blob([arrayBuffer], { type: "audio/wav" });
  };

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
          setHasOpenAIKey(false);
          alert("OpenAI API key not configured. Please configure your API key in Settings to use summarization features.");
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

    if (!hasOpenAIKey) {
      setError("OpenAI API key not configured. Please configure your API key in Settings to generate summaries.");
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
        const errorMessage = errorData.message || errorData.error || "Failed to generate summary";
        
        // Check if it's an API key error
        if (errorMessage.includes("API key not configured") || errorMessage.includes("not available")) {
          setHasOpenAIKey(false);
        }
        
        throw new Error(errorMessage);
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

  const exportToWord = async () => {
    if (!fullSummary) return;
    
    try {
      // Dynamically import docx and file-saver
      const { Document, Packer, Paragraph, TextRun, HeadingLevel, NumberFormat } = await import("docx");
      const { saveAs } = await import("file-saver");
      
      const docElements: any[] = [];
      const lines = fullSummary.split(/\n/);
      
      let i = 0;
      while (i < lines.length) {
        const line = lines[i].trim();
        
        // Skip empty lines
        if (!line) {
          i++;
          continue;
        }
        
        // Detect section headings (common patterns)
        const isSectionHeading = /^(announcements?|sharing|sermon|message|key points?|takeaways?|scripture|closing|introduction|summary)/i.test(line) &&
                                 (line.length < 100 && (line === line.toUpperCase() || line.split(" ").length < 5));
        
        // Detect markdown headings (# ## ###)
        const markdownHeading = line.match(/^(#{1,3})\s+(.+)$/);
        
        // Detect bullet points (-, *, •, or numbered 1. 2. etc.)
        const bulletMatch = line.match(/^[\s]*[-*•]\s+(.+)$/);
        const numberedMatch = line.match(/^[\s]*(\d+)[.)]\s+(.+)$/);
        
        if (markdownHeading) {
          // Markdown heading
          const level = markdownHeading[1].length;
          const text = markdownHeading[2].trim();
          docElements.push(new Paragraph({
            text: text,
            heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
            spacing: { after: 200, before: level === 1 ? 0 : 120 },
          }));
          i++;
        } else if (isSectionHeading) {
          // Section heading
          docElements.push(new Paragraph({
            text: line,
            heading: HeadingLevel.HEADING_2,
            spacing: { after: 200, before: 240 },
          }));
          i++;
        } else if (bulletMatch || numberedMatch) {
          // Determine if it's a numbered list or bullet list
          const isNumbered = !!numberedMatch;
          
          // Collect all consecutive bullet/numbered points
          const listItems: string[] = [];
          while (i < lines.length) {
            const currentLine = lines[i].trim();
            const currentBullet = currentLine.match(/^[\s]*[-*•]\s+(.+)$/);
            const currentNumbered = currentLine.match(/^[\s]*(\d+)[.)]\s+(.+)$/);
            
            if (isNumbered && currentNumbered && currentNumbered.length >= 3) {
              // currentNumbered[1] is the number, currentNumbered[2] is the text
              const itemText = currentNumbered[2]?.trim();
              if (itemText) {
                listItems.push(itemText);
              }
              i++;
            } else if (!isNumbered && currentBullet) {
              // currentBullet[1] is the text
              const itemText = currentBullet[1]?.trim();
              if (itemText) {
                listItems.push(itemText);
              }
              i++;
            } else if (!currentLine) {
              // Empty line - might be end of list
              i++;
              break;
            } else {
              // Not a list item, stop collecting
              break;
            }
          }
          
          // Create list
          if (listItems.length > 0) {
            listItems.forEach((item, idx) => {
              if (isNumbered) {
                // Numbered list
                docElements.push(new Paragraph({
                  text: item,
                  numbering: {
                    reference: "default-numbering",
                    level: 0,
                  },
                  spacing: { after: 100 },
                }));
              } else {
                // Bullet list
                docElements.push(new Paragraph({
                  text: item,
                  bullet: {
                    level: 0,
                  },
                  spacing: { after: 100 },
                }));
              }
            });
            // Add spacing after list
            docElements.push(new Paragraph({
              text: "",
              spacing: { after: 120 },
            }));
          }
        } else {
          // Regular paragraph - collect until we hit a heading or bullet
          const paraLines: string[] = [line];
          i++;
          
          // Collect consecutive non-bullet, non-heading lines
          while (i < lines.length) {
            const nextLine = lines[i].trim();
            if (!nextLine) {
              i++;
              break;
            }
            
            // Stop if we hit a heading or bullet
            if (nextLine.match(/^#{1,3}\s+/) || 
                nextLine.match(/^[\s]*[-*•]\s+/) ||
                nextLine.match(/^[\s]*\d+[.)]\s+/) ||
                (/^(announcements?|sharing|sermon|message|key points?|takeaways?|scripture|closing|introduction|summary)/i.test(nextLine) &&
                 nextLine.length < 100 && (nextLine === nextLine.toUpperCase() || nextLine.split(" ").length < 5))) {
              break;
            }
            
            paraLines.push(nextLine);
            i++;
          }
          
          // Create paragraph from collected lines
          const paraText = paraLines.join(" ").trim();
          if (paraText) {
            docElements.push(new Paragraph({
              text: paraText,
              spacing: { after: 120 },
            }));
          }
        }
      }
      
      // Create the document with numbering support
      const doc = new Document({
        numbering: {
          config: [
            {
              reference: "default-numbering",
              levels: [
                {
                  level: 0,
                  format: NumberFormat.DECIMAL,
                  text: "%1.",
                  alignment: "left",
                },
              ],
            },
          ],
        },
        sections: [
          {
            children: docElements,
          },
        ],
      });
      
      // Generate and download the Word document
      const blob = await Packer.toBlob(doc);
      
      // Get recording title or use default filename
      const recordingTitle = sections.find(s => s.label === "Sermon")?.text?.substring(0, 50) || "Sermon Summary";
      const filename = `${recordingTitle.replace(/[^a-z0-9]/gi, "_")}_${new Date().toISOString().split("T")[0]}.docx`;
      
      saveAs(blob, filename);
      alert("Word document exported successfully!");
    } catch (err) {
      console.error("Failed to export to Word:", err);
      alert("Failed to export to Word document. Please try again.");
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

  const handleAutoDetectSegments = async () => {
    if (!recordingId) return;

    if (!hasOpenAIKey) {
      alert("OpenAI API key is required for auto-detection. Please configure it in Settings.");
      return;
    }

    if (!confirm("This will analyze the transcript and automatically detect where Announcements, Sharing, and Sermon sections begin. Existing segments will be replaced. Continue?")) {
      return;
    }

    setDetectingSegments(true);
    setError(null);

    try {
      const { supabase } = await import("@/lib/supabase/client");
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Not authenticated");
      }

      const response = await fetch(`/api/recordings/${recordingId}/detect-segments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || errorData.error || "Failed to detect segments");
      }

      const data = await response.json();
      
      // Reload sections from the database
      const recordingResponse = await fetch(`/api/recordings/${recordingId}`, {
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
        },
      });

      if (recordingResponse.ok) {
        const recordingData = await recordingResponse.json();
        const recording = recordingData.recording;

        if (recording.segments && Array.isArray(recording.segments) && recording.segments.length > 0) {
          const loadedSections = recording.segments as FinalSection[];
          setSections(
            loadedSections.map((s: FinalSection, i: number) => ({
              ...s,
              id: `section-${i}`,
            }))
          );
        }
      }

      alert(`Successfully detected ${data.segments?.length || 0} segment(s)! Review and adjust the times if needed.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to detect segments");
      alert(err instanceof Error ? err.message : "Failed to detect segments");
    } finally {
      setDetectingSegments(false);
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
            {hasOpenAIKey === false && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2 mr-4">
                <p className="text-sm text-yellow-800">
                  ⚠️ Configure OpenAI API key in <a href="/settings" className="underline font-semibold">Settings</a> to use summarization
                </p>
              </div>
            )}
            <button
              onClick={generateFullSummary}
              disabled={generatingSummary || sections.length === 0 || hasOpenAIKey === false}
              className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              title={hasOpenAIKey === false ? "OpenAI API key required. Configure in Settings." : ""}
            >
              {generatingSummary ? "Generating..." : "Generate Summary for Members"}
            </button>
            <button
              onClick={handleAutoDetectSegments}
              disabled={detectingSegments || sections.length === 0 || hasOpenAIKey === false}
              className="px-6 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
              title={hasOpenAIKey === false ? "OpenAI API key required. Configure in Settings." : "Automatically detect where Announcements, Sharing, and Sermon sections begin"}
            >
              {detectingSegments ? "Detecting..." : "Auto-detect Segments"}
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
                <div className="flex-1">
                  <h2 className="text-xl font-semibold text-gray-900">
                    {section.label}
                  </h2>
                  {/* Segment Time Editing */}
                  <div className="mt-2 flex gap-4 items-center">
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-gray-600">Start:</label>
                      <input
                        type="number"
                        value={Math.floor(section.startMs / 1000)}
                        onChange={(e) => {
                          const seconds = parseInt(e.target.value) || 0;
                          updateSection(section.id, { startMs: seconds * 1000 });
                        }}
                        className="w-20 px-2 py-1 text-xs border border-gray-300 rounded"
                        placeholder="seconds"
                      />
                      <span className="text-xs text-gray-500">
                        ({formatTime(section.startMs)})
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-gray-600">End:</label>
                      <input
                        type="number"
                        value={section.endMs ? Math.floor(section.endMs / 1000) : ""}
                        onChange={(e) => {
                          const seconds = parseInt(e.target.value);
                          updateSection(section.id, { endMs: seconds && seconds > 0 ? seconds * 1000 : undefined });
                        }}
                        className="w-20 px-2 py-1 text-xs border border-gray-300 rounded"
                        placeholder="seconds"
                      />
                      <span className="text-xs text-gray-500">
                        {section.endMs ? `(${formatTime(section.endMs)})` : "(end of recording)"}
                      </span>
                    </div>
                  </div>
                </div>
                {section.label === "Sermon" && (
                  <button
                    onClick={() => handleDownloadSermonSegment(section)}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
                  >
                    Download Sermon Segment
                  </button>
                )}
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
                  onClick={exportToWord}
                  className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                >
                  Export to Word
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

