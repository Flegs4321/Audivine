export interface TranscriptChunk {
  text: string;
  timestampMs: number;
  isFinal?: boolean;
}

export interface TranscriptionProvider {
  start(): Promise<void>;
  onTextChunk(callback: (chunk: TranscriptChunk) => void): void;
  stop(): void;
  isAvailable(): boolean;
  getProviderName(): string;
}

