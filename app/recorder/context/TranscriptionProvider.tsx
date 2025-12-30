"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { BrowserSpeechRecognitionProvider } from "../providers/BrowserSpeechRecognitionProvider";
import { RealtimeApiProvider } from "../providers/RealtimeApiProvider";
import type { TranscriptionProvider as ITranscriptionProvider, TranscriptChunk } from "../types/transcription";

interface TranscriptionContextType {
  provider: ITranscriptionProvider | null;
  providerName: string | null;
  isAvailable: boolean;
  isActive: boolean;
  start: () => Promise<void>;
  stop: () => void;
  onTextChunk: (callback: (chunk: TranscriptChunk) => void) => void;
}

const TranscriptionContext = createContext<TranscriptionContextType | undefined>(undefined);

export function TranscriptionProviderComponent({ children }: { children: React.ReactNode }) {
  const [provider, setProvider] = useState<ITranscriptionProvider | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [textChunkCallback, setTextChunkCallback] = useState<((chunk: TranscriptChunk) => void) | null>(null);

  // Initialize provider on mount
  useEffect(() => {
    // Try browser provider first
    const browserProvider = new BrowserSpeechRecognitionProvider();
    if (browserProvider.isAvailable()) {
      setProvider(browserProvider);
      return;
    }

    // Try realtime provider as fallback (when implemented)
    const realtimeProvider = new RealtimeApiProvider();
    if (realtimeProvider.isAvailable()) {
      setProvider(realtimeProvider);
      return;
    }

    // No provider available
    setProvider(null);
  }, []);

  const start = useCallback(async () => {
    if (!provider) {
      throw new Error("No transcription provider available");
    }

    // Set up text chunk callback if provided
    if (textChunkCallback) {
      provider.onTextChunk(textChunkCallback);
    }

    await provider.start();
    setIsActive(true);
  }, [provider, textChunkCallback]);

  const stop = useCallback(() => {
    if (provider) {
      provider.stop();
    }
    setIsActive(false);
  }, [provider]);

  const onTextChunk = useCallback((callback: (chunk: TranscriptChunk) => void) => {
    setTextChunkCallback(() => callback);
    if (provider) {
      provider.onTextChunk(callback);
    }
  }, [provider]);

  // Update callback on provider when it changes
  useEffect(() => {
    if (provider && textChunkCallback) {
      provider.onTextChunk(textChunkCallback);
    }
  }, [provider, textChunkCallback]);

  const value: TranscriptionContextType = {
    provider,
    providerName: provider?.getProviderName() || null,
    isAvailable: provider?.isAvailable() ?? false,
    isActive,
    start,
    stop,
    onTextChunk,
  };

  return (
    <TranscriptionContext.Provider value={value}>
      {children}
    </TranscriptionContext.Provider>
  );
}

export function useTranscription() {
  const context = useContext(TranscriptionContext);
  if (context === undefined) {
    throw new Error("useTranscription must be used within a TranscriptionProviderComponent");
  }
  return context;
}

