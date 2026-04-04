"use client";

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { BrowserSpeechRecognitionProvider } from "../providers/BrowserSpeechRecognitionProvider";
import { WhisperLiveProvider } from "../providers/WhisperLiveProvider";
import {
  isStreamAwareProvider,
} from "../types/transcription";
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
  /** Pass the recorder's MediaStream so Whisper can use the correct audio device. */
  setMediaStream: (stream: MediaStream) => void;
  /** Pass the Supabase auth token for server-side API calls. */
  setAuthToken: (token: string) => void;
}

interface TranscriptionProviderProps {
  children: React.ReactNode;
  /** When true and available, use WhisperLiveProvider instead of BrowserSpeechRecognition. */
  preferWhisper?: boolean;
}

const TranscriptionContext = createContext<TranscriptionContextType | undefined>(undefined);

export function TranscriptionProviderComponent({ children, preferWhisper = false }: TranscriptionProviderProps) {
  const [provider, setProvider] = useState<ITranscriptionProvider | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [noSpeechDetected, setNoSpeechDetected] = useState(false);
  const chunkCallbackRef = useRef<((chunk: LiveRecognitionChunk) => void) | null>(null);
  const stableWrapperRef = useRef<((chunk: LiveRecognitionChunk) => void) | null>(null);

  // Initialize provider based on preference
  useEffect(() => {
    if (preferWhisper) {
      console.log("[TranscriptionProvider] Using WhisperLiveProvider");
      const whisperProvider = new WhisperLiveProvider();
      setProvider(whisperProvider);
      return;
    }

    // Fallback: Browser Speech Recognition
    const browserProvider = new BrowserSpeechRecognitionProvider();
    if (browserProvider.isAvailable()) {
      console.log("[TranscriptionProvider] Using BrowserSpeechRecognitionProvider");
      browserProvider.setOnNoSpeech(() => setNoSpeechDetected(true));
      browserProvider.setOnSpeechResumed(() => setNoSpeechDetected(false));
      setProvider(browserProvider);
      return;
    }

    console.warn("[TranscriptionProvider] No transcription provider available");
    setProvider(null);
  }, [preferWhisper]);

  const start = useCallback(async () => {
    if (!provider) {
      throw new Error("No transcription provider available");
    }
    setNoSpeechDetected(false);
    // Register callback BEFORE starting so early chunks are not lost
    if (stableWrapperRef.current) {
      provider.onTextChunk(stableWrapperRef.current);
    }
    console.log("[TranscriptionProvider] start()");
    await provider.start();
    setIsActive(true);
  }, [provider]);

  const stop = useCallback(() => {
    console.log("[TranscriptionProvider] stop()");
    if (provider) provider.stop();
    setIsActive(false);
  }, [provider]);

  const onTextChunk = useCallback((callback: (chunk: LiveRecognitionChunk) => void) => {
    chunkCallbackRef.current = callback;
  }, []);

  // Delegate stream/token to the provider if it supports it
  const setMediaStream = useCallback((stream: MediaStream) => {
    if (provider && isStreamAwareProvider(provider)) {
      provider.setMediaStream(stream);
    }
  }, [provider]);

  const setAuthToken = useCallback((token: string) => {
    if (provider && isStreamAwareProvider(provider)) {
      provider.setAuthToken(token);
    }
  }, [provider]);

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
    setMediaStream,
    setAuthToken,
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
