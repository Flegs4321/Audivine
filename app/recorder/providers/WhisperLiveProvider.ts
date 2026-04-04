import type {
  StreamAwareTranscriptionProvider,
  LiveRecognitionChunk,
} from "../types/transcription";

/**
 * Live transcription provider that uses OpenAI Whisper via a server-side proxy.
 *
 * Every CHUNK_DURATION_MS it stops a secondary MediaRecorder (producing an
 * independently decodable WebM file), sends that blob to /api/transcribe-live,
 * and emits the returned text as a LiveRecognitionChunk.
 *
 * This solves the Web Speech API limitation where SpeechRecognition always uses
 * the system default microphone. By tapping into the same MediaStream the main
 * recorder uses, the correct audio device is always captured.
 */
export class WhisperLiveProvider implements StreamAwareTranscriptionProvider {
  private mediaStream: MediaStream | null = null;
  private authToken: string | null = null;
  private textChunkCallback: ((chunk: LiveRecognitionChunk) => void) | null = null;
  private isRunning = false;
  private secondaryRecorder: MediaRecorder | null = null;
  private cycleTimer: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;
  private chunkIndex = 0;
  private mimeType = "audio/webm";

  /** How long each audio chunk is before being sent to Whisper. */
  private static CHUNK_DURATION_MS = 5000;
  /** Skip blobs smaller than this — likely silence or too short to transcribe. */
  private static MIN_BLOB_BYTES = 1000;

  // ── StreamAwareTranscriptionProvider ──────────────────────────

  setMediaStream(stream: MediaStream): void {
    this.mediaStream = stream;
  }

  setAuthToken(token: string): void {
    this.authToken = token;
  }

  // ── TranscriptionProvider ────────────────────────────────────

  async start(): Promise<void> {
    if (!this.mediaStream) {
      throw new Error("[WhisperLive] No MediaStream set — call setMediaStream() before start()");
    }
    if (!this.authToken) {
      throw new Error("[WhisperLive] No auth token set — call setAuthToken() before start()");
    }

    // Detect best MIME type (same priority as the main recorder)
    const mimeTypes = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
    ];
    for (const mt of mimeTypes) {
      if (MediaRecorder.isTypeSupported(mt)) {
        this.mimeType = mt;
        break;
      }
    }

    this.isRunning = true;
    this.chunkIndex = 0;
    this.abortController = new AbortController();
    console.log("[WhisperLive] start", { mimeType: this.mimeType });
    this.startNewCycle();
  }

  stop(): void {
    console.log("[WhisperLive] stop");
    this.isRunning = false;

    if (this.cycleTimer) {
      clearTimeout(this.cycleTimer);
      this.cycleTimer = null;
    }

    this.abortController?.abort();
    this.abortController = null;

    if (this.secondaryRecorder && this.secondaryRecorder.state !== "inactive") {
      try {
        this.secondaryRecorder.stop();
      } catch {
        // already stopped
      }
    }
    this.secondaryRecorder = null;
  }

  onTextChunk(callback: (chunk: LiveRecognitionChunk) => void): void {
    this.textChunkCallback = callback;
  }

  isAvailable(): boolean {
    // Availability is gated by having a MediaStream + auth token,
    // which the context checks before using this provider.
    return true;
  }

  getProviderName(): string {
    return "OpenAI Whisper (Live)";
  }

  // ── Internal ─────────────────────────────────────────────────

  private startNewCycle(): void {
    if (!this.isRunning || !this.mediaStream) return;

    const chunks: Blob[] = [];

    try {
      const recorder = new MediaRecorder(this.mediaStream, {
        mimeType: this.mimeType,
      });

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: this.mimeType });
        // Fire-and-forget: send to API while starting the next cycle
        if (blob.size >= WhisperLiveProvider.MIN_BLOB_BYTES) {
          this.sendChunkToApi(blob);
        } else {
          console.log("[WhisperLive] skipping small chunk", { size: blob.size });
        }
        // Start next cycle immediately
        if (this.isRunning) {
          this.startNewCycle();
        }
      };

      recorder.onerror = (event) => {
        console.warn("[WhisperLive] secondary recorder error:", event);
        // Try to recover with a new cycle
        if (this.isRunning) {
          setTimeout(() => this.startNewCycle(), 1000);
        }
      };

      recorder.start();
      this.secondaryRecorder = recorder;

      // Stop after CHUNK_DURATION_MS to produce a complete, decodable blob
      this.cycleTimer = setTimeout(() => {
        if (recorder.state === "recording") {
          recorder.stop();
        }
      }, WhisperLiveProvider.CHUNK_DURATION_MS);
    } catch (error) {
      console.error("[WhisperLive] Failed to start secondary recorder:", error);
      // Retry after a delay
      if (this.isRunning) {
        setTimeout(() => this.startNewCycle(), 2000);
      }
    }
  }

  private async sendChunkToApi(blob: Blob): Promise<void> {
    const idx = ++this.chunkIndex;
    try {
      const formData = new FormData();
      formData.append("file", blob, `chunk-${idx}.webm`);

      console.log("[WhisperLive] sending chunk", { index: idx, size: blob.size });

      const response = await fetch("/api/transcribe-live", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.authToken}` },
        body: formData,
        signal: this.abortController?.signal,
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => "");
        console.warn("[WhisperLive] API error for chunk", idx, response.status, errBody);
        return;
      }

      const data = await response.json();
      const text = (data.text || "").trim();

      if (text && this.textChunkCallback) {
        console.log("[WhisperLive] chunk transcribed", {
          index: idx,
          textPreview: text.slice(0, 80),
        });
        this.textChunkCallback({ text, isFinal: true });
      }
    } catch (error) {
      // AbortError is expected on stop()
      if (error instanceof DOMException && error.name === "AbortError") return;
      console.warn("[WhisperLive] sendChunkToApi failed for chunk", idx, error);
    }
  }
}
