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

    // Callback is already set up via useEffect, don't set it again here
    // This prevents duplicate callback registration

    await provider.start();
    setIsActive(true);
  }, [provider]);

  const stop = useCallback(() => {
    if (provider) {
      provider.stop();
    }
    setIsActive(false);
  }, [provider]);

  const onTextChunk = useCallback((callback: (chunk: TranscriptChunk) => void) => {
    setTextChunkCallback(() => callback);
    // Don't set callback here - let the useEffect handle it to avoid duplicates
  }, []);

  // Update callback on provider when it changes
  // This ensures the callback is only set once per provider
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

