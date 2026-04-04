import type { TranscriptionProvider, TranscriptChunk } from "../types/transcription";

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
  private textChunkCallback: ((chunk: TranscriptChunk) => void) | null = null;
  private startTimeMs: number = 0;
  private lastProcessedIndex: number = 0; // Track the last result index we've processed
  private sentFinalTexts: Set<string> = new Set(); // Track final texts we've already sent
  private isRunning: boolean = false; // Track if we're supposed to be running
  private noSpeechCount: number = 0; // For logging no-speech (browser often ends without results)
  private onNoSpeechCallback: (() => void) | null = null;
  /** When true, skip processLocally (on-device requires language pack; fall back to cloud) */
  private useCloudFallback: boolean = false;

  constructor() {
    const SpeechRecognitionClass =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (SpeechRecognitionClass) {
      this.recognition = new SpeechRecognitionClass();
      this.setupRecognition();
    }
  }

  /** Optional: called when the browser reports "no speech" so the UI can show a hint */
  setOnNoSpeech(callback: (() => void) | null): void {
    this.onNoSpeechCallback = callback;
  }

  /**
   * Each new `SpeechRecognition` instance starts a fresh result stream (indices from 0).
   * If we replace the engine while keeping the same recording session, we must reset
   * bookkeeping or `lastProcessedIndex` stays high and we skip every result until the
   * new session's cumulative length catches up — looks like "dead" live transcript until
   * pause/resume calls `start()` which resets state.
   */
  private resetStateForNewRecognitionInstance(): void {
    this.lastProcessedIndex = 0;
    this.sentFinalTexts.clear();
  }

  private setupRecognition() {
    if (!this.recognition) return;

    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = "en-US";
    // On Chrome 139+, use on-device recognition so it works on deployed sites (Vercel).
    // If the device doesn't have the language pack we get language-not-supported and fall back to cloud.
    if (!this.useCloudFallback && "processLocally" in this.recognition) {
      (this.recognition as SpeechRecognition).processLocally = true;
    }

    this.recognition.onresult = (event) => {
      if (!this.textChunkCallback) {
        console.warn("[BrowserSpeechRecognition] onresult fired but no callback set!");
        return;
      }

      console.log(`[BrowserSpeechRecognition] onresult fired: resultIndex=${event.resultIndex}, results.length=${event.results.length}`);

      // The Web Speech API sends cumulative results - each event contains ALL results from the start
      // We need to process only NEW results (from resultIndex onwards) and track what we've sent
      
      // Process only results starting from resultIndex (where new results begin)
      // But also ensure we don't process anything before lastProcessedIndex
      const startIndex = Math.max(event.resultIndex, this.lastProcessedIndex);
      
      console.log(`[BrowserSpeechRecognition] Processing results from index ${startIndex} to ${event.results.length - 1}`);
      
      for (let i = startIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result || result.length === 0) continue;
        const first = result[0];
        if (!first || first.transcript == null) continue;
        const transcript = String(first.transcript).trim();
        if (!transcript) continue;
        
        if (result.isFinal) {
          // Check if we've already sent this exact final text
          if (this.sentFinalTexts.has(transcript)) {
            // Already sent, skip it
            console.log(`[BrowserSpeechRecognition] Skipping duplicate final: "${transcript.substring(0, 30)}..."`);
            this.lastProcessedIndex = i + 1;
            continue;
          }
          
          // Send final result immediately
          const currentMs = Date.now() - this.startTimeMs;
          console.log(`[BrowserSpeechRecognition] Sending final chunk: "${transcript.substring(0, 50)}..." at ${currentMs}ms`);
          this.textChunkCallback({
            text: transcript,
            timestampMs: currentMs,
            isFinal: true,
          });
          
          // Mark as sent
          this.sentFinalTexts.add(transcript);
          // Update last processed index to prevent reprocessing
          this.lastProcessedIndex = i + 1;
        } else {
          // For interim results, only send if this is the last result (most recent interim)
          // This prevents sending multiple interim updates for the same text
          // Also skip if we've already sent this as a final result
          if (i === event.results.length - 1 && !this.sentFinalTexts.has(transcript)) {
            const currentMs = Date.now() - this.startTimeMs;
            console.log(`[BrowserSpeechRecognition] Sending interim chunk: "${transcript.substring(0, 50)}..." at ${currentMs}ms`);
            this.textChunkCallback({
              text: transcript,
              timestampMs: currentMs,
              isFinal: false,
            });
          }
        }
      }
    };

    this.recognition.onerror = (event) => {
      const errorType = event.error?.toLowerCase() || "";
      
      // "no-speech" is a common, non-critical error that occurs when no speech is detected
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
      
      // "aborted" / "interrupted" when recognition is stopped or the tab loses focus briefly
      if (errorType === "aborted" || errorType === "interrupted") {
        return;
      }

      // On-device (processLocally) can fail for various reasons. Fall back to cloud recognition.
      // This improves Chrome compatibility when on-device has issues (language pack, policy, etc.).
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
      console.log(`[BrowserSpeechRecognition] onend fired, isRunning: ${this.isRunning}, callback present: ${!!this.textChunkCallback}`);
      // Auto-restart if we're still supposed to be running. Create a FRESH instance instead of
      // restarting the old one - Chrome/Edge can leave the recognition in a bad state after
      // no-speech or timeout, and rec.start() on the old object often fails.
      if (this.isRunning && this.textChunkCallback) {
        const SpeechRecognitionClass =
          window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognitionClass) return;

        const doRestart = (attempt: number, maxAttempts: number = 3) => {
          const delay = 300 + attempt * 200; // 300ms, 500ms, 700ms
          setTimeout(() => {
            if (!this.isRunning || !this.textChunkCallback) return;
            try {
              // Create fresh instance - old one may be in invalid state
              const savedCallback = this.textChunkCallback;
              this.recognition = new SpeechRecognitionClass();
              this.textChunkCallback = savedCallback;
              this.resetStateForNewRecognitionInstance();
              this.setupRecognition();
              this.recognition!.start();
              console.log(`[BrowserSpeechRecognition] Auto-restarted with fresh instance (attempt ${attempt + 1})`);
            } catch (error) {
              console.warn(`[BrowserSpeechRecognition] Auto-restart failed (attempt ${attempt + 1}/${maxAttempts}):`, error);
              if (attempt + 1 < maxAttempts) {
                doRestart(attempt + 1, maxAttempts);
              }
            }
          }, delay);
        };
        doRestart(0);
      } else {
        if (!this.isRunning) {
          console.log("[BrowserSpeechRecognition] Not auto-restarting - isRunning is false");
        }
        if (!this.textChunkCallback) {
          console.warn("[BrowserSpeechRecognition] Not auto-restarting - no callback set!");
        }
      }
    };
  }

  async start(): Promise<void> {
    // Always recreate the recognition object to ensure clean state after pause/resume
    // This is necessary because the Web Speech API can get into an invalid state
    const SpeechRecognitionClass =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognitionClass) {
      throw new Error("Speech recognition is not available");
    }

    const savedCallback = this.textChunkCallback;
    this.useCloudFallback = false; // Try on-device first each session

    console.log("[BrowserSpeechRecognition] Starting recognition, callback present:", !!savedCallback);

    this.recognition = new SpeechRecognitionClass();
    
    // Restore callback BEFORE setupRecognition so it's available in the onresult handler
    if (savedCallback) {
      this.textChunkCallback = savedCallback;
      console.log("[BrowserSpeechRecognition] Callback restored before setup");
    } else {
      console.warn("[BrowserSpeechRecognition] WARNING: No callback set! Transcription will not work!");
    }
    
    // Setup recognition with the callback already in place
    this.setupRecognition();
    console.log("[BrowserSpeechRecognition] Recognition setup complete, callback present:", !!this.textChunkCallback);

    // Reset state for new recording session
    this.startTimeMs = Date.now();
    this.resetStateForNewRecognitionInstance();
    this.noSpeechCount = 0;
    this.isRunning = true;

    try {
      this.recognition.start();
      console.log("[BrowserSpeechRecognition] Recognition started successfully");
    } catch (error) {
      this.isRunning = false; // Reset flag if start fails
      // If still fails, throw the error
      if (error instanceof Error) {
        console.error("[Transcription] Failed to start recognition:", error);
        throw error;
      }
      throw new Error("Unknown error starting recognition");
    }
  }

  onTextChunk(callback: (chunk: TranscriptChunk) => void): void {
    console.log("[BrowserSpeechRecognition] onTextChunk called, setting callback");
    // CRITICAL: Only update callback if it's different or null
    // Re-setting the same callback while recognition is running can cause issues
    if (this.textChunkCallback !== callback) {
      this.textChunkCallback = callback;
      console.log("[BrowserSpeechRecognition] Callback updated");
    } else {
      console.log("[BrowserSpeechRecognition] Callback unchanged, skipping update to avoid interrupting recognition");
    }
    // If recognition is already set up, we need to ensure the callback is available
    // The onresult handler will use this.textChunkCallback
    if (this.recognition) {
      console.log("[BrowserSpeechRecognition] Callback set, recognition object exists and is", this.isRunning ? "running" : "stopped");
    }
  }

  stop(): void {
    this.isRunning = false; // Mark that we're no longer running
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (error) {
        // Ignore errors when stopping
        console.warn("Error stopping recognition:", error);
      }
    }
    // Don't clear the callback - we might restart soon
    // this.textChunkCallback = null;
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

