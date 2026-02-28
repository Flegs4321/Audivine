"use client";

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { BrowserSpeechRecognitionProvider } from "../providers/BrowserSpeechRecognitionProvider";
import { RealtimeApiProvider } from "../providers/RealtimeApiProvider";
import type { TranscriptionProvider as ITranscriptionProvider, TranscriptChunk } from "../types/transcription";

interface TranscriptionContextType {
  provider: ITranscriptionProvider | null;
  providerName: string | null;
  isAvailable: boolean;
  isActive: boolean;
  /** True when the browser reported "no speech" (mic not detected by speech API) */
  noSpeechDetected: boolean;
  start: () => Promise<void>;
  stop: () => void;
  onTextChunk: (callback: (chunk: TranscriptChunk) => void) => void;
}

const TranscriptionContext = createContext<TranscriptionContextType | undefined>(undefined);

export function TranscriptionProviderComponent({ children }: { children: React.ReactNode }) {
  const [provider, setProvider] = useState<ITranscriptionProvider | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [noSpeechDetected, setNoSpeechDetected] = useState(false);
  const chunkCallbackRef = useRef<((chunk: TranscriptChunk) => void) | null>(null);
  // Single stable wrapper: forwards chunks to whatever callback is currently in the ref
  const stableWrapperRef = useRef<((chunk: TranscriptChunk) => void) | null>(null);

  // Initialize provider on mount
  useEffect(() => {
    const browserProvider = new BrowserSpeechRecognitionProvider();
    if (browserProvider.isAvailable()) {
      browserProvider.setOnNoSpeech(() => setNoSpeechDetected(true));
      setProvider(browserProvider);
      return;
    }
    const realtimeProvider = new RealtimeApiProvider();
    if (realtimeProvider.isAvailable()) {
      setProvider(realtimeProvider);
      return;
    }
    setProvider(null);
  }, []);

  const start = useCallback(async () => {
    if (!provider) {
      throw new Error("No transcription provider available");
    }
    setNoSpeechDetected(false);
    await provider.start();
    setIsActive(true);
    if (stableWrapperRef.current) {
      provider.onTextChunk(stableWrapperRef.current);
    }
  }, [provider]);

  const stop = useCallback(() => {
    if (provider) provider.stop();
    setIsActive(false);
  }, [provider]);

  const onTextChunk = useCallback((callback: (chunk: TranscriptChunk) => void) => {
    chunkCallbackRef.current = callback;
  }, []);

  // Register a single stable wrapper with the engine when provider exists.
  // Only this wrapper is ever passed to the engine; the page only updates chunkCallbackRef.
  // The wrapper validates chunk and forwards to the current page callback so live chunks always reach the UI.
  useEffect(() => {
    if (!provider) return;
    const wrapper = (chunk: TranscriptChunk) => {
      if (chunk == null || typeof (chunk as { text?: unknown }).text !== "string") {
        if (process.env.NODE_ENV === "development") {
          console.warn("[TranscriptionProvider] Dropping invalid chunk (no text):", chunk);
        }
        return;
      }
      const fn = chunkCallbackRef.current;
      if (typeof fn !== "function") return;
      try {
        fn(chunk);
      } catch (err) {
        console.error("[TranscriptionProvider] Chunk handler threw; continuing.", err);
      }
    };
    stableWrapperRef.current = wrapper;
    provider.onTextChunk(wrapper);
  }, [provider]);

  const value: TranscriptionContextType = {
    provider,
    providerName: provider?.getProviderName() || null,
    isAvailable: provider?.isAvailable() ?? false,
    isActive,
    noSpeechDetected,
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

