"use client";

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { BrowserSpeechRecognitionProvider } from "../providers/BrowserSpeechRecognitionProvider";
import { RealtimeApiProvider } from "../providers/RealtimeApiProvider";
import type {
  TranscriptionProvider as ITranscriptionProvider,
  LiveRecognitionChunk,
} from "../types/transcription";

interface TranscriptionContextType {
  provider: ITranscriptionProvider | null;
  providerName: string | null;
  isAvailable: boolean;
  isActive: boolean;
  /** True when the browser reported "no speech" (mic not detected by speech API) */
  noSpeechDetected: boolean;
  start: () => Promise<void>;
  stop: () => void;
  onTextChunk: (callback: (chunk: LiveRecognitionChunk) => void) => void;
}

const TranscriptionContext = createContext<TranscriptionContextType | undefined>(undefined);

export function TranscriptionProviderComponent({ children }: { children: React.ReactNode }) {
  const [provider, setProvider] = useState<ITranscriptionProvider | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [noSpeechDetected, setNoSpeechDetected] = useState(false);
  const chunkCallbackRef = useRef<((chunk: LiveRecognitionChunk) => void) | null>(null);
  const stableWrapperRef = useRef<((chunk: LiveRecognitionChunk) => void) | null>(null);

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
    console.log("[TranscriptionProvider] start()");
    await provider.start();
    setIsActive(true);
    if (stableWrapperRef.current) {
      provider.onTextChunk(stableWrapperRef.current);
    }
  }, [provider]);

  const stop = useCallback(() => {
    console.log("[TranscriptionProvider] stop()");
    if (provider) provider.stop();
    setIsActive(false);
  }, [provider]);

  const onTextChunk = useCallback((callback: (chunk: LiveRecognitionChunk) => void) => {
    chunkCallbackRef.current = callback;
  }, []);

  useEffect(() => {
    if (!provider) return;
    const wrapper = (chunk: LiveRecognitionChunk) => {
      if (
        chunk == null ||
        typeof chunk.text !== "string" ||
        typeof chunk.isFinal !== "boolean"
      ) {
        if (process.env.NODE_ENV === "development") {
          console.warn("[TranscriptionProvider] Dropping invalid chunk:", chunk);
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

