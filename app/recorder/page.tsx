"use client";

import { useState, useEffect, useRef } from "react";
import { TranscriptionProviderComponent, useTranscription } from "./context/TranscriptionProvider";
import type { TranscriptChunk } from "./types/transcription";
import { uploadRecording } from "@/lib/supabase/storage";

type RecordingState = "idle" | "recording" | "stopped";
type SegmentType = "Announcements" | "Sharing" | "Sermon";

interface Segment {
  type: SegmentType;
  startMs: number;
  endMs: number | null;
}

function RecorderPageContent() {
  const transcription = useTranscription();
  const [state, setState] = useState<RecordingState>("idle");
  const [activeSegment, setActiveSegment] = useState<SegmentType | null>(null);
  const [activeSegmentStartMs, setActiveSegmentStartMs] = useState<number | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [elapsedTime, setElapsedTime] = useState(0); // in seconds
  const [transcriptChunks, setTranscriptChunks] = useState<TranscriptChunk[]>([]);
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

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioUrlRef = useRef<string | null>(null);
  const segmentsRef = useRef<Segment[]>([]);
  const transcriptChunksRef = useRef<TranscriptChunk[]>([]);
  const elapsedTimeRef = useRef<number>(0);

  // Timer effect
  useEffect(() => {
    if (state === "recording" && startTimeRef.current !== null) {
      intervalRef.current = setInterval(() => {
        const now = Date.now();
        const elapsed = Math.floor((now - startTimeRef.current!) / 1000);
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
    return Date.now() - startTimeRef.current;
  };

  // Enumerate available audio input devices
  const enumerateAudioDevices = async () => {
    try {
      // Check if mediaDevices API is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        console.warn("Device enumeration not supported");
        return;
      }

      // First request permission to access devices (required for device labels)
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        // Permission might be denied, but we can still try to enumerate
        console.warn("Permission denied for getUserMedia, but continuing enumeration");
      }

      // Enumerate all devices
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(device => device.kind === 'audioinput');
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
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/321257dd-001e-4325-9924-8b2713a810bc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'recorder/page.tsx:169',message:'ondataavailable fired',data:{chunkSize:event.data.size,chunksCount:audioChunksRef.current.length,state:mediaRecorder.state},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
        // #endregion
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/321257dd-001e-4325-9924-8b2713a810bc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'recorder/page.tsx:173',message:'chunk added',data:{chunkSize:event.data.size,totalChunks:audioChunksRef.current.length,totalSize:audioChunksRef.current.reduce((sum,chunk)=>sum+chunk.size,0)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
          // #endregion
        } else {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/321257dd-001e-4325-9924-8b2713a810bc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'recorder/page.tsx:176',message:'ondataavailable with zero size',data:{state:mediaRecorder.state},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
          // #endregion
        }
      };

      // Handle when recording stops
      mediaRecorder.onstop = async () => {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/321257dd-001e-4325-9924-8b2713a810bc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'recorder/page.tsx:175',message:'onstop fired',data:{chunksCount:audioChunksRef.current.length,totalSize:audioChunksRef.current.reduce((sum,chunk)=>sum+chunk.size,0),mimeType:selectedMimeType},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        // Create blob from collected chunks
        if (audioChunksRef.current.length > 0) {
          const totalSize = audioChunksRef.current.reduce((sum, chunk) => sum + chunk.size, 0);
          const blob = new Blob(audioChunksRef.current, { type: selectedMimeType });
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/321257dd-001e-4325-9924-8b2713a810bc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'recorder/page.tsx:180',message:'blob created',data:{blobSize:blob.size,blobType:blob.type,chunksCount:audioChunksRef.current.length,expectedSize:totalSize},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
          // #endregion
          setAudioBlob(blob);

          // Create object URL for audio playback
          const url = URL.createObjectURL(blob);
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/321257dd-001e-4325-9924-8b2713a810bc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'recorder/page.tsx:185',message:'audio URL created',data:{url:url.substring(0,50)+'...',blobSize:blob.size},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
          // #endregion
          setAudioUrl(url);

          // Upload to Supabase
          handleUploadToSupabase(blob, selectedMimeType);
        } else {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/321257dd-001e-4325-9924-8b2713a810bc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'recorder/page.tsx:191',message:'no chunks available on stop',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
          // #endregion
        }
        mediaRecorderRef.current = null;
      };

      // Handle errors from MediaRecorder
      mediaRecorder.onerror = (event) => {
        console.error("MediaRecorder error:", event);
        setError("An error occurred during recording. Please try again.");
        handleEndRecording();
      };

      // Start recording
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/321257dd-001e-4325-9924-8b2713a810bc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'recorder/page.tsx:199',message:'starting MediaRecorder',data:{mimeType:selectedMimeType,state:mediaRecorder.state},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
      // #endregion
      mediaRecorder.start(); // Mp3MediaRecorder doesn't support timeslice - dataavailable fires only when stopped
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/321257dd-001e-4325-9924-8b2713a810bc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'recorder/page.tsx:201',message:'MediaRecorder started',data:{state:mediaRecorder.state},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
      // #endregion

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
      // Reset refs
      segmentsRef.current = [];
      transcriptChunksRef.current = [];
      elapsedTimeRef.current = 0;
      
      // Start transcription if available
      if (transcription.isAvailable) {
        try {
          await transcription.start();
        } catch (err) {
          console.error("Failed to start transcription:", err);
          // Continue recording even if transcription fails
        }
      }
    } catch (err) {
      console.error("Error starting recording:", err);
      setError(err instanceof Error ? err.message : "Failed to start recording");
      setState("idle");
    }
  };

  const handleEndRecording = async () => {
    try {
      // Stop transcription
      if (transcription.isActive) {
        transcription.stop();
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
      
      // Update refs with final values
      transcriptChunksRef.current = transcriptChunks;
      elapsedTimeRef.current = elapsedTime;

      // Stop MediaRecorder if it's active
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/321257dd-001e-4325-9924-8b2713a810bc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'recorder/page.tsx:263',message:'stopping MediaRecorder',data:{state:mediaRecorderRef.current.state,chunksCount:audioChunksRef.current.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        
        const recorder = mediaRecorderRef.current;
        const chunksBeforeStop = audioChunksRef.current.length;
        
        // Stop the recorder
        // Note: Mp3MediaRecorder doesn't support requestData() - dataavailable fires automatically on stop
        recorder.stop();
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/321257dd-001e-4325-9924-8b2713a810bc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'recorder/page.tsx:275',message:'stop() called',data:{finalChunksCount:audioChunksRef.current.length,chunksBefore:chunksBeforeStop},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
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

  const handleSegmentClick = (segment: SegmentType) => {
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
  };

  // Set up transcription callback
  useEffect(() => {
    if (!transcription.isAvailable) return;

    transcription.onTextChunk((chunk) => {
      setTranscriptChunks((prev) => {
        // If it's an interim result, replace the last interim chunk
        let updated: TranscriptChunk[];
        if (!chunk.isFinal && prev.length > 0 && !prev[prev.length - 1].isFinal) {
          updated = [...prev.slice(0, -1), chunk];
        } else {
          // Otherwise, add as new chunk
          updated = [...prev, chunk];
        }
        // Update ref
        transcriptChunksRef.current = updated;
        return updated;
      });
    });
  }, [transcription.isAvailable, transcription.onTextChunk]);

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

      const metadata = {
        filename: "recording",
        duration: finalElapsedTime,
        segments: finalSegments.map((s) => ({
          type: s.type,
          startMs: s.startMs,
          endMs: s.endMs,
        })),
        transcriptChunks: finalTranscriptChunks.map((c) => ({
          text: c.text,
          timestampMs: c.timestampMs,
          isFinal: c.isFinal ?? true,
        })),
        mimeType,
        fileSize: blob.size,
      };

      const result = await uploadRecording(blob, metadata);

      if (result.success && result.url) {
        setUploadStatus("success");
        setUploadedUrl(result.url);
      } else {
        setUploadStatus("error");
        setUploadError(result.error || "Upload failed");
      }
    } catch (err) {
      setUploadStatus("error");
      setUploadError(err instanceof Error ? err.message : "Upload failed");
      console.error("Upload error:", err);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Recording Studio</h1>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Control Panel */}
          <div className="lg:col-span-2 space-y-6">
            {/* Recording Controls */}
            <div className="bg-white rounded-xl shadow-lg p-8">
              <div className="flex flex-col items-center space-y-6">
                {/* Audio Device Selection */}
                {state === "idle" && audioInputDevices.length > 0 && (
                  <div className="w-full max-w-md">
                    <label htmlFor="audio-device" className="block text-sm font-medium text-gray-700 mb-2">
                      Audio Input Device:
                    </label>
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
                  <button
                    onClick={handleEndRecording}
                    className="px-12 py-6 bg-gray-800 text-white text-xl font-semibold rounded-full hover:bg-gray-900 transition-all transform hover:scale-105 shadow-lg"
                  >
                    End Recording
                  </button>
                )}

                {/* Timer Display */}
                {state === "recording" && (
                  <div className="text-center">
                    <div className="text-6xl font-mono font-bold text-gray-900 mb-2">
                      {formatTime(elapsedTime)}
                    </div>
                    <div className="flex items-center justify-center space-x-2">
                      <span className="w-3 h-3 bg-red-600 rounded-full animate-pulse"></span>
                      <span className="text-sm text-gray-600 uppercase tracking-wide">
                        Recording
                      </span>
                    </div>
                  </div>
                )}

                {/* Active Segment Label */}
                {state === "recording" && activeSegment && (
                  <div className="bg-blue-100 text-blue-800 px-6 py-3 rounded-lg font-semibold">
                    Active: {activeSegment}
                  </div>
                )}

                {/* Segment Buttons */}
                {state === "recording" && (
                  <div className="flex flex-wrap gap-4 justify-center w-full">
                    {(["Announcements", "Sharing", "Sermon"] as const).map((segment) => (
                      <button
                        key={segment}
                        onClick={() => handleSegmentClick(segment)}
                        className={`px-6 py-3 rounded-lg font-medium transition-all ${
                          activeSegment === segment
                            ? "bg-blue-600 text-white shadow-md"
                            : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                        }`}
                      >
                        {segment}
                      </button>
                    ))}
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
                      // #region agent log
                      fetch('http://127.0.0.1:7242/ingest/321257dd-001e-4325-9924-8b2713a810bc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'recorder/page.tsx:517',message:'audio loaded metadata',data:{duration:audioEl.duration,readyState:audioEl.readyState},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
                      // #endregion
                    }}
                    onError={(e) => {
                      // #region agent log
                      const audioEl = e.target as HTMLAudioElement;
                      fetch('http://127.0.0.1:7242/ingest/321257dd-001e-4325-9924-8b2713a810bc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'recorder/page.tsx:523',message:'audio playback error',data:{error:audioEl.error?.code,errorMessage:audioEl.error?.message,networkState:audioEl.networkState,readyState:audioEl.readyState},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
                      // #endregion
                    }}
                    onCanPlay={(e) => {
                      // #region agent log
                      const audioEl = e.target as HTMLAudioElement;
                      fetch('http://127.0.0.1:7242/ingest/321257dd-001e-4325-9924-8b2713a810bc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'recorder/page.tsx:530',message:'audio can play',data:{duration:audioEl.duration,readyState:audioEl.readyState},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
                      // #endregion
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
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-gray-900">
                  Live Transcript
                </h2>
                {transcription.providerName && (
                  <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                    {transcription.providerName}
                  </span>
                )}
              </div>
              <div className="h-[600px] overflow-y-auto border border-gray-200 rounded-lg p-4 bg-gray-50">
                {!transcription.isAvailable ? (
                  <div className="text-center text-gray-400 mt-8">
                    <p className="mb-2">Realtime provider not configured</p>
                    <p className="text-xs text-gray-500">
                      Browser Speech Recognition is not available in this browser.
                    </p>
                  </div>
                ) : transcriptChunks.length === 0 ? (
                  <div className="text-center text-gray-400 mt-8">
                    Transcript will appear here while recording...
                  </div>
                ) : (
                  <div className="space-y-3">
                    {transcriptChunks.map((chunk, index) => (
                      <div
                        key={index}
                        className={`leading-relaxed animate-fade-in ${
                          chunk.isFinal
                            ? "text-gray-700"
                            : "text-gray-500 italic"
                        }`}
                      >
                        <div className="text-xs text-gray-400 mb-1 font-mono">
                          {formatTimeMs(chunk.timestampMs)}
                        </div>
                        <div>{chunk.text}</div>
                      </div>
                    ))}
                  </div>
                )}
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

