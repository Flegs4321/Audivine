"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { TranscriptionProviderComponent, useTranscription } from "./context/TranscriptionProvider";
import type { TranscriptChunk } from "./types/transcription";
import { uploadRecording } from "@/lib/supabase/storage";
import { useAuth } from "../auth/context/AuthProvider";
import Header from "../components/Header";

type RecordingState = "idle" | "recording" | "paused" | "stopped";
type SegmentType = "Announcements" | "Sharing" | "Sermon";

interface Segment {
  type: SegmentType;
  startMs: number;
  endMs: number | null;
}

// Maximum number of transcript chunks to display (keep most recent)
const MAX_DISPLAYED_TRANSCRIPT_CHUNKS = 100;

function RecorderPageContent() {
  const router = useRouter();
  const transcription = useTranscription();
  const { user, signOut, loading: authLoading } = useAuth();
  const [state, setState] = useState<RecordingState>("idle");

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login?redirect=/recorder");
    }
  }, [user, authLoading, router]);

  // Load transcription method from settings
  useEffect(() => {
    const loadTranscriptionMethod = async () => {
      if (!user) return;

      try {
        const { supabase } = await import("@/lib/supabase/client");
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!session?.access_token) return;

        const response = await fetch("/api/settings", {
          headers: {
            "Authorization": `Bearer ${session.access_token}`,
          },
        });

        if (response.ok) {
          const data = await response.json();
          const method = (data.settings?.transcription_method as "browser" | "openai") || "browser";
          setTranscriptionMethod(method);
        }
      } catch (err) {
        console.error("Error loading transcription method:", err);
      }
    };

    loadTranscriptionMethod();
    
    // Refresh when window regains focus (user might have changed settings in another tab)
    const handleFocus = () => {
      loadTranscriptionMethod();
    };
    window.addEventListener("focus", handleFocus);
    
    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, [user]);

  // Load speakers for sharing time (tagged speakers will appear first)
  useEffect(() => {
    const loadMembers = async () => {
      if (!user) return;

      try {
        setLoadingMembers(true);
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
          setMembers(data.speakers || []);
        }
      } catch (err) {
        console.error("Error loading members:", err);
      } finally {
        setLoadingMembers(false);
      }
    };

    loadMembers();
  }, [user]);

  const [activeSegment, setActiveSegment] = useState<SegmentType | null>(null);
  const [activeSegmentStartMs, setActiveSegmentStartMs] = useState<number | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [elapsedTime, setElapsedTime] = useState(0); // in seconds
  const [transcriptChunks, setTranscriptChunks] = useState<TranscriptChunk[]>([]);
  const [currentSpeaker, setCurrentSpeaker] = useState<string | null>(null); // Track current speaker
  const [members, setMembers] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [showMemberDropdown, setShowMemberDropdown] = useState(false);
  const [showSermonSpeakerDropdown, setShowSermonSpeakerDropdown] = useState(false);
  const [memberSearchQuery, setMemberSearchQuery] = useState("");
  const [sermonSpeakerSearchQuery, setSermonSpeakerSearchQuery] = useState("");
  const [recentlyTaggedSpeakers, setRecentlyTaggedSpeakers] = useState<string[]>([]); // Track recently tagged speakers for quick access
  const [keepDropdownOpen, setKeepDropdownOpen] = useState(false); // Option to keep dropdown open for consecutive tagging
  const [error, setError] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string>("audio/webm");
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | undefined>(undefined);
  const [transcriptionMethod, setTranscriptionMethod] = useState<"browser" | "openai">("browser");
  const [sharingHintDismissed, setSharingHintDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("recorder-sharing-hint-dismissed") === "1";
  });
  const [isSecureContext, setIsSecureContext] = useState(true);

  useEffect(() => {
    if (typeof window !== "undefined") setIsSecureContext(window.isSecureContext);
  }, []);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const pausedTimeRef = useRef<number>(0); // Total paused time in milliseconds
  const pauseStartTimeRef = useRef<number | null>(null); // When pause started
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioUrlRef = useRef<string | null>(null);
  const segmentsRef = useRef<Segment[]>([]);
  const transcriptChunksRef = useRef<TranscriptChunk[]>([]);
  const elapsedTimeRef = useRef<number>(0);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const currentSpeakerRef = useRef<string | null>(null); // Ref to track current speaker for transcript chunks

  const seenFinalTextsRef = useRef<Set<string>>(new Set());
  const transcriptionCallbackRef = useRef<((chunk: TranscriptChunk) => void) | null>(null);
  const chunkHandlerRef = useRef<(chunk: TranscriptChunk) => void>(() => {});
  const lastChunkTimeRef = useRef<number>(0);

  /** Web Speech often dies after dropdown/focus changes; isActive can stay true while no results arrive. */
  const restartLiveTranscription = useCallback(
    async (reason: string) => {
      if (!transcription.isAvailable) return;
      console.log(`[Recorder] Live transcription restart (${reason})`);
      try {
        if (transcription.isActive) transcription.stop();
        await new Promise((r) => setTimeout(r, 280));
        if (transcriptionCallbackRef.current) {
          transcription.onTextChunk(transcriptionCallbackRef.current);
        }
        await transcription.start();
      } catch (err) {
        console.error("[Recorder] Live transcription restart failed:", err);
      }
    },
    [transcription]
  );

  // Timer effect
  useEffect(() => {
    if (state === "recording" && startTimeRef.current !== null) {
      intervalRef.current = setInterval(() => {
        const now = Date.now();
        const totalElapsed = now - startTimeRef.current! - pausedTimeRef.current;
        const elapsed = Math.floor(totalElapsed / 1000);
        setElapsedTime(elapsed);
        elapsedTimeRef.current = elapsed;
      }, 100); // Update every 100ms for smooth display
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [state]);

  // Update audioUrlRef when audioUrl changes
  useEffect(() => {
    audioUrlRef.current = audioUrl;
  }, [audioUrl]);

  // Cleanup MediaStream and audio URL on unmount
  useEffect(() => {
    return () => {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
      }
    };
  }, []);

  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const formatTimeMs = (milliseconds: number): string => {
    const totalSeconds = Math.floor(milliseconds / 1000);
    return formatTime(totalSeconds);
  };

  const getCurrentElapsedMs = (): number => {
    if (startTimeRef.current === null) return 0;
    const now = state === "paused" && pauseStartTimeRef.current !== null
      ? pauseStartTimeRef.current
      : Date.now();
    return now - startTimeRef.current - pausedTimeRef.current;
  };

  // Enumerate available audio input devices
  const enumerateAudioDevices = async (forcePermission = false) => {
    try {
      // Check if mediaDevices API is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        console.warn("Device enumeration not supported");
        return;
      }

      // Request permission to access devices (required for device labels)
      // If forcePermission is true, we'll try harder to get permission
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Stop the stream immediately - we just needed permission
        stream.getTracks().forEach(track => track.stop());
      } catch (err) {
        // Permission might be denied, but we can still try to enumerate
        console.warn("Permission denied for getUserMedia, but continuing enumeration");
        if (forcePermission) {
          alert("Microphone permission is required to see device names. Please allow microphone access in your browser settings.");
        }
      }

      // Enumerate all devices
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(device => device.kind === 'audioinput');
      
      console.log(`[Device Enumeration] Found ${audioInputs.length} audio input device(s):`, 
        audioInputs.map(d => ({ id: d.deviceId, label: d.label || 'Unnamed Device' }))
      );
      
      setAudioInputDevices(audioInputs);

      // Set the first device as default if none selected
      if (audioInputs.length > 0 && !selectedDeviceId) {
        setSelectedDeviceId(audioInputs[0].deviceId);
      }
    } catch (err) {
      console.error('Error enumerating audio devices:', err);
    }
  };

  // Enumerate audio devices on mount
  useEffect(() => {
    enumerateAudioDevices();
  }, []);

  // Listen for device changes (when devices are added/removed)
  useEffect(() => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.addEventListener) {
      return;
    }

    const handleDeviceChange = () => {
      console.log("[Device Change] Audio device added or removed, re-enumerating...");
      enumerateAudioDevices();
    };

    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);

    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    };
  }, []);

  const handleStartRecording = async () => {
    try {
      setError(null);
      // Clean up previous audio URL to prevent memory leaks
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }
      setAudioBlob(null);
      setAudioUrl(null);
      setAudioDuration(null);
      audioChunksRef.current = [];

      // Check if MediaRecorder is supported
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error(
          "Your browser does not support audio recording. Please use a modern browser like Chrome, Firefox, or Edge."
        );
      }

      // Re-enumerate devices right before recording (in case a device was just plugged in)
      await enumerateAudioDevices();

      // Request microphone permission and get media stream with selected device
      let stream: MediaStream;
      try {
        const audioConstraints: boolean | MediaTrackConstraints = selectedDeviceId
          ? { deviceId: { exact: selectedDeviceId } }
          : true;
        stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      } catch (err) {
        if (err instanceof Error) {
          if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
            throw new Error(
              "Microphone permission denied. Please allow microphone access in your browser settings and try again."
            );
          } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
            throw new Error("No microphone found. Please connect a microphone and try again.");
          } else {
            throw new Error(`Failed to access microphone: ${err.message}`);
          }
        }
        throw new Error("Failed to access microphone. Please try again.");
      }

      mediaStreamRef.current = stream;

      // Use standard MediaRecorder (records in WebM format)
      // WebM is well-supported and works reliably across browsers
      // Note: For MP3, you can convert the recording after download using tools like FFmpeg
      const mimeTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
      ];
      
      let selectedMimeType = 'audio/webm';
      for (const mimeType of mimeTypes) {
        if (MediaRecorder.isTypeSupported(mimeType)) {
          selectedMimeType = mimeType;
          break;
        }
      }
      
      setMimeType(selectedMimeType);

      // Create standard MediaRecorder
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: selectedMimeType,
      });

      mediaRecorderRef.current = mediaRecorder;

      // Collect audio chunks
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        } else {
        }
      };

      // Handle when recording stops
      mediaRecorder.onstop = async () => {
        // Create blob from collected chunks
        if (audioChunksRef.current.length > 0) {
          const totalSize = audioChunksRef.current.reduce((sum, chunk) => sum + chunk.size, 0);
          const blob = new Blob(audioChunksRef.current, { type: selectedMimeType });
          setAudioBlob(blob);

          // Create object URL for audio playback
          const url = URL.createObjectURL(blob);
          setAudioUrl(url);

          // Upload to Supabase
          handleUploadToSupabase(blob, selectedMimeType);
        } else {
        }
        mediaRecorderRef.current = null;
      };

      // Handle errors from MediaRecorder
      mediaRecorder.onerror = (event) => {
        console.error("MediaRecorder error:", event);
        setError("An error occurred during recording. Please try again.");
        handleEndRecording();
      };

      setState("recording");
      setElapsedTime(0);
      setTranscriptChunks([]);
      setActiveSegment(null);
      setActiveSegmentStartMs(null);
      setSegments([]);
      setUploadStatus("idle");
      setUploadedUrl(null);
      setUploadError(null);
      startTimeRef.current = Date.now();
      segmentsRef.current = [];
      transcriptChunksRef.current = [];
      elapsedTimeRef.current = 0;
      setCurrentSpeaker(null);
      currentSpeakerRef.current = null;
      setRecentlyTaggedSpeakers([]);
      seenFinalTextsRef.current.clear();
      lastChunkTimeRef.current = 0;

      // Start Web Speech BEFORE MediaRecorder.start(). Many environments starve or block speech
      // recognition if capture has already started; delayed start also loses user-activation timing.
      if (transcription.isAvailable) {
        try {
          if (transcriptionCallbackRef.current) {
            transcription.onTextChunk(transcriptionCallbackRef.current);
          }
          await transcription.start();
        } catch (err) {
          console.error("[Recorder] Failed to start live transcription:", err);
          setError(
            "Live captions failed to start (recording still works). Use Chrome or Edge on HTTPS, or set OpenAI transcription in Settings for text after upload."
          );
        }
      }

      mediaRecorder.start();
    } catch (err) {
      console.error("Error starting recording:", err);
      setError(err instanceof Error ? err.message : "Failed to start recording");
      setState("idle");
    }
  };

  const handleEndRecording = async () => {
    try {
      if (transcription.isActive) {
        transcription.stop();
        // Let the speech engine flush pending results to onresult before we snapshot
        await new Promise((resolve) => setTimeout(resolve, 650));
      }

      // Close active segment if any
      if (activeSegment !== null && activeSegmentStartMs !== null) {
        const currentMs = getCurrentElapsedMs();
        const finalSegments = [
          ...segments,
          {
            type: activeSegment,
            startMs: activeSegmentStartMs,
            endMs: currentMs,
          },
        ];
        setSegments(finalSegments);
        segmentsRef.current = finalSegments;
        setActiveSegment(null);
        setActiveSegmentStartMs(null);
      } else {
        segmentsRef.current = segments;
      }

      // transcriptChunksRef is updated inside the chunk handler and is the source of truth for upload.
      // Do not assign from `transcriptChunks` state here — that value can lag and would drop live text.
      setTranscriptChunks(() => [...transcriptChunksRef.current]);
      elapsedTimeRef.current = elapsedTime;

      // Stop MediaRecorder if it's active
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        
        const recorder = mediaRecorderRef.current;
        const chunksBeforeStop = audioChunksRef.current.length;
        
        // Stop the recorder
        // Note: Mp3MediaRecorder doesn't support requestData() - dataavailable fires automatically on stop
        recorder.stop();
      }

      // Stop all tracks in the media stream
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }

      setState("stopped");
      startTimeRef.current = null;
    } catch (err) {
      console.error("Error stopping recording:", err);
      setError(err instanceof Error ? err.message : "Failed to stop recording");
      setState("idle");
    }
  };

  const handlePauseRecording = () => {
    try {
      // Pause MediaRecorder if supported
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        // Check if pause is supported
        if (typeof mediaRecorderRef.current.pause === "function") {
          mediaRecorderRef.current.pause();
        } else {
          console.warn("MediaRecorder pause is not supported in this browser");
        }
      }

      // Stop transcription (will restart on resume)
      if (transcription.isActive) {
        transcription.stop();
      }

      // Record pause start time
      pauseStartTimeRef.current = Date.now();
      setState("paused");
    } catch (err) {
      console.error("Error pausing recording:", err);
      setError(err instanceof Error ? err.message : "Failed to pause recording");
    }
  };

  const handleResumeRecording = async () => {
    try {
      // Calculate paused duration and add to total
      if (pauseStartTimeRef.current !== null) {
        const pausedDuration = Date.now() - pauseStartTimeRef.current;
        pausedTimeRef.current += pausedDuration;
        pauseStartTimeRef.current = null;
      }

      if (transcription.isAvailable && !transcription.isActive) {
        try {
          if (transcriptionCallbackRef.current) {
            transcription.onTextChunk(transcriptionCallbackRef.current);
          }
          await transcription.start();
          if (transcriptionCallbackRef.current) {
            transcription.onTextChunk(transcriptionCallbackRef.current);
          }
        } catch (err) {
          console.error("[Recorder] Failed to restart transcription:", err);
        }
      }

      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "paused") {
        if (typeof mediaRecorderRef.current.resume === "function") {
          mediaRecorderRef.current.resume();
        } else {
          console.warn("MediaRecorder resume is not supported in this browser");
        }
      }

      setState("recording");
    } catch (err) {
      console.error("Error resuming recording:", err);
      setError(err instanceof Error ? err.message : "Failed to resume recording");
    }
  };

  const handleSegmentClick = (segment: SegmentType) => {
    // Only allow segment selection when recording (not paused)
    if (state !== "recording") {
      console.warn("[Recorder] Cannot change segment while paused. Please resume recording first.");
      return;
    }

    const currentMs = getCurrentElapsedMs();

    // Close previous segment if any
    if (activeSegment !== null && activeSegmentStartMs !== null) {
      setSegments((prev) => [
        ...prev,
        {
          type: activeSegment,
          startMs: activeSegmentStartMs,
          endMs: currentMs,
        },
      ]);
    }

    // Start new segment
    setActiveSegment(segment);
    setActiveSegmentStartMs(currentMs);

    // Show member dropdown if Sharing segment is selected
    if (segment === "Sharing") {
      setShowMemberDropdown(true);
      setShowSermonSpeakerDropdown(false);
      setKeepDropdownOpen(false); // Reset keep open when switching segments
    } else if (segment === "Sermon") {
      setShowSermonSpeakerDropdown(true);
      setShowMemberDropdown(false);
    } else {
      setShowMemberDropdown(false);
      setShowSermonSpeakerDropdown(false);
    }
  };

  const handleEndCurrentSegment = () => {
    if (state !== "recording" || activeSegment === null || activeSegmentStartMs === null) return;
    const currentMs = getCurrentElapsedMs();
    setSegments((prev) => {
      const next = [
        ...prev,
        { type: activeSegment, startMs: activeSegmentStartMs, endMs: currentMs },
      ];
      segmentsRef.current = next;
      return next;
    });
    setActiveSegment(null);
    setActiveSegmentStartMs(null);
    setShowMemberDropdown(false);
    setShowSermonSpeakerDropdown(false);
    setKeepDropdownOpen(false);
  };

  const handleMemberSelect = async (memberName: string, keepOpen = false) => {
    if (!memberName.trim()) return;

    const currentMs = getCurrentElapsedMs();
    
    // Set this member as the current speaker for subsequent chunks
    setCurrentSpeaker(memberName);
    currentSpeakerRef.current = memberName;
    console.log(`[Recorder] Speaker set to: ${memberName}, ref: ${currentSpeakerRef.current}`);
    
    // Add to recently tagged speakers (most recent first, max 5)
    setRecentlyTaggedSpeakers((prev) => {
      const filtered = prev.filter(name => name !== memberName);
      return [memberName, ...filtered].slice(0, 5);
    });
    
    // Retroactively apply speaker to recent chunks (if tagging late)
    // Find the last speaker tag or the start of the current segment
    setTranscriptChunks((prev) => {
      const chunks = [...prev];
      let lastSpeakerTagIndex = -1;
      let segmentStartIndex = -1;
      
      // Find the last speaker tag
      for (let i = chunks.length - 1; i >= 0; i--) {
        if (chunks[i].speakerTag) {
          lastSpeakerTagIndex = i;
          break;
        }
      }
      
      // Find the start of the current segment (if in Sharing segment)
      if (activeSegment === "Sharing" && activeSegmentStartMs !== null) {
        for (let i = chunks.length - 1; i >= 0; i--) {
          if (chunks[i].timestampMs >= activeSegmentStartMs) {
            segmentStartIndex = i;
          } else {
            break;
          }
        }
      }
      
      // Determine where to start retroactive tagging
      // Start from the last speaker tag, or segment start, or beginning of recent chunks (last 20)
      const startIndex = Math.max(
        lastSpeakerTagIndex + 1,
        segmentStartIndex >= 0 ? segmentStartIndex : Math.max(0, chunks.length - 20)
      );
      
      // Retroactively apply speaker to chunks without a speaker
      // But stop if there's a gap of more than 12 seconds between consecutive chunks
      const MAX_RETROACTIVE_GAP_MS = 12000; // 12 seconds
      // Don't attribute the phrase you just said (e.g. "this is now sharing time") to the person you're tagging
      const MIN_AGE_FOR_RETROACTIVE_MS = 4000; // 4 seconds: chunks within 4s of "now" are left untagged
      let lastProcessedTimestamp = currentMs;
      let shouldContinue = true;
      
      const updated = chunks.map((chunk, index) => {
        if (!shouldContinue) return chunk;
        
        if (index >= startIndex && !chunk.speakerTag && !chunk.speaker) {
          // Skip chunks that are too recent (likely the transition phrase you just said)
          const ageMs = currentMs - chunk.timestampMs;
          if (ageMs < MIN_AGE_FOR_RETROACTIVE_MS) return chunk;
          
          // Check if there's a gap of more than 12 seconds from the last processed chunk
          const timeGap = lastProcessedTimestamp - chunk.timestampMs;
          
          if (timeGap > MAX_RETROACTIVE_GAP_MS) {
            // Gap is too large, stop retroactive tagging
            shouldContinue = false;
            console.log(`[Recorder] Stopping retroactive tagging due to ${(timeGap / 1000).toFixed(1)}s gap`);
            return chunk;
          }
          
          // Also check gap to the next chunk (if exists) to catch pauses
          if (index < chunks.length - 1) {
            const nextChunk = chunks[index + 1];
            const gapToNext = nextChunk.timestampMs - chunk.timestampMs;
            if (gapToNext > MAX_RETROACTIVE_GAP_MS) {
              // There's a large gap after this chunk, stop here
              shouldContinue = false;
              console.log(`[Recorder] Stopping retroactive tagging due to ${(gapToNext / 1000).toFixed(1)}s gap after chunk`);
              return chunk;
            }
          }
          
          // Apply speaker as metadata only; do not rewrite chunk text (avoids repeating speaker name in transcript)
          lastProcessedTimestamp = chunk.timestampMs;
          return {
            ...chunk,
            speaker: memberName,
          };
        }
        return chunk;
      });
      
      // Insert member name as a special chunk in the transcript
      // Format: "Name - sharing:" so OpenAI can recognize it
      const memberChunk: TranscriptChunk = {
        text: `${memberName} - sharing:`,
        timestampMs: currentMs,
        isFinal: true,
        speaker: memberName,
        speakerTag: true, // Mark as speaker tag for better visual distinction
      };
      
      const finalUpdated = [...updated, memberChunk];
      transcriptChunksRef.current = finalUpdated;
      return finalUpdated;
    });

    // Keep dropdown open if requested (for consecutive tagging) or if keepDropdownOpen is true
    if (!keepOpen && !keepDropdownOpen) {
      setShowMemberDropdown(false);
      setMemberSearchQuery("");
    } else {
      // Keep dropdown open but clear search to show all options again
      setMemberSearchQuery("");
    }

    if (state === "recording" && transcription.isAvailable) {
      await restartLiveTranscription("after sharing speaker tag");
    }
  };

  // Handle ending current speaker (for moderator or when speaker finishes)
  const handleEndSpeaker = () => {
    const currentMs = getCurrentElapsedMs();
    
    // Clear current speaker
    setCurrentSpeaker(null);
    currentSpeakerRef.current = null;
    
    // Optionally add a marker in the transcript to indicate speaker ended
    // This helps with formatting but doesn't add unnecessary text
    console.log("[Recorder] Speaker ended at", formatTimeMs(currentMs));
  };

  const handleSermonSpeakerSelect = async (speakerName: string) => {
    if (!speakerName.trim()) return;

    const currentMs = getCurrentElapsedMs();
    
    // Set this speaker as the current speaker for subsequent chunks
    setCurrentSpeaker(speakerName);
    currentSpeakerRef.current = speakerName;
    
    // Retroactively apply speaker to recent chunks (if tagging late)
    setTranscriptChunks((prev) => {
      const chunks = [...prev];
      let lastSpeakerTagIndex = -1;
      let segmentStartIndex = -1;
      
      // Find the last speaker tag
      for (let i = chunks.length - 1; i >= 0; i--) {
        if (chunks[i].speakerTag) {
          lastSpeakerTagIndex = i;
          break;
        }
      }
      
      // Find the start of the current segment (if in Sermon segment)
      if (activeSegment === "Sermon" && activeSegmentStartMs !== null) {
        for (let i = chunks.length - 1; i >= 0; i--) {
          if (chunks[i].timestampMs >= activeSegmentStartMs) {
            segmentStartIndex = i;
          } else {
            break;
          }
        }
      }
      
      // Determine where to start retroactive tagging
      const startIndex = Math.max(
        lastSpeakerTagIndex + 1,
        segmentStartIndex >= 0 ? segmentStartIndex : Math.max(0, chunks.length - 20)
      );
      
      // Retroactively apply speaker to chunks without a speaker
      // But stop if there's a gap of more than 12 seconds between consecutive chunks
      const MAX_RETROACTIVE_GAP_MS = 12000; // 12 seconds
      // Don't attribute the phrase you just said (e.g. "we'll now hear from...") to the speaker you're tagging
      const MIN_AGE_FOR_RETROACTIVE_MS = 4000; // 4 seconds: chunks within 4s of "now" are left untagged
      let lastProcessedTimestamp = currentMs;
      let shouldContinue = true;
      
      const updated = chunks.map((chunk, index) => {
        if (!shouldContinue) return chunk;
        
        if (index >= startIndex && !chunk.speakerTag && !chunk.speaker) {
          // Skip chunks that are too recent (likely the transition phrase you just said)
          const ageMs = currentMs - chunk.timestampMs;
          if (ageMs < MIN_AGE_FOR_RETROACTIVE_MS) return chunk;
          
          // Check if there's a gap of more than 12 seconds from the last processed chunk
          const timeGap = lastProcessedTimestamp - chunk.timestampMs;
          
          if (timeGap > MAX_RETROACTIVE_GAP_MS) {
            // Gap is too large, stop retroactive tagging
            shouldContinue = false;
            console.log(`[Recorder] Stopping retroactive tagging due to ${(timeGap / 1000).toFixed(1)}s gap`);
            return chunk;
          }
          
          // Also check gap to the next chunk (if exists) to catch pauses
          if (index < chunks.length - 1) {
            const nextChunk = chunks[index + 1];
            const gapToNext = nextChunk.timestampMs - chunk.timestampMs;
            if (gapToNext > MAX_RETROACTIVE_GAP_MS) {
              // There's a large gap after this chunk, stop here
              shouldContinue = false;
              console.log(`[Recorder] Stopping retroactive tagging due to ${(gapToNext / 1000).toFixed(1)}s gap after chunk`);
              return chunk;
            }
          }
          
          // Apply speaker as metadata only; do not rewrite chunk text (avoids repeating speaker name in transcript)
          lastProcessedTimestamp = chunk.timestampMs;
          return {
            ...chunk,
            speaker: speakerName,
          };
        }
        return chunk;
      });
      
      // Insert speaker name as a special chunk in the transcript (says "sermon speaker" so transcript is clear)
      const speakerChunk: TranscriptChunk = {
        text: `${speakerName} - sermon speaker:`,
        timestampMs: currentMs,
        isFinal: true,
        speaker: speakerName,
        speakerTag: true, // Mark as speaker tag for better visual distinction
      };
      
      const finalUpdated = [...updated, speakerChunk];
      transcriptChunksRef.current = finalUpdated;
      return finalUpdated;
    });

    // Close dropdown after selection
    setShowSermonSpeakerDropdown(false);
    setSermonSpeakerSearchQuery("");

    if (state === "recording" && transcription.isAvailable) {
      await restartLiveTranscription("after sermon speaker tag");
    }
  };

  // Build the actual chunk handler and store in ref so it always has latest setTranscriptChunks etc.
  useEffect(() => {
    if (!transcription.isAvailable) return;

    const handleChunk = (chunk: TranscriptChunk) => {
      if (!chunk || typeof chunk.text !== "string") {
        console.warn("[Recorder] Ignoring invalid chunk:", chunk);
        return;
      }
      lastChunkTimeRef.current = Date.now();
      const speaker = currentSpeakerRef.current || undefined;
      // Store raw transcript text; do not prepend speaker name to every phrase (speaker appears once via tag + metadata)
      const chunkWithSpeaker: TranscriptChunk = {
        ...chunk,
        text: chunk.text,
        speaker: speaker,
      };

      // Web Speech fires outside React events; without flushSync, Chrome can batch many
      // onresult callbacks and the UI may not paint until recording stops.
      flushSync(() => {
        setTranscriptChunks((prev) => {
          if (chunk.speakerTag === true) {
            const updated = [...prev, chunk];
            transcriptChunksRef.current = updated;
            currentSpeakerRef.current = chunk.speaker || null;
            setCurrentSpeaker(chunk.speaker || null);
            return updated;
          }
          if (!chunkWithSpeaker.isFinal) {
            let next: TranscriptChunk[];
            if (prev.length > 0 && !prev[prev.length - 1].isFinal) {
              next = [...prev.slice(0, -1), chunkWithSpeaker];
            } else if (!seenFinalTextsRef.current.has(chunk.text)) {
              next = [...prev, chunkWithSpeaker];
            } else {
              return prev;
            }
            transcriptChunksRef.current = next;
            return next;
          }
          if (seenFinalTextsRef.current.has(chunk.text)) {
            return prev;
          }
          seenFinalTextsRef.current.add(chunk.text);
          const updated = [
            ...prev.filter((c) => {
              if (!c || typeof c.text !== "string") return false;
              if (c.isFinal) return true;
              const cOriginalText = c.text
                .replace(/^\[[^\]]+\]:\s*/, "")
                .replace(/^[^-]+\s*-\s*/, "");
              return cOriginalText !== chunk.text;
            }),
            chunkWithSpeaker,
          ];
          transcriptChunksRef.current = updated;
          if (updated.length > 500) {
            const trimmed = updated.slice(-500);
            transcriptChunksRef.current = trimmed;
            return trimmed;
          }
          return updated;
        });
      });

      setTimeout(() => {
        if (transcriptEndRef.current) {
          transcriptEndRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }, 100);
    };

    chunkHandlerRef.current = handleChunk;
    const forwarder = (chunk: TranscriptChunk) => {
      chunkHandlerRef.current?.(chunk);
    };
    transcriptionCallbackRef.current = forwarder;
    transcription.onTextChunk(forwarder);
  }, [transcription.isAvailable, transcription.onTextChunk]);

  // Sync our forwarder into the provider's ref when transcription becomes active (after start/resume).
  // The engine always uses the provider's stable wrapper; we only update the ref it forwards to.
  useEffect(() => {
    if (transcription.isAvailable && transcription.isActive && transcriptionCallbackRef.current) {
      transcription.onTextChunk(transcriptionCallbackRef.current);
    }
  }, [transcription.isAvailable, transcription.isActive, transcription.onTextChunk]);

  // Transcription health check: if we're recording and haven't received a chunk in 2 minutes,
  // the browser's SpeechRecognition likely stopped (onend sometimes doesn't fire). Force restart.
  const TRANSCRIPT_STALE_MS = 120000; // 2 minutes
  const HEALTH_CHECK_INTERVAL_MS = 30000; // Check every 30 seconds
  useEffect(() => {
    if (state !== "recording" || !transcription.isAvailable || !transcription.isActive) return;
    const id = setInterval(async () => {
      const last = lastChunkTimeRef.current;
      if (last === 0) return; // No chunks yet this session
      const elapsed = Date.now() - last;
      if (elapsed > TRANSCRIPT_STALE_MS) {
        console.warn("[Recorder] No transcript chunks for", Math.round(elapsed / 1000), "s - forcing transcription restart");
        try {
          transcription.stop();
          await new Promise((r) => setTimeout(r, 200));
          if (transcriptionCallbackRef.current) {
            transcription.onTextChunk(transcriptionCallbackRef.current);
          }
          await transcription.start();
          lastChunkTimeRef.current = Date.now();
          console.log("[Recorder] Transcription restarted by health check");
        } catch (err) {
          console.error("[Recorder] Health check restart failed:", err);
        }
      }
    }, HEALTH_CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [state, transcription]);

  // If Web Speech never delivered a chunk, restart once after 12s (cold start / policy quirks).
  useEffect(() => {
    if (state !== "recording" || !transcription.isAvailable) return;
    const id = window.setTimeout(() => {
      if (lastChunkTimeRef.current !== 0) return;
      void restartLiveTranscription("no chunks in first 12s");
    }, 12000);
    return () => clearTimeout(id);
  }, [state, transcription.isAvailable, restartLiveTranscription]);

  // Handle automatic section analysis
  const handleAnalyzeSections = async () => {
    if (!audioBlob || transcriptChunksRef.current.length === 0) {
      setError("No recording or transcript available for analysis");
      return;
    }

    try {
      setUploadStatus("uploading");
      setUploadError(null);

      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chunks: transcriptChunksRef.current,
          totalDurationMs: elapsedTimeRef.current * 1000,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Analysis failed: ${response.statusText}`);
      }

      const result = await response.json();

      // Generate a recording ID (you can replace this with actual recording ID from upload)
      const recordingId = uploadedUrl 
        ? uploadedUrl.split("/").pop()?.split(".")[0] || `recording-${Date.now()}`
        : `recording-${Date.now()}`;

      // Store sections temporarily (replace with database save later)
      localStorage.setItem(
        `recording-sections-${recordingId}`,
        JSON.stringify(result.sections)
      );

      // Navigate to review page
      router.push(`/recorder/review?id=${recordingId}`);
    } catch (err) {
      console.error("Analysis error:", err);
      setUploadError(err instanceof Error ? err.message : "Failed to analyze sections");
      setUploadStatus("error");
    }
  };

  // Handle upload to Supabase
  const handleUploadToSupabase = async (blob: Blob, mimeType: string) => {
    setUploadStatus("uploading");
    setUploadError(null);
    setUploadedUrl(null);

    try {
      // Use refs to ensure we have the latest values
      const finalSegments = segmentsRef.current;
      const finalTranscriptChunks = transcriptChunksRef.current;
      const finalElapsedTime = elapsedTimeRef.current;

      // Use the transcription method from state (already loaded from settings)
      // This ensures we use the current selection without needing to fetch again
      const currentTranscriptionMethod = transcriptionMethod || "browser";
      console.log("[Upload] Using transcription method:", currentTranscriptionMethod);

      const hasMeaningfulBrowserTranscript = finalTranscriptChunks.some(
        (c) =>
          !c.speakerTag &&
          typeof c.text === "string" &&
          c.text.trim().length > 0
      );
      const shouldRunWhisperAfterUpload =
        currentTranscriptionMethod === "openai" || !hasMeaningfulBrowserTranscript;

      const metadata = {
        filename: "recording",
        duration: finalElapsedTime,
        segments: finalSegments.map((s) => ({
          type: s.type,
          startMs: s.startMs,
          endMs: s.endMs,
        })),
        // Always save browser transcription chunks to preserve speaker information
        // Even when using OpenAI, we need these chunks so Whisper can preserve speaker tags
        transcriptChunks: finalTranscriptChunks.map((c) => ({
          text: c.text,
          timestampMs: c.timestampMs,
          isFinal: c.isFinal ?? true,
          speaker: c.speaker,
          speakerTag: c.speakerTag,
        })),
        mimeType,
        fileSize: blob.size,
      };

      const result = await uploadRecording(blob, metadata);

      if (result.success && result.url && result.recordingId) {
        setUploadStatus("success");
        setUploadedUrl(result.url);
        console.log("[Recorder] Upload successful, recording ID:", result.recordingId);
        
        // OpenAI setting: always Whisper. Browser setting: Whisper only if live captions produced no text
        // (avoids "edit recording" showing only a speaker tag when Web Speech never ran).
        if (shouldRunWhisperAfterUpload) {
          try {
            const { supabase } = await import("@/lib/supabase/client");
            const { data: { session } } = await supabase.auth.getSession();
            
            if (session?.access_token) {
              if (currentTranscriptionMethod === "browser" && !hasMeaningfulBrowserTranscript) {
                console.log(
                  "[Upload] No live browser transcript; attempting Whisper so the saved recording has full text"
                );
              }
              console.log("[Upload] Starting OpenAI Whisper transcription for recording:", result.recordingId);
              const transcribeResponse = await fetch("/api/sermons/transcribe", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({
                  recordingId: result.recordingId,
                  audioUrl: result.url,
                }),
              });

              if (transcribeResponse.ok) {
                const transcribeData = await transcribeResponse.json();
                console.log("[Upload] OpenAI Whisper transcription completed successfully");
                console.log("[Upload] Transcription chunks:", transcribeData.chunks?.length || 0);
                
                // Replace browser transcription with more accurate Whisper transcription
                // The API now preserves speaker information automatically
                if (transcribeData.chunks && Array.isArray(transcribeData.chunks)) {
                  // Use the chunks returned from the API (they already have speaker info preserved)
                  const whisperChunks = transcribeData.chunks;
                  
                  // Update the transcript display with Whisper chunks (already have speaker info)
                  setTranscriptChunks(whisperChunks);
                  transcriptChunksRef.current = whisperChunks;
                  
                  console.log("[Upload] Replaced browser transcription with Whisper transcription (speaker info preserved by API)");
                  console.log("[Upload] Chunks with speakers:", whisperChunks.filter((c: any) => c.speaker).length, "out of", whisperChunks.length);
                } else {
                  console.warn("[Upload] Whisper transcription completed but no chunks returned");
                }
              } else {
                const errorText = await transcribeResponse.text();
                console.error("[Upload] Whisper transcription failed:", transcribeResponse.status, errorText);
                if (currentTranscriptionMethod === "openai") {
                  setError(`Whisper transcription failed: ${errorText}`);
                }
              }
            } else {
              console.error("[Upload] No session token available for Whisper transcription");
            }
          } catch (err) {
            console.error("[Upload] Error during OpenAI Whisper transcription:", err);
            if (currentTranscriptionMethod === "openai") {
              setError(`Whisper transcription error: ${err instanceof Error ? err.message : "Unknown error"}`);
            }
          }
        } else {
          console.log("[Upload] Using browser transcription only (live text present), skipping Whisper");
        }
        
        // Refresh sermons list after successful upload
        // Navigate to sermons page to see the new recording
        setTimeout(() => {
          router.push("/sermons");
        }, 1000);
      } else {
        setUploadStatus("error");
        setUploadError(result.error || "Upload failed");
        console.error("[Recorder] Upload failed:", result.error);
      }
    } catch (err) {
      setUploadStatus("error");
      setUploadError(err instanceof Error ? err.message : "Upload failed");
      console.error("Upload error:", err);
    }
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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <Header />

      <div className="p-6">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl font-bold text-gray-900 mb-8">Recording Studio</h2>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Control Panel */}
          <div className="lg:col-span-2 space-y-6">
            {/* Recording Controls */}
            <div className="bg-white rounded-xl shadow-lg p-8">
              <div className="flex flex-col items-center space-y-6">
                {/* Audio Device Selection */}
                {(state === "idle" || state === "stopped") && (
                  <div className="w-full max-w-md">
                    <div className="flex items-center justify-between mb-2">
                      <label htmlFor="audio-device" className="block text-sm font-medium text-gray-700">
                        Audio Input Device:
                      </label>
                      <button
                        type="button"
                        onClick={() => enumerateAudioDevices(true)}
                        className="text-xs px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded border border-gray-300"
                        title="Refresh device list (useful after plugging in aux cable)"
                      >
                        🔄 Refresh
                      </button>
                    </div>
                    {audioInputDevices.length > 0 ? (
                      <>
                        <select
                          id="audio-device"
                          value={selectedDeviceId || ""}
                          onChange={(e) => setSelectedDeviceId(e.target.value)}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-red-500 focus:border-red-500"
                        >
                          {audioInputDevices.map((device, index) => (
                            <option key={device.deviceId} value={device.deviceId}>
                              {device.label || `Microphone ${index + 1}`}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-xs text-gray-500">
                          Select the audio input device you want to record from (e.g., soundboard via aux cable)
                        </p>
                      </>
                    ) : (
                      <div className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-500 text-sm">
                        No audio input devices found. Click "Refresh" after connecting your device.
                      </div>
                    )}
                  </div>
                )}

                {/* Start/End Recording Button */}
                {state === "idle" || state === "stopped" ? (
                  <button
                    onClick={handleStartRecording}
                    className="px-12 py-6 bg-red-600 text-white text-xl font-semibold rounded-full hover:bg-red-700 transition-all transform hover:scale-105 shadow-lg"
                  >
                    Start Recording
                  </button>
                ) : (
                  <div className="flex gap-4">
                    {state === "paused" ? (
                      <button
                        onClick={handleResumeRecording}
                        className="px-8 py-6 bg-green-600 text-white text-xl font-semibold rounded-full hover:bg-green-700 transition-all transform hover:scale-105 shadow-lg"
                      >
                        Resume
                      </button>
                    ) : (
                      <button
                        onClick={handlePauseRecording}
                        className="px-8 py-6 bg-yellow-600 text-white text-xl font-semibold rounded-full hover:bg-yellow-700 transition-all transform hover:scale-105 shadow-lg"
                      >
                        Pause
                      </button>
                    )}
                    <button
                      onClick={handleEndRecording}
                      className="px-8 py-6 bg-gray-800 text-white text-xl font-semibold rounded-full hover:bg-gray-900 transition-all transform hover:scale-105 shadow-lg"
                    >
                      End Recording
                    </button>
                  </div>
                )}

                {/* Timer Display */}
                {(state === "recording" || state === "paused") && (
                  <div className="text-center">
                    <div className="text-6xl font-mono font-bold text-gray-900 mb-2">
                      {formatTime(elapsedTime)}
                    </div>
                    <div className="flex items-center justify-center space-x-2">
                      {state === "recording" ? (
                        <>
                          <span className="w-3 h-3 bg-red-600 rounded-full animate-pulse"></span>
                          <span className="text-sm text-gray-600 uppercase tracking-wide">
                            Recording
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="w-3 h-3 bg-yellow-600 rounded-full"></span>
                          <span className="text-sm text-gray-600 uppercase tracking-wide">
                            Paused
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* Active Segment Label */}
                {(state === "recording" || state === "paused") && activeSegment && (
                  <div className="bg-blue-100 text-blue-800 px-6 py-3 rounded-lg font-semibold">
                    Active: {activeSegment}
                    {currentSpeaker && (
                      <span className="ml-3 text-blue-600">
                        • Current Speaker: <span className="font-bold">{currentSpeaker}</span>
                      </span>
                    )}
                  </div>
                )}

                {/* Segment Buttons */}
                {(state === "recording" || state === "paused") && (
                  <div className="flex flex-col gap-4 items-center w-full">
                    <div className="flex flex-wrap gap-4 justify-center w-full items-center">
                      {(["Announcements", "Sharing", "Sermon"] as const).map((segment) => (
                        <button
                          key={segment}
                          onClick={() => handleSegmentClick(segment)}
                          disabled={state === "paused"}
                          className={`px-6 py-3 rounded-lg font-medium transition-all ${
                            state === "paused"
                              ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                              : activeSegment === segment
                              ? "bg-blue-600 text-white shadow-md"
                              : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                          }`}
                          title={state === "paused" ? "Resume recording to change segments" : `Select ${segment === "Sermon" ? "Message" : segment} segment. ${segment === "Sermon" ? "Sharing ends here; tag the message speaker." : ""}`}
                        >
                          {segment === "Sermon" ? "Message" : segment}
                        </button>
                      ))}
                      {activeSegment !== null && (
                        <button
                          type="button"
                          onClick={handleEndCurrentSegment}
                          disabled={state === "paused"}
                          className="px-4 py-3 rounded-lg font-medium border-2 border-orange-500 text-orange-600 hover:bg-orange-50 disabled:opacity-50 disabled:cursor-not-allowed"
                          title={`End ${activeSegment === "Sermon" ? "Message" : activeSegment} segment now`}
                        >
                          End {activeSegment === "Sermon" ? "Message" : activeSegment}
                        </button>
                      )}
                    </div>
                    
                    {/* Member Dropdown for Sharing Time */}
                    {activeSegment === "Sharing" && (showMemberDropdown || keepDropdownOpen) && (
                      <div className="w-full max-w-md">
                        <div className="bg-white border border-gray-300 rounded-lg shadow-lg p-4">
                          <div className="flex items-center justify-between mb-2">
                            <label className="block text-sm font-medium text-gray-700">
                              Select Member Sharing:
                            </label>
                            <label className="flex items-center text-xs text-gray-600 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={keepDropdownOpen}
                                onChange={(e) => setKeepDropdownOpen(e.target.checked)}
                                className="mr-1"
                              />
                              Keep open
                            </label>
                          </div>
                          {loadingMembers ? (
                            <div className="text-center py-4 text-gray-500">Loading members...</div>
                          ) : members.length === 0 ? (
                            <div className="text-center py-4 text-gray-500">
                              <p className="mb-2">No speakers found.</p>
                              <a
                                href="/settings"
                                className="text-blue-600 hover:text-blue-800 underline text-sm"
                              >
                                Add speakers in Settings
                              </a>
                            </div>
                          ) : (() => {
                            // Filter by search query
                            const filtered = members.filter((member) =>
                              member.name.toLowerCase().includes(memberSearchQuery.toLowerCase())
                            );
                            
                            // Sort: tagged first, then alphabetical
                            const sorted = filtered.sort((a, b) => {
                              const aTagged = (a as any).tagged === true;
                              const bTagged = (b as any).tagged === true;
                              
                              if (aTagged && !bTagged) return -1;
                              if (!aTagged && bTagged) return 1;
                              return a.name.localeCompare(b.name);
                            });
                            
                            return (
                              <>
                                {/* Recently Tagged Speakers - Quick Access */}
                                {recentlyTaggedSpeakers.length > 0 && !memberSearchQuery && (
                                  <div className="mb-3">
                                    <div className="text-xs font-semibold text-gray-600 mb-2">Recently Tagged (Quick Select):</div>
                                    <div className="flex flex-wrap gap-2">
                                      {recentlyTaggedSpeakers.map((speakerName) => (
                                        <button
                                          key={speakerName}
                                          type="button"
                                          tabIndex={-1}
                                          onMouseDown={(e) => e.preventDefault()}
                                          onClick={async (e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            await handleMemberSelect(speakerName, true);
                                          }}
                                          className="px-3 py-1.5 bg-blue-100 border border-blue-300 text-blue-700 rounded-lg hover:bg-blue-200 font-medium text-sm transition-colors"
                                        >
                                          {speakerName}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                
                                <input
                                  type="text"
                                  placeholder="Search speakers..."
                                  value={memberSearchQuery}
                                  onChange={(e) => setMemberSearchQuery(e.target.value)}
                                  className="w-full px-3 py-2 mb-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                  aria-label="Search speakers"
                                />
                                {sorted.length === 0 ? (
                                  <div className="text-center py-4 text-gray-500">
                                    No speakers match "{memberSearchQuery}"
                                  </div>
                                ) : (
                                  <div className="space-y-2 max-h-60 overflow-y-auto">
                                    {sorted.map((member) => {
                                      const isTagged = (member as any).tagged === true;
                                      const isRecent = recentlyTaggedSpeakers.includes(member.name);
                                      return (
                                        <button
                                          key={member.id}
                                          type="button"
                                          tabIndex={-1}
                                          onMouseDown={(e) => e.preventDefault()}
                                          onClick={async (e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            await handleMemberSelect(member.name, keepDropdownOpen);
                                          }}
                                          className={`w-full text-left px-4 py-2 rounded-lg transition-colors border ${
                                            isTagged
                                              ? "bg-blue-100 border-blue-300 hover:bg-blue-200 font-semibold"
                                              : isRecent
                                              ? "bg-green-50 border-green-200 hover:bg-green-100"
                                              : "bg-gray-50 border-gray-200 hover:bg-blue-50 hover:text-blue-700"
                                          }`}
                                        >
                                          {isTagged && <span className="text-blue-600 mr-2">⭐</span>}
                                          {isRecent && !isTagged && <span className="text-green-600 mr-2">🕐</span>}
                                          {member.name}
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </>
                            );
                          })()}
                          <div className="flex flex-col gap-2 mt-3">
                            {/* End Speaker / No Speaker buttons */}
                            {currentSpeaker && (
                              <div className="flex gap-2">
                                <button
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleEndSpeaker();
                                  }}
                                  className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 text-sm font-medium"
                                  title="End current speaker (e.g., when they finish or moderator takes over)"
                                >
                                  End Speaker
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleEndSpeaker();
                                    setShowMemberDropdown(false);
                                    setKeepDropdownOpen(false);
                                  }}
                                  className="flex-1 px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 text-sm font-medium"
                                  title="No speaker at this time (e.g., moderator only)"
                                >
                                  No Speaker
                                </button>
                              </div>
                            )}
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  setShowMemberDropdown(false);
                                  setKeepDropdownOpen(false);
                                  setMemberSearchQuery("");
                                }}
                                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm"
                              >
                                Close
                              </button>
                              {!showMemberDropdown && keepDropdownOpen && (
                                <button
                                  onClick={() => setShowMemberDropdown(true)}
                                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
                                >
                                  Tag Next Speaker
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {/* Quick Tag Button and End Speaker for Sharing Time - Shows when dropdown is closed */}
                    {activeSegment === "Sharing" && !showMemberDropdown && !keepDropdownOpen && (
                      <div className="flex flex-col gap-2 w-full max-w-lg mx-auto">
                        {!sharingHintDismissed && (
                          <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
                            <p className="flex-1">
                              Tap <strong>End Speaker</strong> when someone finishes, then <strong>Tag Speaker</strong> for the next person, to keep names correct.
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                setSharingHintDismissed(true);
                                if (typeof window !== "undefined") window.localStorage.setItem("recorder-sharing-hint-dismissed", "1");
                              }}
                              className="shrink-0 px-2 py-1 text-blue-600 hover:bg-blue-100 rounded"
                              aria-label="Dismiss tip"
                            >
                              Dismiss
                            </button>
                          </div>
                        )}
                        <div className="flex gap-3 justify-center flex-wrap">
                          <button
                            onClick={() => {
                              setShowMemberDropdown(true);
                              setMemberSearchQuery("");
                            }}
                            className="px-6 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-all shadow-md"
                          >
                            Tag Speaker
                          </button>
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleEndSpeaker();
                            }}
                            disabled={!currentSpeaker}
                            className="px-6 py-3 bg-orange-500 text-white rounded-lg font-medium hover:bg-orange-600 transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                            title={currentSpeaker ? "End current speaker before the next person (keeps names correct)" : "No speaker active"}
                          >
                            End Speaker
                          </button>
                        </div>
                        <p className="text-xs text-center text-gray-500">
                          {currentSpeaker ? "Tap End Speaker when they finish, then Tag Speaker for the next person." : "Tag who is sharing; tap End Speaker when they finish."}
                        </p>
                      </div>
                    )}

                    {/* Message Speaker: tag who is preaching so transcript and summary show "MESSAGE: [Name]" */}
                    {activeSegment === "Sermon" && showSermonSpeakerDropdown && (
                      <div className="w-full max-w-md">
                        <div className="bg-white border border-gray-300 rounded-lg shadow-lg p-4">
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Select Message Speaker (Sharing ended; tag who is preaching):
                          </label>
                          {loadingMembers ? (
                            <div className="text-center py-4 text-gray-500">Loading speakers...</div>
                          ) : members.length === 0 ? (
                            <div className="text-center py-4 text-gray-500">
                              <p className="mb-2">No speakers found.</p>
                              <a
                                href="/settings"
                                className="text-blue-600 hover:text-blue-800 underline text-sm"
                              >
                                Add speakers in Settings
                              </a>
                            </div>
                          ) : (() => {
                            // Filter by search query
                            const filtered = members.filter((member) =>
                              member.name.toLowerCase().includes(sermonSpeakerSearchQuery.toLowerCase())
                            );
                            
                            // Sort: tagged first, then alphabetical
                            const sorted = filtered.sort((a, b) => {
                              const aTagged = (a as any).tagged === true;
                              const bTagged = (b as any).tagged === true;
                              
                              if (aTagged && !bTagged) return -1;
                              if (!aTagged && bTagged) return 1;
                              return a.name.localeCompare(b.name);
                            });
                            
                            return (
                              <>
                                <input
                                  type="text"
                                  placeholder="Search speakers..."
                                  value={sermonSpeakerSearchQuery}
                                  onChange={(e) => setSermonSpeakerSearchQuery(e.target.value)}
                                  className="w-full px-3 py-2 mb-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                  aria-label="Search sermon speakers"
                                />
                                {sorted.length === 0 ? (
                                  <div className="text-center py-4 text-gray-500">
                                    No speakers match "{sermonSpeakerSearchQuery}"
                                  </div>
                                ) : (
                                  <div className="space-y-2 max-h-60 overflow-y-auto">
                                    {sorted.map((member) => {
                                      const isTagged = (member as any).tagged === true;
                                      return (
                                        <button
                                          key={member.id}
                                          type="button"
                                          tabIndex={-1}
                                          onMouseDown={(e) => e.preventDefault()}
                                          onClick={async (e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            await handleSermonSpeakerSelect(member.name);
                                          }}
                                          className={`w-full text-left px-4 py-2 rounded-lg transition-colors border ${
                                            isTagged
                                              ? "bg-blue-100 border-blue-300 hover:bg-blue-200 font-semibold"
                                              : "bg-gray-50 border-gray-200 hover:bg-blue-50 hover:text-blue-700"
                                          }`}
                                        >
                                          {isTagged && <span className="text-blue-600 mr-2">⭐</span>}
                                          {member.name}
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </>
                            );
                          })()}
                          <button
                            onClick={() => {
                              setShowSermonSpeakerDropdown(false);
                              setSermonSpeakerSearchQuery("");
                            }}
                            className="mt-3 w-full px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Error Display */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl shadow-lg p-6">
                <div className="flex items-start space-x-3">
                  <span className="text-red-600 text-xl">⚠️</span>
                  <div className="flex-1">
                    <h3 className="font-semibold text-red-900 mb-1">Error</h3>
                    <p className="text-sm text-red-700">{error}</p>
                  </div>
                  <button
                    onClick={() => setError(null)}
                    className="text-red-600 hover:text-red-800"
                  >
                    ×
                  </button>
                </div>
              </div>
            )}

            {/* Audio Playback Section */}
            {state === "stopped" && audioUrl && audioBlob && (
              <div className="bg-green-50 border border-green-200 rounded-xl shadow-lg p-6">
                <div className="flex items-center space-x-2 mb-4">
                  <span className="text-green-600 text-xl">✓</span>
                  <h3 className="font-semibold text-green-900">Audio Ready</h3>
                </div>
                <div className="space-y-4">
                  <audio
                    controls
                    src={audioUrl}
                    className="w-full"
                    onLoadedMetadata={(e) => {
                      const audioEl = e.target as HTMLAudioElement;
                      setAudioDuration(audioEl.duration);
                    }}
                    onError={(e) => {
                      // Handle audio playback errors silently
                    }}
                    onCanPlay={(e) => {
                      // Audio is ready to play
                    }}
                  >
                    Your browser does not support the audio element.
                  </audio>
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col gap-1">
                      <span className="text-sm text-gray-600">
                        File size: {(audioBlob.size / 1024 / 1024).toFixed(2)} MB
                      </span>
                      {audioDuration !== null && (
                        <span className="text-sm text-gray-600">
                          Duration: {formatTime(Math.floor(audioDuration))}
                        </span>
                      )}
                    </div>
                    <a
                      href={audioUrl}
                      download={`recording-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.mp3`}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                    >
                      Download Recording
                    </a>
                  </div>

                  {/* Supabase Upload Status */}
                  <div className="pt-4 border-t border-green-200">
                    {uploadStatus === "uploading" && (
                      <div className="flex items-center space-x-2 text-sm text-gray-600">
                        <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                        <span>Uploading to Supabase...</span>
                      </div>
                    )}
                    {uploadStatus === "success" && uploadedUrl && (
                      <div className="space-y-2">
                        <div className="flex items-center space-x-2 text-sm text-green-700">
                          <span className="text-green-600">✓</span>
                          <span>Uploaded to Supabase</span>
                        </div>
                        <a
                          href={uploadedUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:text-blue-800 underline break-all"
                        >
                          {uploadedUrl}
                        </a>
                      </div>
                    )}
                    {uploadStatus === "error" && uploadError && (
                      <div className="text-sm text-red-600">
                        <span className="font-medium">Upload failed:</span> {uploadError}
                      </div>
                    )}
                    {uploadStatus === "idle" && (
                      <div className="text-xs text-gray-500">
                        Upload will start automatically...
                      </div>
                    )}
                  </div>
                </div>

                {/* Analyze Sections Button */}
                {state === "stopped" && audioBlob && transcriptChunks.length > 0 && (
                  <div className="mt-6 pt-6 border-t border-green-200">
                    <button
                      onClick={handleAnalyzeSections}
                      disabled={uploadStatus === "uploading"}
                      className="w-full px-8 py-4 bg-blue-600 text-white text-lg font-semibold rounded-lg hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
                    >
                      {uploadStatus === "uploading" ? "Analyzing..." : "Analyze Sections Automatically"}
                    </button>
                    <p className="mt-2 text-sm text-gray-600 text-center">
                      Automatically detect and label Announcements, Sharing, and Sermon sections
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Segments Table */}
            {(segments.length > 0 || activeSegment !== null) && (
              <div className="bg-white rounded-xl shadow-lg p-6">
                <h2 className="text-xl font-semibold text-gray-900 mb-4">Segments</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-3 px-4 font-semibold text-gray-700">
                          Type
                        </th>
                        <th className="text-left py-3 px-4 font-semibold text-gray-700">
                          Start Time
                        </th>
                        <th className="text-left py-3 px-4 font-semibold text-gray-700">
                          End Time
                        </th>
                        <th className="text-left py-3 px-4 font-semibold text-gray-700">
                          Duration
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {segments.map((segment, index) => {
                        const duration =
                          segment.endMs !== null ? segment.endMs - segment.startMs : 0;
                        return (
                          <tr
                            key={index}
                            className="border-b border-gray-100 hover:bg-gray-50"
                          >
                            <td className="py-3 px-4 text-gray-900 font-medium">
                              {segment.type}
                            </td>
                            <td className="py-3 px-4 text-gray-700 font-mono">
                              {formatTimeMs(segment.startMs)}
                            </td>
                            <td className="py-3 px-4 text-gray-700 font-mono">
                              {segment.endMs !== null
                                ? formatTimeMs(segment.endMs)
                                : "-"}
                            </td>
                            <td className="py-3 px-4 text-gray-700 font-mono">
                              {segment.endMs !== null ? formatTimeMs(duration) : "-"}
                            </td>
                          </tr>
                        );
                      })}
                      {activeSegment !== null && activeSegmentStartMs !== null && (
                        <tr className="border-b border-gray-100 bg-blue-50">
                          <td className="py-3 px-4 text-blue-900 font-medium">
                            {activeSegment} <span className="text-xs">(active)</span>
                          </td>
                          <td className="py-3 px-4 text-blue-700 font-mono">
                            {formatTimeMs(activeSegmentStartMs)}
                          </td>
                          <td className="py-3 px-4 text-blue-600 font-mono">-</td>
                          <td className="py-3 px-4 text-blue-600 font-mono">
                            {formatTimeMs(getCurrentElapsedMs() - activeSegmentStartMs)}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* State Indicator */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <div className="text-sm text-gray-600">
                Status: <span className="font-semibold capitalize">{state}</span>
              </div>
            </div>
          </div>

          {/* Live Transcript Panel */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl shadow-lg p-6 h-full">
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                Live Transcript
              </h2>
              <div className="mb-4">
                <div className="text-xs text-gray-500">
                  Method: <span className="font-medium text-gray-600">
                    {transcriptionMethod === "browser" 
                      ? transcription.providerName || "Browser Speech Recognition"
                      : "OpenAI Whisper API"}
                  </span>
                </div>
              </div>
              <div className="h-[600px] overflow-y-auto border border-gray-200 rounded-lg p-4 bg-gray-50">
                {transcriptionMethod === "openai" && transcriptChunks.length > 0 && (
                  <div className="mb-3 p-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-700">
                    <strong>Live transcription:</strong> Showing browser transcription for real-time display. More accurate Whisper transcription will replace this after upload.
                  </div>
                )}
                {!isSecureContext && transcription.isAvailable ? (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm">
                    <p className="font-medium mb-1">Live transcript unavailable</p>
                    <p className="text-xs">
                      Speech recognition requires a secure connection (HTTPS). Open this site using your https:// URL so the live transcript can work.
                    </p>
                  </div>
                ) : !transcription.isAvailable ? (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm">
                    <p className="font-medium mb-1">Live transcript not available</p>
                    <p className="text-xs mb-2">
                      Browser Speech Recognition is not supported in this browser. For live transcripts while recording, use <strong>Microsoft Edge</strong> or <strong>Google Chrome</strong> (Chrome 139+ recommended).
                    </p>
                    <p className="text-xs text-amber-700">
                      Alternatively, switch to OpenAI Whisper in Settings for transcription after upload (works in any browser).
                    </p>
                  </div>
                ) : transcriptChunks.length === 0 && transcription.noSpeechDetected ? (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm">
                    <p className="font-medium mb-1">No live captions yet</p>
                    <p className="text-xs mb-2">
                      The speech service reported “no speech” before any text arrived (this can happen even when the mic works). Keep speaking; captions should appear once recognition starts. Use Chrome or Edge on a stable connection. If Settings uses OpenAI, you’ll still get a full transcript after upload.
                    </p>
                  </div>
                ) : transcriptChunks.length === 0 ? (
                  <div className="text-center text-gray-400 mt-8">
                    Transcript will appear here while recording...
                  </div>
                ) : (
                  <div className="space-y-3">
                    {(() => {
                      const displayed = transcriptChunks.slice(-MAX_DISPLAYED_TRANSCRIPT_CHUNKS);
                      return displayed.map((chunk, index) => {
                        if (!chunk || typeof chunk.text !== "string") return null;
                        const isSpeakerTag = chunk.speakerTag === true;
                        const isSermonTag = isSpeakerTag && (chunk.text.includes(" speaking:") || chunk.text.includes(" speaking:]") || chunk.text.includes(" sermon speaker:"));
                        const isSharingTag = isSpeakerTag && (chunk.text.includes(" sharing:") || chunk.text.includes(" sharing:]"));
                        const isLastChunk = index === displayed.length - 1;
                        const hasSpeaker = chunk.speaker && !isSpeakerTag;
                        // Show speaker name only once per speaker: when speaker changes or when first line after a speaker tag
                        const prevChunk = index > 0 ? displayed[index - 1] : null;
                        const showSpeakerLabel = hasSpeaker && (index === 0 || prevChunk?.speakerTag === true || prevChunk?.speaker !== chunk.speaker);

                        return (
                          <div
                            key={index}
                            ref={isLastChunk ? transcriptEndRef : null}
                            className={`text-sm leading-relaxed animate-fade-in ${
                              isSpeakerTag
                                ? isSermonTag
                                  ? "bg-purple-100 border-l-4 border-purple-500 pl-3 py-2 rounded shadow-sm"
                                  : "bg-blue-100 border-l-4 border-blue-500 pl-3 py-2 rounded shadow-sm"
                                : hasSpeaker
                                ? "bg-green-50 border-l-2 border-green-300 pl-2 py-1"
                                : chunk.isFinal
                                ? "text-gray-700"
                                : "text-gray-500 italic"
                            }`}
                          >
                            <div className={`text-xs mb-1 font-mono ${
                              isSpeakerTag 
                                ? isSermonTag 
                                  ? "text-purple-700 font-semibold" 
                                  : "text-blue-700 font-semibold" 
                                : hasSpeaker
                                ? "text-green-700 font-semibold"
                                : "text-gray-400"
                            }`}>
                              {formatTimeMs(chunk.timestampMs)}
                              {showSpeakerLabel && (
                                <span className="ml-2 text-green-600 font-medium">• {chunk.speaker}</span>
                              )}
                              {isSpeakerTag && (
                                <span className="ml-2 text-xs">
                                  {isSermonTag ? "🎤 Sermon" : "💬 Sharing"}
                                </span>
                              )}
                            </div>
                            <div className={`text-sm ${
                              isSpeakerTag 
                                ? isSermonTag
                                  ? "text-purple-900 font-semibold"
                                  : "text-blue-900 font-semibold" 
                                : hasSpeaker
                                ? "text-gray-800"
                                : ""
                            }`}>
                              {chunk.text}
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}

export default function RecorderPage() {
  return (
    <TranscriptionProviderComponent>
      <RecorderPageContent />
    </TranscriptionProviderComponent>
  );
}

