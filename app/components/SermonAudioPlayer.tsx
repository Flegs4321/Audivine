"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface SermonAudioPlayerProps {
  src: string;
  /** Known recording duration in seconds (from DB). Used when the audio
   *  file lacks duration metadata (common for MediaRecorder WebM files). */
  knownDuration?: number;
  autoPlay?: boolean;
  className?: string;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Custom audio player that handles broken WebM duration metadata.
 *
 * MediaRecorder-produced WebM files often have `duration === Infinity`
 * because the WebM container is written without a Cues element. To fix
 * this we seek to a very large time, which forces the browser to read
 * to the end of the stream and compute the real duration, then seek back.
 *
 * As a fallback we use `knownDuration` from the database for display.
 */
export default function SermonAudioPlayer({
  src,
  knownDuration,
  autoPlay = false,
  className = "",
}: SermonAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [duration, setDuration] = useState<number>(
    knownDuration && Number.isFinite(knownDuration) ? knownDuration : 0
  );
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isFixingDuration, setIsFixingDuration] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);

  const fixDurationIfNeeded = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      setDuration(audio.duration);
      setIsReady(true);
      return;
    }
    setIsFixingDuration(true);
    const handleDurationChange = () => {
      const audioEl = audioRef.current;
      if (!audioEl) return;
      if (Number.isFinite(audioEl.duration) && audioEl.duration > 0) {
        audioEl.removeEventListener("durationchange", handleDurationChange);
        const fixedDuration = audioEl.duration;
        try {
          audioEl.currentTime = 0;
        } catch {
          // ignore
        }
        setDuration(fixedDuration);
        setIsFixingDuration(false);
        setIsReady(true);
      }
    };
    audio.addEventListener("durationchange", handleDurationChange);
    try {
      audio.currentTime = Number.MAX_SAFE_INTEGER;
    } catch {
      // Some browsers throw; rely on knownDuration fallback.
      audio.removeEventListener("durationchange", handleDurationChange);
      setIsFixingDuration(false);
      setIsReady(true);
    }
  }, []);

  useEffect(() => {
    setCurrentTime(0);
    setIsReady(false);
    setDuration(
      knownDuration && Number.isFinite(knownDuration) ? knownDuration : 0
    );
  }, [src, knownDuration]);

  const handleLoadedMetadata = () => {
    fixDurationIfNeeded();
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio || isSeeking || isFixingDuration) return;
    setCurrentTime(audio.currentTime);
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(duration);
  };

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      try {
        await audio.play();
        setIsPlaying(true);
      } catch (err) {
        console.error("Failed to play audio:", err);
      }
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  };

  const handleScrubChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setIsSeeking(true);
    setCurrentTime(parseFloat(e.target.value));
  };

  const handleScrubCommit = (e: React.SyntheticEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    const target = e.currentTarget;
    const value = parseFloat(target.value);
    if (audio && Number.isFinite(value)) {
      try {
        audio.currentTime = value;
      } catch {
        // ignore
      }
    }
    setIsSeeking(false);
  };

  const progressMax = duration > 0 ? duration : 0;
  const progressValue = Math.min(currentTime, progressMax);

  return (
    <div className={`flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 ${className}`}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        autoPlay={autoPlay}
        onLoadedMetadata={handleLoadedMetadata}
        onDurationChange={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        className="hidden"
      >
        Your browser does not support the audio element.
      </audio>

      <button
        type="button"
        onClick={togglePlay}
        disabled={!isReady && !isFixingDuration && progressMax === 0}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      <span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-slate-600">
        {formatTime(progressValue)}
      </span>

      <input
        type="range"
        min={0}
        max={progressMax || 0}
        step={0.01}
        value={progressValue}
        onChange={handleScrubChange}
        onMouseUp={handleScrubCommit}
        onTouchEnd={handleScrubCommit}
        onKeyUp={handleScrubCommit}
        disabled={progressMax === 0}
        className="h-1 flex-1 cursor-pointer accent-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
        aria-label="Seek"
      />

      <span className="w-12 shrink-0 font-mono text-xs tabular-nums text-slate-600">
        {formatTime(progressMax)}
      </span>
    </div>
  );
}
