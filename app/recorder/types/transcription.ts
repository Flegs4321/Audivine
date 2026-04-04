export interface TranscriptChunk {
  text: string;
  timestampMs: number;
  isFinal?: boolean;
  speaker?: string; // Name of the speaker for this chunk
  speakerTag?: boolean; // True if this chunk is a speaker tag marker (e.g., "[John sharing:]")
  /** Set on API when chunk comes from Whisper merge (idempotency for re-transcribe). */
  source?: "whisper";
}

export interface TranscriptionProvider {
  start(): Promise<void>;
  onTextChunk(callback: (chunk: TranscriptChunk) => void): void;
  stop(): void;
  isAvailable(): boolean;
  getProviderName(): string;
}

