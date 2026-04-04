import type {
  TranscriptionProvider,
  LiveRecognitionChunk,
} from "../types/transcription";

// Type definitions for Web Speech API
interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  /** Chrome 139+: use on-device recognition (avoids sending audio to Google; works on all origins) */
  processLocally?: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onspeechstart: (() => void) | null;
}

interface SpeechRecognitionEvent {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

declare global {
  interface Window {
    SpeechRecognition?: {
      new (): SpeechRecognition;
    };
    webkitSpeechRecognition?: {
      new (): SpeechRecognition;
    };
  }
}

export class BrowserSpeechRecognitionProvider implements TranscriptionProvider {
  private recognition: SpeechRecognition | null = null;
  private textChunkCallback: ((chunk: LiveRecognitionChunk) => void) | null = null;
  private lastProcessedIndex: number = 0;
  private isRunning: boolean = false;
  private noSpeechCount: number = 0;
  private onNoSpeechCallback: (() => void) | null = null;
  private onSpeechResumedCallback: (() => void) | null = null;
  /** When true, skip processLocally (on-device requires language pack; fall back to cloud) */
  private useCloudFallback: boolean = false;
  private restartAttempt: number = 0;

  constructor() {
    const SpeechRecognitionClass =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (SpeechRecognitionClass) {
      this.recognition = new SpeechRecognitionClass();
      this.setupRecognition();
    }
  }

  setOnNoSpeech(callback: (() => void) | null): void {
    this.onNoSpeechCallback = callback;
  }

  setOnSpeechResumed(callback: (() => void) | null): void {
    this.onSpeechResumedCallback = callback;
  }

  /**
   * Each new `SpeechRecognition` instance starts a fresh result stream (indices from 0).
   * Reset index bookkeeping when swapping instances mid-session.
   */
  private resetStateForNewRecognitionInstance(): void {
    this.lastProcessedIndex = 0;
  }

  private emitChunk(chunk: LiveRecognitionChunk): void {
    if (!this.textChunkCallback) return;
    console.log("[BrowserSpeechRecognition] chunk emitted", {
      textPreview: chunk.text.slice(0, 80),
      textLength: chunk.text.length,
      isFinal: chunk.isFinal,
    });
    this.textChunkCallback(chunk);
  }

  private setupRecognition() {
    if (!this.recognition) return;

    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = "en-US";
    const preferOnDevice =
      typeof process !== "undefined" &&
      process.env.NEXT_PUBLIC_SPEECH_ON_DEVICE === "true";
    if (
      preferOnDevice &&
      !this.useCloudFallback &&
      "processLocally" in this.recognition
    ) {
      (this.recognition as SpeechRecognition).processLocally = true;
    }

    // Reset no-speech state when browser actually detects speech
    this.recognition.onspeechstart = () => {
      if (this.noSpeechCount > 0) {
        console.log("[BrowserSpeechRecognition] speech detected — clearing no-speech state");
        this.noSpeechCount = 0;
        this.onSpeechResumedCallback?.();
      }
      // Reset restart attempt counter on successful speech — engine is healthy
      this.restartAttempt = 0;
    };

    this.recognition.onresult = (event) => {
      if (!this.textChunkCallback) {
        console.warn("[BrowserSpeechRecognition] onresult fired but no callback set!");
        return;
      }

      const startIndex = Math.max(event.resultIndex, this.lastProcessedIndex);

      for (let i = startIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result || result.length === 0) continue;
        const first = result[0];
        if (!first || first.transcript == null) continue;
        const transcript = String(first.transcript).trim();
        if (!transcript) continue;

        if (result.isFinal) {
          this.emitChunk({ text: transcript, isFinal: true });
          this.lastProcessedIndex = i + 1;
        } else {
          if (i === event.results.length - 1) {
            this.emitChunk({ text: transcript, isFinal: false });
          }
        }
      }
    };

    this.recognition.onerror = (event) => {
      const errorType = event.error?.toLowerCase() || "";

      if (errorType === "no-speech" || errorType === "no_speech") {
        this.noSpeechCount++;
        if (this.noSpeechCount === 1) this.onNoSpeechCallback?.();
        if (this.noSpeechCount === 1 || this.noSpeechCount % 3 === 0) {
          console.warn(
            "[BrowserSpeechRecognition] No speech detected (count:",
            this.noSpeechCount,
            "). Check mic and speak clearly; live transcript needs audio input."
          );
        }
        return;
      }

      if (errorType === "aborted" || errorType === "interrupted") {
        return;
      }

      const shouldFallbackToCloud =
        (errorType === "language-not-supported" || errorType === "language_not_supported" ||
         errorType === "not-allowed" || errorType === "service-not-allowed" ||
         errorType === "service-unavailable") &&
        !this.useCloudFallback &&
        this.isRunning;

      if (shouldFallbackToCloud) {
        this.useCloudFallback = true;
        console.warn(
          "[BrowserSpeechRecognition] On-device failed (",
          event.error,
          "); falling back to cloud recognition. Use Chrome or Edge for best support."
        );
        const SpeechRecognitionClass =
          window.SpeechRecognition || window.webkitSpeechRecognition;
        if (this.recognition && SpeechRecognitionClass) {
          const savedCallback = this.textChunkCallback;
          this.recognition = new SpeechRecognitionClass();
          this.textChunkCallback = savedCallback;
          this.resetStateForNewRecognitionInstance();
          this.setupRecognition();
          try {
            this.recognition.start();
            console.log("[BrowserSpeechRecognition] transcription restart (cloud fallback)");
          } catch (e) {
            console.error("[BrowserSpeechRecognition] Cloud fallback start failed:", e);
          }
        }
        return;
      }

      if (errorType === "audio-capture" || errorType === "network") {
        console.warn("Speech recognition warning:", event.error, event.message || "");
      } else {
        console.error("Speech recognition error:", event.error, event.message || "");
      }
    };

    this.recognition.onend = () => {
      console.log("[BrowserSpeechRecognition] onend", {
        isRunning: this.isRunning,
        hasCallback: !!this.textChunkCallback,
        restartAttempt: this.restartAttempt,
      });
      if (this.isRunning && this.textChunkCallback) {
        const SpeechRecognitionClass =
          window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognitionClass) return;

        // Chrome's SpeechRecognition stops by design (silence, network hiccup, internal limit).
        // Always restart — no attempt cap. Backoff is capped at 2s to keep gaps short.
        this.restartAttempt++;
        const delay = Math.min(300 + this.restartAttempt * 200, 2000);
        setTimeout(() => {
          if (!this.isRunning || !this.textChunkCallback) return;
          try {
            console.log("[BrowserSpeechRecognition] transcription restart (auto)", {
              attempt: this.restartAttempt,
            });
            const savedCallback = this.textChunkCallback;
            this.recognition = new SpeechRecognitionClass();
            this.textChunkCallback = savedCallback;
            this.resetStateForNewRecognitionInstance();
            this.setupRecognition();
            this.recognition!.start();
            console.log("[BrowserSpeechRecognition] transcription restart (auto) — started");
          } catch (error) {
            console.warn(
              `[BrowserSpeechRecognition] Auto-restart failed (attempt ${this.restartAttempt}):`,
              error
            );
            // onend will fire again from the failed instance, triggering another retry
          }
        }, delay);
      }
    };
  }

  async start(): Promise<void> {
    const SpeechRecognitionClass =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognitionClass) {
      throw new Error("Speech recognition is not available");
    }

    const savedCallback = this.textChunkCallback;
    this.useCloudFallback = false;

    console.log("[BrowserSpeechRecognition] transcription start", {
      hadCallback: !!savedCallback,
    });

    this.recognition = new SpeechRecognitionClass();

    if (savedCallback) {
      this.textChunkCallback = savedCallback;
    } else {
      console.warn("[BrowserSpeechRecognition] WARNING: No callback set! Transcription will not work!");
    }

    this.setupRecognition();

    this.resetStateForNewRecognitionInstance();
    this.noSpeechCount = 0;
    this.restartAttempt = 0;
    this.isRunning = true;

    try {
      this.recognition.start();
      console.log("[BrowserSpeechRecognition] transcription start — recognition.start() ok");
    } catch (error) {
      this.isRunning = false;
      if (error instanceof Error) {
        console.error("[BrowserSpeechRecognition] transcription start failed:", error);
        throw error;
      }
      throw new Error("Unknown error starting recognition");
    }
  }

  onTextChunk(callback: (chunk: LiveRecognitionChunk) => void): void {
    if (this.textChunkCallback !== callback) {
      this.textChunkCallback = callback;
    }
  }

  stop(): void {
    console.log("[BrowserSpeechRecognition] transcription stop");
    this.isRunning = false;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (error) {
        console.warn("[BrowserSpeechRecognition] transcription stop error:", error);
      }
    }
  }

  isAvailable(): boolean {
    return !!(
      window.SpeechRecognition || window.webkitSpeechRecognition
    );
  }

  getProviderName(): string {
    return "Browser Speech Recognition";
  }
}
