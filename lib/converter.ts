import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

export interface JobState {
  id: string;
  sourceType: 'youtube' | 'upload' | 'sample' | 'direct_url';
  status: 'pending' | 'extracting' | 'converting' | 'completed' | 'error';
  progress: number; // 0 to 100
  stage: string;
  title: string;
  author?: string;
  artist?: string;
  duration: number; // in seconds
  durationFormatted: string;
  thumbnailUrl?: string;
  outputFilename: string;
  outputFilePath?: string;
  fileSizeBytes?: number;
  error?: string;
  errorCode?: 'BOT_RESTRICTION' | 'INVALID_URL' | 'CONVERSION_FAILED' | 'FILE_TOO_LARGE' | 'UNKNOWN';
  createdAt: number;
}

const TEMP_BASE_DIR = '/tmp/mp3-downloader';
const INPUTS_DIR = path.join(TEMP_BASE_DIR, 'inputs');
const OUTPUTS_DIR = path.join(TEMP_BASE_DIR, 'outputs');

// Ensure directories exist
export function ensureDirs() {
  if (!fs.existsSync(TEMP_BASE_DIR)) fs.mkdirSync(TEMP_BASE_DIR, { recursive: true });
  if (!fs.existsSync(INPUTS_DIR)) fs.mkdirSync(INPUTS_DIR, { recursive: true });
  if (!fs.existsSync(OUTPUTS_DIR)) fs.mkdirSync(OUTPUTS_DIR, { recursive: true });
}

// Global job store to survive hot reloads
const globalForJobs = globalThis as unknown as {
  _mp3JobsStore?: Map<string, JobState>;
  _mp3CleanupInterval?: NodeJS.Timeout;
};

if (!globalForJobs._mp3JobsStore) {
  globalForJobs._mp3JobsStore = new Map<string, JobState>();
}
export const jobsStore = globalForJobs._mp3JobsStore;

// Automatic temporary file cleanup (deletes files older than 15 minutes)
if (!globalForJobs._mp3CleanupInterval) {
  globalForJobs._mp3CleanupInterval = setInterval(() => {
    try {
      ensureDirs();
      const now = Date.now();
      const maxAgeMs = 15 * 60 * 1000;

      // Check outputs
      const outputFiles = fs.readdirSync(OUTPUTS_DIR);
      for (const file of outputFiles) {
        const fullPath = path.join(OUTPUTS_DIR, file);
        try {
          const stats = fs.statSync(fullPath);
          if (now - stats.mtimeMs > maxAgeMs) {
            fs.unlinkSync(fullPath);
          }
        } catch {
          // Ignore
        }
      }

      // Check inputs
      const inputFiles = fs.readdirSync(INPUTS_DIR);
      for (const file of inputFiles) {
        const fullPath = path.join(INPUTS_DIR, file);
        try {
          const stats = fs.statSync(fullPath);
          if (now - stats.mtimeMs > maxAgeMs) {
            fs.unlinkSync(fullPath);
          }
        } catch {
          // Ignore
        }
      }

      // Prune old jobs
      for (const [id, job] of jobsStore.entries()) {
        if (now - job.createdAt > maxAgeMs) {
          jobsStore.delete(id);
        }
      }
    } catch (e) {
      console.error('Cleanup error:', e);
    }
  }, 5 * 60 * 1000);
}

import { formatDuration } from '@/lib/format';
export { formatDuration };

export function parseYouTubeUrl(url: string): { isValid: boolean; videoId?: string; cleanUrl?: string } {
  try {
    const trimmed = url.trim();
    // YouTube formats:
    // https://www.youtube.com/watch?v=VIDEO_ID
    // https://youtu.be/VIDEO_ID
    // https://www.youtube.com/shorts/VIDEO_ID
    // https://www.youtube.com/embed/VIDEO_ID
    // https://music.youtube.com/watch?v=VIDEO_ID
    const ytRegex = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|v\/)|youtu\.be\/|music\.youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/;
    const match = trimmed.match(ytRegex);

    if (match && match[1]) {
      return {
        isValid: true,
        videoId: match[1],
        cleanUrl: `https://www.youtube.com/watch?v=${match[1]}`,
      };
    }
    return { isValid: false };
  } catch {
    return { isValid: false };
  }
}

// Probes audio/video media file using ffprobe
export async function probeMedia(filePath: string): Promise<{ duration: number; title?: string; artist?: string }> {
  return new Promise((resolve) => {
    const ffprobe = spawn('/usr/bin/ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration:format_tags=title,artist',
      '-of', 'json',
      filePath,
    ]);

    let stdout = '';
    ffprobe.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    ffprobe.on('close', (code) => {
      if (code === 0 && stdout) {
        try {
          const parsed = JSON.parse(stdout);
          const duration = parseFloat(parsed.format?.duration || '0');
          const title = parsed.format?.tags?.title || undefined;
          const artist = parsed.format?.tags?.artist || undefined;
          resolve({ duration, title, artist });
          return;
        } catch {
          // fallback
        }
      }
      resolve({ duration: 0 });
    });

    ffprobe.on('error', () => {
      resolve({ duration: 0 });
    });
  });
}

// Convert media file to MP3 with real-time FFmpeg progress
export async function convertToMp3WithFFmpeg(
  jobId: string,
  inputPath: string,
  cleanTitle: string,
  targetDuration: number,
  deleteInputAfter = true
): Promise<void> {
  ensureDirs();
  const job = jobsStore.get(jobId);
  if (!job) return;

  const safeFilename = `${cleanTitle.replace(/[/\\?%*:|"<>]/g, '_').trim() || 'audio'}.mp3`;
  const outputPath = path.join(OUTPUTS_DIR, `${jobId}.mp3`);

  job.status = 'converting';
  job.stage = 'Initializing FFmpeg audio encoder...';
  job.progress = 5;

  let totalDuration = targetDuration;
  if (!totalDuration || totalDuration <= 0) {
    const probed = await probeMedia(inputPath);
    if (probed.duration > 0) {
      totalDuration = probed.duration;
      job.duration = totalDuration;
      job.durationFormatted = formatDuration(totalDuration);
    }
  }

  return new Promise((resolve, reject) => {
    // FFmpeg conversion command:
    // -i input -vn (strip video) -c:a libmp3lame -b:a 192k -ar 44100 -ac 2 -id3v2_version 3
    const ffmpegArgs = [
      '-i', inputPath,
      '-vn',
      '-c:a', 'libmp3lame',
      '-b:a', '192k',
      '-ar', '44100',
      '-id3v2_version', '3',
      '-metadata', `title=${cleanTitle}`,
      '-metadata', 'artist=MP3 Downloader',
      '-y',
      outputPath,
    ];

    const ffmpeg = spawn('/usr/bin/ffmpeg', ffmpegArgs);

    ffmpeg.stderr.on('data', (data) => {
      const text = data.toString();
      // Match "time=00:01:23.45"
      const timeMatch = text.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
      if (timeMatch) {
        const hours = parseInt(timeMatch[1], 10);
        const mins = parseInt(timeMatch[2], 10);
        const secs = parseInt(timeMatch[3], 10);
        const frac = parseInt(timeMatch[4], 10) / 100;
        const currentSecs = hours * 3600 + mins * 60 + secs + frac;

        if (totalDuration > 0) {
          const calculated = Math.min(98, Math.round((currentSecs / totalDuration) * 90) + 8);
          job.progress = calculated;
          job.stage = `Encoding MP3 with FFmpeg (${calculated}% · ${formatDuration(currentSecs)} / ${job.durationFormatted})`;
        } else {
          // If total duration unknown, increment smoothly up to 90%
          job.progress = Math.min(90, (job.progress || 10) + 10);
          job.stage = `Encoding audio: ${formatDuration(currentSecs)} processed`;
        }
      }
    });

    ffmpeg.on('close', (code) => {
      if (deleteInputAfter && fs.existsSync(inputPath)) {
        try {
          fs.unlinkSync(inputPath);
        } catch {
          // Ignore
        }
      }

      if (code === 0 && fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath);
        job.status = 'completed';
        job.progress = 100;
        job.stage = 'Conversion complete';
        job.outputFilename = safeFilename;
        job.outputFilePath = outputPath;
        job.fileSizeBytes = stats.size;
        resolve();
      } else {
        job.status = 'error';
        job.errorCode = 'CONVERSION_FAILED';
        job.error = `FFmpeg conversion failed (exit code ${code}). The source format may be unsupported.`;
        reject(new Error(job.error));
      }
    });

    ffmpeg.on('error', (err) => {
      if (deleteInputAfter && fs.existsSync(inputPath)) {
        try { fs.unlinkSync(inputPath); } catch { /* ignore */ }
      }
      job.status = 'error';
      job.errorCode = 'CONVERSION_FAILED';
      job.error = `FFmpeg error: ${err.message}`;
      reject(err);
    });
  });
}

// Fetch YouTube oEmbed metadata
export async function fetchYouTubeOEmbed(url: string): Promise<{ title: string; author: string; thumbnailUrl: string } | null> {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const res = await fetch(oembedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MP3Downloader/1.0)',
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      title: data.title || 'YouTube Audio',
      author: data.author_name || 'YouTube Creator',
      thumbnailUrl: data.thumbnail_url || '',
    };
  } catch {
    return null;
  }
}

export { INPUTS_DIR, OUTPUTS_DIR };
