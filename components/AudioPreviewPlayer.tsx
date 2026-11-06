'use client';

import React, { useRef, useState, useEffect } from 'react';
import { Play, Pause, Volume2, VolumeX, RotateCcw } from 'lucide-react';
import { formatDuration } from '@/lib/format';

interface AudioPreviewPlayerProps {
  src: string;
  duration?: number;
  title: string;
}

export function AudioPreviewPlayer({ src, duration: initialDuration, title }: AudioPreviewPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(initialDuration || 0);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleLoadedMetadata = () => {
      if (audio.duration && !isNaN(audio.duration)) {
        setDuration(audio.duration);
      }
      setIsLoaded(true);
    };

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [src]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().then(() => {
        setIsPlaying(true);
      }).catch((e) => {
        console.error('Audio play error:', e);
      });
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const newTime = parseFloat(e.target.value);
    audio.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const toggleMute = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const restartAudio = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    setCurrentTime(0);
    if (!isPlaying) {
      audio.play().then(() => setIsPlaying(true));
    }
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="w-full bg-neutral-50 border border-neutral-200 rounded-xl p-4 sm:p-5">
      <audio ref={audioRef} src={src} preload="metadata" />

      {/* Header info */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className="w-2 h-2 rounded-full bg-neutral-400" />
          <span className="text-xs font-medium text-neutral-600 uppercase tracking-wider">
            Audio Preview
          </span>
        </div>
        <div className="text-xs font-mono text-neutral-500 tabular-nums">
          {formatDuration(currentTime)} / {formatDuration(duration)}
        </div>
      </div>

      {/* Progress Bar & Seek */}
      <div className="relative w-full h-2 bg-neutral-200 rounded-full cursor-pointer mb-4 overflow-hidden">
        <div
          className="absolute top-0 left-0 h-full bg-black transition-all duration-100 ease-linear"
          style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }}
        />
        <input
          type="range"
          min={0}
          max={duration || 100}
          step="0.1"
          value={currentTime}
          onChange={handleSeek}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          aria-label="Seek audio"
        />
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={togglePlay}
            className="w-10 h-10 rounded-full bg-black text-white hover:bg-neutral-800 transition-colors flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <Pause className="w-4 h-4 fill-current" />
            ) : (
              <Play className="w-4 h-4 fill-current ml-0.5" />
            )}
          </button>

          <button
            type="button"
            onClick={restartAudio}
            className="w-9 h-9 rounded-full text-neutral-600 hover:text-black hover:bg-neutral-200/60 transition-colors flex items-center justify-center focus:outline-none"
            title="Restart"
            aria-label="Restart audio from beginning"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>

        {/* Minimal Animated Soundwave bars when playing */}
        <div className="flex items-center gap-1 h-5 px-3">
          {[40, 75, 55, 90, 60, 85, 45, 65].map((height, i) => (
            <div
              key={i}
              className={`w-0.5 bg-neutral-400 rounded-full transition-all duration-300 ${
                isPlaying ? 'animate-pulse' : 'opacity-40'
              }`}
              style={{
                height: isPlaying ? `${Math.max(25, (height * (progressPercent % 10 + 5)) / 12)}%` : '30%',
                animationDelay: `${i * 120}ms`,
              }}
            />
          ))}
        </div>

        {/* Volume button */}
        <button
          type="button"
          onClick={toggleMute}
          className="w-9 h-9 rounded-full text-neutral-600 hover:text-black hover:bg-neutral-200/60 transition-colors flex items-center justify-center focus:outline-none"
          title={isMuted ? 'Unmute' : 'Mute'}
          aria-label={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
