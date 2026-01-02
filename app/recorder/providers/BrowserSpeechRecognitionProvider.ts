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
      console.error("Speech recognition error:", event.error);
      // Continue running even if there's an error
    };

    this.recognition.onend = () => {
      // Auto-restart if we're still supposed to be running
      // This will be controlled by the stop() method
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

    try {
      this.recognition.start();
    } catch (error) {
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

