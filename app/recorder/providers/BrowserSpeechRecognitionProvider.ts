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

      // Process only NEW results (from resultIndex onwards)
      // This prevents processing the same results multiple times
      let interimTranscript = "";
      let finalTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        
        if (result.isFinal) {
          finalTranscript += transcript + " ";
        } else {
          // Only add interim if it's new (not already in final)
          interimTranscript += transcript;
        }
      }

      // Send final results first (if any)
      if (finalTranscript.trim()) {
        const currentMs = Date.now() - this.startTimeMs;
        this.textChunkCallback({
          text: finalTranscript.trim(),
          timestampMs: currentMs,
          isFinal: true,
        });
      }

      // Send interim results only if there are no final results in this batch
      // This prevents showing interim text that's already been finalized
      if (interimTranscript.trim() && !finalTranscript.trim()) {
        const currentMs = Date.now() - this.startTimeMs;
        this.textChunkCallback({
          text: interimTranscript.trim(),
          timestampMs: currentMs,
          isFinal: false,
        });
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
    if (!this.recognition) {
      throw new Error("Speech recognition is not available");
    }

    this.startTimeMs = Date.now();

    try {
      this.recognition.start();
    } catch (error) {
      // If already started, that's okay
      if (error instanceof Error && error.name !== "InvalidStateError") {
        throw error;
      }
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
    this.textChunkCallback = null;
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

