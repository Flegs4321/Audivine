export interface TranscriptChunk {
  text: string;
  timestampMs: number;
  isFinal?: boolean;
  speaker?: string; // Name of the speaker for this chunk
  speakerTag?: boolean; // True if this chunk is a speaker tag marker (e.g., "[John sharing:]")
  /** whisper = post-upload merge; whisper-live = slice during recording (not used for idempotency). */
  source?: "whisper" | "whisper-live";
}

export interface TranscriptionProvider {
  start(): Promise<void>;
  onTextChunk(callback: (chunk: TranscriptChunk) => void): void;
  stop(): void;
  isAvailable(): boolean;
  getProviderName(): string;
}

