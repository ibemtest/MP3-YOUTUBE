'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Music,
  ArrowRight,
  Download,
  RotateCcw,
  Upload,
  AlertCircle,
  CheckCircle2,
  FileAudio,
  Sparkles,
  Loader2,
  X,
  Clock,
  HardDrive,
} from 'lucide-react';
import { AudioPreviewPlayer } from './AudioPreviewPlayer';

interface JobInfo {
  id: string;
  sourceType: 'youtube' | 'upload' | 'sample' | 'direct_url';
  status: 'pending' | 'extracting' | 'converting' | 'completed' | 'error';
  progress: number;
  stage: string;
  title: string;
  author?: string;
  duration: number;
  durationFormatted: string;
  thumbnailUrl?: string;
  outputFilename?: string;
  fileSizeBytes?: number;
  error?: string;
  errorCode?: 'BOT_RESTRICTION' | 'INVALID_URL' | 'CONVERSION_FAILED' | 'FILE_TOO_LARGE' | 'UNKNOWN';
}

export function Mp3Converter() {
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'url' | 'upload'>('url');

  // Processing state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentJob, setCurrentJob] = useState<JobInfo | null>(null);
  const [isCompleted, setIsCompleted] = useState(false);

  // File upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Status polling timer
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  const validateUrl = (input: string): boolean => {
    const trimmed = input.trim();
    if (!trimmed) {
      setUrlError('Please enter a YouTube video URL.');
      return false;
    }

    const ytRegex = /^(https?:\/\/)?(www\.|music\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    if (!ytRegex.test(trimmed)) {
      setUrlError('Please enter a valid YouTube URL (e.g. https://www.youtube.com/watch?v=...)');
      return false;
    }

    setUrlError(null);
    return true;
  };

  const startPolling = (jobId: string) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/convert/status?id=${jobId}`);
        if (!res.ok) {
          if (res.status === 404) {
            clearInterval(pollIntervalRef.current!);
            setCurrentJob((prev) =>
              prev ? { ...prev, status: 'error', error: 'Task expired or not found.' } : null
            );
          }
          return;
        }

        const data: JobInfo = await res.json();
        setCurrentJob(data);

        if (data.status === 'completed') {
          clearInterval(pollIntervalRef.current!);
          setIsCompleted(true);
          setIsSubmitting(false);
        } else if (data.status === 'error') {
          clearInterval(pollIntervalRef.current!);
          setIsSubmitting(false);
        }
      } catch (err) {
        console.error('Polling status error:', err);
      }
    }, 350);
  };

  // Convert via YouTube URL
  const handleConvertUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateUrl(url)) return;

    setIsSubmitting(true);
    setUrlError(null);
    setCurrentJob(null);
    setIsCompleted(false);

    try {
      const res = await fetch('/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setIsSubmitting(false);
        setUrlError(data.error || 'Failed to start conversion.');
        return;
      }

      setCurrentJob({
        id: data.taskId,
        sourceType: 'youtube',
        status: data.status || 'extracting',
        progress: 10,
        stage: 'Connecting to YouTube media source...',
        title: data.title || 'YouTube Audio',
        author: data.author,
        duration: 0,
        durationFormatted: '--:--',
        thumbnailUrl: data.thumbnailUrl,
      });

      startPolling(data.taskId);
    } catch (err: any) {
      setIsSubmitting(false);
      setUrlError(err.message || 'Network error connecting to conversion server.');
    }
  };

  // Convert via File Upload
  const handleFileUpload = async (fileToUpload: File) => {
    setIsSubmitting(true);
    setUrlError(null);
    setCurrentJob(null);
    setIsCompleted(false);

    try {
      const formData = new FormData();
      formData.append('file', fileToUpload);

      const res = await fetch('/api/convert', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setIsSubmitting(false);
        setUrlError(data.error || 'File upload failed.');
        return;
      }

      setCurrentJob({
        id: data.taskId,
        sourceType: 'upload',
        status: 'converting',
        progress: 15,
        stage: 'Uploaded successfully. Encoding MP3 with FFmpeg...',
        title: data.title || fileToUpload.name,
        duration: data.duration || 0,
        durationFormatted: data.durationFormatted || '--:--',
      });

      startPolling(data.taskId);
    } catch (err: any) {
      setIsSubmitting(false);
      setUrlError(err.message || 'Error uploading file.');
    }
  };

  // Convert authorized sample audio (instant test)
  const handleSampleConvert = async (sampleType: 'audio' | 'video' = 'audio') => {
    setIsSubmitting(true);
    setUrlError(null);
    setCurrentJob(null);
    setIsCompleted(false);

    try {
      const res = await fetch('/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sampleId: sampleType }),
      });

      const data = await res.json();
      if (!res.ok) {
        setIsSubmitting(false);
        setUrlError(data.error || 'Failed to start sample conversion.');
        return;
      }

      setCurrentJob({
        id: data.taskId,
        sourceType: 'sample',
        status: 'converting',
        progress: 15,
        stage: 'Encoding sample with FFmpeg...',
        title: data.title,
        duration: data.duration,
        durationFormatted: data.durationFormatted,
      });

      startPolling(data.taskId);
    } catch (err: any) {
      setIsSubmitting(false);
      setUrlError(err.message || 'Error processing sample.');
    }
  };

  const handleReset = () => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    setUrl('');
    setUrlError(null);
    setIsSubmitting(false);
    setCurrentJob(null);
    setIsCompleted(false);
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes || bytes <= 0) return '';
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.round(bytes / 1024)} KB`;
  };

  return (
    <div className="w-full max-w-xl mx-auto">
      {/* 1. Logo text */}
      <div className="flex items-center justify-center gap-2 mb-8">
        <div className="w-8 h-8 rounded-lg bg-black text-white flex items-center justify-center">
          <Music className="w-4 h-4" />
        </div>
        <span className="text-xl font-bold tracking-tight text-neutral-900">
          MP3 Downloader
        </span>
      </div>

      {/* 2. Main Heading & 3. Subtitle */}
      <div className="text-center mb-8">
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-neutral-900">
          YouTube to MP3
        </h1>
        <p className="mt-2 text-neutral-500 text-sm sm:text-base">
          Download audio in MP3 format.
        </p>
      </div>

      {/* Main Card Container */}
      <div className="bg-white border border-neutral-200/90 rounded-2xl p-6 sm:p-8 shadow-sm">
        {/* State 1: IDLE / INPUT STATE */}
        {!currentJob && (
          <div>
            {/* Input Method Switcher (Minimalist tabs) */}
            <div className="flex items-center justify-center p-1 bg-neutral-100 rounded-lg mb-6 max-w-xs mx-auto">
              <button
                type="button"
                onClick={() => { setActiveTab('url'); setUrlError(null); }}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
                  activeTab === 'url'
                    ? 'bg-white text-neutral-900 shadow-sm'
                    : 'text-neutral-500 hover:text-neutral-900'
                }`}
              >
                YouTube URL
              </button>
              <button
                type="button"
                onClick={() => { setActiveTab('upload'); setUrlError(null); }}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
                  activeTab === 'upload'
                    ? 'bg-white text-neutral-900 shadow-sm'
                    : 'text-neutral-500 hover:text-neutral-900'
                }`}
              >
                Upload File
              </button>
            </div>

            {/* Tab A: YouTube URL Input */}
            {activeTab === 'url' && (
              <form onSubmit={handleConvertUrl} className="space-y-4">
                <div>
                  <label htmlFor="youtube-url-input" className="sr-only">
                    YouTube URL
                  </label>
                  <div className="relative">
                    {/* 4. Large input field */}
                    <input
                      id="youtube-url-input"
                      type="text"
                      value={url}
                      onChange={(e) => {
                        setUrl(e.target.value);
                        if (urlError) setUrlError(null);
                      }}
                      placeholder="Paste YouTube URL here..."
                      className={`w-full px-4 py-3.5 sm:py-4 text-sm sm:text-base bg-white border ${
                        urlError ? 'border-red-400 focus:border-red-500 focus:ring-red-200' : 'border-neutral-300 focus:border-black focus:ring-neutral-200'
                      } rounded-xl focus:outline-none focus:ring-4 transition-all text-neutral-900 placeholder-neutral-400 pr-10`}
                      disabled={isSubmitting}
                      autoFocus
                    />
                    {url && (
                      <button
                        type="button"
                        onClick={() => { setUrl(''); setUrlError(null); }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 p-1"
                        aria-label="Clear input"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  {urlError && (
                    <div className="mt-2.5 flex items-start gap-2 text-xs text-red-600">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{urlError}</span>
                    </div>
                  )}
                </div>

                {/* 5. Black primary button: "Convert to MP3" */}
                <button
                  type="submit"
                  disabled={isSubmitting || !url.trim()}
                  className="w-full py-3.5 sm:py-4 px-6 bg-black text-white hover:bg-neutral-800 disabled:bg-neutral-300 disabled:cursor-not-allowed font-medium text-sm sm:text-base rounded-xl transition-colors flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Starting conversion...</span>
                    </>
                  ) : (
                    <>
                      <span>Convert to MP3</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>
            )}

            {/* Tab B: Upload File Alternative (Direct media file to MP3) */}
            {activeTab === 'upload' && (
              <div className="space-y-4">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*,video/*,.mp4,.webm,.mkv,.mov,.m4a,.wav,.aac,.ogg,.flac"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setSelectedFile(file);
                      handleFileUpload(file);
                    }
                  }}
                />

                <div
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    const file = e.dataTransfer.files?.[0];
                    if (file) {
                      setSelectedFile(file);
                      handleFileUpload(file);
                    }
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed ${
                    isDragging ? 'border-black bg-neutral-50' : 'border-neutral-200 hover:border-neutral-400 bg-neutral-50/50'
                  } rounded-xl p-6 sm:p-8 text-center cursor-pointer transition-colors`}
                >
                  <div className="w-10 h-10 rounded-full bg-neutral-200/80 text-neutral-700 mx-auto flex items-center justify-center mb-3">
                    <Upload className="w-5 h-5" />
                  </div>
                  <p className="text-sm font-medium text-neutral-800">
                    Click to select audio or video file
                  </p>
                  <p className="text-xs text-neutral-500 mt-1">
                    Drag and drop MP4, WebM, M4A, WAV, MOV, AAC, MKV (up to 50MB)
                  </p>
                </div>

                {urlError && (
                  <div className="flex items-start gap-2 text-xs text-red-600">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{urlError}</span>
                  </div>
                )}
              </div>
            )}

            {/* Instant Sample Test Affordance */}
            <div className="mt-6 pt-5 border-t border-neutral-100 flex flex-wrap items-center justify-center gap-2 text-xs text-neutral-500">
              <span>Want to test immediately?</span>
              <button
                type="button"
                onClick={() => handleSampleConvert('audio')}
                className="text-black font-semibold underline underline-offset-2 hover:text-neutral-700"
              >
                Try sample audio clip (10s)
              </button>
              <span>·</span>
              <button
                type="button"
                onClick={() => handleSampleConvert('video')}
                className="text-black font-semibold underline underline-offset-2 hover:text-neutral-700"
              >
                Try sample video (6s)
              </button>
            </div>
          </div>
        )}

        {/* State 2: CONVERTING / REAL PROGRESS STATE */}
        {currentJob && (currentJob.status === 'extracting' || currentJob.status === 'converting') && (
          <div className="space-y-6 py-2">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-neutral-100 border border-neutral-200 flex items-center justify-center shrink-0">
                <FileAudio className="w-6 h-6 text-neutral-700" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold text-neutral-900 truncate">
                  {currentJob.title}
                </h3>
                <p className="text-xs text-neutral-500 mt-0.5">
                  {currentJob.author || 'Converting audio stream to MP3...'}
                </p>
              </div>
            </div>

            {/* Real Progress Bar */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-neutral-600 font-medium truncate pr-2">
                  {currentJob.stage}
                </span>
                <span className="font-mono font-semibold text-black tabular-nums">
                  {currentJob.progress}%
                </span>
              </div>
              <div className="w-full h-2.5 bg-neutral-100 rounded-full overflow-hidden border border-neutral-200/60">
                <div
                  className="h-full bg-black transition-all duration-300 ease-out"
                  style={{ width: `${Math.min(100, Math.max(5, currentJob.progress))}%` }}
                />
              </div>
            </div>

            <div className="flex items-center justify-center">
              <button
                type="button"
                onClick={handleReset}
                className="text-xs text-neutral-500 hover:text-neutral-800 transition-colors py-1 px-3"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* State 3: COMPLETED STATE */}
        {currentJob && isCompleted && currentJob.status === 'completed' && (
          <div className="space-y-6 py-1">
            {/* Success Header */}
            <div className="flex items-center gap-2 text-emerald-600 text-xs font-semibold uppercase tracking-wider">
              <CheckCircle2 className="w-4 h-4" />
              <span>Conversion Ready</span>
            </div>

            {/* Track Info Card */}
            <div className="bg-neutral-50 border border-neutral-200/80 rounded-xl p-4 flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-bold text-neutral-900 truncate" title={currentJob.title}>
                  {currentJob.title}
                </h3>
                <div className="flex items-center gap-2 text-xs text-neutral-500 mt-1 font-mono tabular-nums">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-neutral-400" />
                    {currentJob.durationFormatted || '00:00'}
                  </span>
                  <span>·</span>
                  <span>MP3 192 kbps</span>
                  {currentJob.fileSizeBytes ? (
                    <>
                      <span>·</span>
                      <span className="flex items-center gap-1">
                        <HardDrive className="w-3.5 h-3.5 text-neutral-400" />
                        {formatFileSize(currentJob.fileSizeBytes)}
                      </span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Audio Preview Player */}
            <AudioPreviewPlayer
              src={`/api/download/${currentJob.id}?preview=true`}
              duration={currentJob.duration}
              title={currentJob.title}
            />

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
              <a
                href={`/api/download/${currentJob.id}`}
                download={currentJob.outputFilename || 'audio.mp3'}
                className="w-full sm:flex-1 py-3.5 px-6 bg-black text-white hover:bg-neutral-800 font-medium text-sm sm:text-base rounded-xl transition-colors flex items-center justify-center gap-2 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
              >
                <Download className="w-4 h-4" />
                <span>Download MP3</span>
              </a>

              <button
                type="button"
                onClick={handleReset}
                className="w-full sm:w-auto py-3.5 px-5 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 font-medium text-sm rounded-xl transition-colors flex items-center justify-center gap-2 focus:outline-none"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Convert Another</span>
              </button>
            </div>
          </div>
        )}

        {/* State 4: ERROR / BOT RESTRICTION FALLBACK STATE */}
        {currentJob && currentJob.status === 'error' && (
          <div className="space-y-5 py-2">
            <div className="flex items-start gap-3 p-4 bg-red-50/70 border border-red-200 rounded-xl text-red-800">
              <AlertCircle className="w-5 h-5 shrink-0 text-red-600 mt-0.5" />
              <div className="text-xs sm:text-sm">
                <p className="font-semibold text-red-900">
                  {currentJob.errorCode === 'BOT_RESTRICTION'
                    ? 'YouTube Cloud Bot Restriction'
                    : 'Conversion Failed'}
                </p>
                <p className="mt-1 text-red-700 leading-relaxed">
                  {currentJob.error || 'An unexpected error occurred during audio processing.'}
                </p>
              </div>
            </div>

            {/* Direct fallback to file upload if YouTube bot protection intervened */}
            {currentJob.errorCode === 'BOT_RESTRICTION' && (
              <div className="p-4 bg-neutral-50 border border-neutral-200 rounded-xl space-y-3">
                <p className="text-xs font-medium text-neutral-800">
                  Recommended Alternative:
                </p>
                <p className="text-xs text-neutral-600">
                  Upload your downloaded or authorized media file (MP4, WebM, M4A, etc.) to convert directly to 192kbps MP3 via our fast FFmpeg engine.
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      handleReset();
                      setActiveTab('upload');
                    }}
                    className="py-2 px-3.5 bg-black text-white hover:bg-neutral-800 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload Local File</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSampleConvert('audio')}
                    className="py-2 px-3.5 bg-neutral-200 hover:bg-neutral-300 text-neutral-900 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Test With Sample Audio</span>
                  </button>
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={handleReset}
                className="py-2.5 px-4 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Try Again</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Quiet Legal & Compliance Notice */}
      <div className="text-center mt-6 text-xs text-neutral-400">
        <p>
          Only download content you own or have explicit rights to convert. Powered by FFmpeg.
        </p>
      </div>
    </div>
  );
}
