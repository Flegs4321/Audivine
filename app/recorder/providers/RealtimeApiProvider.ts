import type { TranscriptionProvider, TranscriptChunk } from "../types/transcription";

export class RealtimeApiProvider implements TranscriptionProvider {
  private textChunkCallback: ((chunk: TranscriptChunk) => void) | null = null;
  private startTimeMs: number = 0;

  async start(): Promise<void> {
    // TODO: Initialize Realtime API connection
    // TODO: Set up WebSocket or streaming connection
    // TODO: Configure API keys and authentication
    this.startTimeMs = Date.now();
    throw new Error("RealtimeApiProvider is not yet implemented");
  }

  onTextChunk(callback: (chunk: TranscriptChunk) => void): void {
    // TODO: Set up callback for receiving transcript chunks from API
    this.textChunkCallback = callback;
  }

  stop(): void {
    // TODO: Close WebSocket/streaming connection
    // TODO: Clean up API resources
    this.textChunkCallback = null;
  }

  isAvailable(): boolean {
    // TODO: Check if API keys are configured
    // TODO: Check if API endpoint is reachable
    return false; // Not available until implemented
  }

  getProviderName(): string {
    return "Realtime API";
  }
}

