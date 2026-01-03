import type { TranscriptionProvider, TranscriptChunk } from "../types/transcription";

// Type definitions for Web Speech API
interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
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

  constructor() {
    // Initialize SpeechRecognition if available
    const SpeechRecognitionClass =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (SpeechRecognitionClass) {
      this.recognition = new SpeechRecognitionClass();
      this.setupRecognition();
    }
  }

  private setupRecognition() {
    if (!this.recognition) return;

    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = "en-US";

    this.recognition.onresult = (event) => {
      if (!this.textChunkCallback) return;

      // The Web Speech API sends cumulative results - each event contains ALL results from the start
      // We need to process only NEW results (from resultIndex onwards) and track what we've sent
      
      // Process only results starting from resultIndex (where new results begin)
      // But also ensure we don't process anything before lastProcessedIndex
      const startIndex = Math.max(event.resultIndex, this.lastProcessedIndex);
      
      for (let i = startIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript.trim();
        
        // Skip empty transcripts
        if (!transcript) continue;
        
        if (result.isFinal) {
          // Check if we've already sent this exact final text
          if (this.sentFinalTexts.has(transcript)) {
            // Already sent, skip it
            this.lastProcessedIndex = i + 1;
            continue;
          }
          
          // Send final result immediately
          const currentMs = Date.now() - this.startTimeMs;
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
      // "no-speech" is a common, non-critical error that occurs when no speech is detected
      // It's expected behavior and not a real problem - the browser just times out
      if (event.error === "no-speech") {
        // Silently handle - this is normal when there's silence
        // Recognition will automatically restart via onend handler
        return;
      }
      
      // "aborted" occurs when recognition is stopped/interrupted (e.g., when pausing recording)
      // This is expected behavior and not an error
      if (event.error === "aborted") {
        // Silently handle - this is normal when stopping/pausing
        return;
      }
      
      // Log other errors as warnings (not errors) since they're usually recoverable
      if (event.error === "audio-capture" || event.error === "network") {
        console.warn("Speech recognition warning:", event.error, event.message || "");
      } else {
        // Only log actual errors for debugging
        console.error("Speech recognition error:", event.error, event.message || "");
      }
      
      // Continue running - most errors are recoverable
    };

    this.recognition.onend = () => {
      // Auto-restart if we're still supposed to be running
      // This handles cases where recognition stops due to "no-speech" or other recoverable errors
      if (this.isRunning && this.recognition) {
        try {
          this.recognition.start();
        } catch (error) {
          // If restart fails (e.g., already started), that's okay
          // The recognition might have already restarted automatically
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

    // Save the current callback before recreating
    const savedCallback = this.textChunkCallback;

    // Recreate recognition object for clean state
    this.recognition = new SpeechRecognitionClass();
    
    // Restore callback BEFORE setupRecognition so it's available in the onresult handler
    if (savedCallback) {
      this.textChunkCallback = savedCallback;
    }
    
    // Setup recognition with the callback already in place
    this.setupRecognition();

    // Reset state for new recording session
    this.startTimeMs = Date.now();
    this.lastProcessedIndex = 0; // Reset processed index when starting
    this.sentFinalTexts.clear(); // Clear sent texts when starting
    this.isRunning = true; // Mark that we're running

    try {
      this.recognition.start();
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
    this.textChunkCallback = callback;
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

