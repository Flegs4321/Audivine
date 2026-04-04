/** Stored transcript line with recorder-relative timing and optional speaker metadata. */
export interface TranscriptChunk {
  text: string;
  timestampMs: number;
  isFinal?: boolean;
  speaker?: string; // Name of the speaker for this chunk
  speakerTag?: boolean; // True if this chunk is a speaker tag marker (e.g., "[John sharing:]")
}

/**
 * Emitted by speech engines only. The recorder assigns `timestampMs` and attaches `speaker`
 * from `currentSpeakerRef` when appending to the transcript.
 */
export interface LiveRecognitionChunk {
  text: string;
  isFinal: boolean;
}

export interface TranscriptionProvider {
  start(): Promise<void>;
  onTextChunk(callback: (chunk: LiveRecognitionChunk) => void): void;
  stop(): void;
  isAvailable(): boolean;
  getProviderName(): string;
}

/** Extended provider that accepts the recorder's MediaStream and auth token. */
export interface StreamAwareTranscriptionProvider extends TranscriptionProvider {
  setMediaStream(stream: MediaStream): void;
  setAuthToken(token: string): void;
}

export function isStreamAwareProvider(
  provider: TranscriptionProvider
): provider is StreamAwareTranscriptionProvider {
  return "setMediaStream" in provider && "setAuthToken" in provider;
}

