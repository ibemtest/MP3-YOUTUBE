import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import {
  jobsStore,
  JobState,
  parseYouTubeUrl,
  fetchYouTubeOEmbed,
  convertToMp3WithFFmpeg,
  formatDuration,
  probeMedia,
  ensureDirs,
  INPUTS_DIR,
} from '@/lib/converter';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    ensureDirs();
    const contentType = req.headers.get('content-type') || '';

    // Handle Multipart Form Upload (Local File)
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;

      if (!file) {
        return NextResponse.json({ error: 'No media file provided.' }, { status: 400 });
      }

      // Check max size: 50MB
      if (file.size > 50 * 1024 * 1024) {
        return NextResponse.json({ error: 'File size exceeds 50MB limit.' }, { status: 400 });
      }

      const jobId = crypto.randomUUID();
      const originalName = file.name || 'uploaded_media';
      const cleanTitle = path.parse(originalName).name || 'Audio Track';
      const ext = path.extname(originalName) || '.tmp';
      const inputPath = path.join(INPUTS_DIR, `${jobId}${ext}`);

      // Save uploaded file to disk
      const buffer = Buffer.from(await file.arrayBuffer());
      fs.writeFileSync(inputPath, buffer);

      // Probe duration
      const probed = await probeMedia(inputPath);
      const duration = probed.duration || 0;

      const job: JobState = {
        id: jobId,
        sourceType: 'upload',
        status: 'converting',
        progress: 8,
        stage: 'Uploaded successfully. Analyzing audio stream...',
        title: probed.title || cleanTitle,
        artist: probed.artist || 'Local Upload',
        duration,
        durationFormatted: formatDuration(duration),
        outputFilename: `${cleanTitle}.mp3`,
        createdAt: Date.now(),
      };
      jobsStore.set(jobId, job);

      // Trigger FFmpeg in background
      convertToMp3WithFFmpeg(jobId, inputPath, job.title, duration, true).catch((err) => {
        console.error('FFmpeg upload conversion error:', err);
      });

      return NextResponse.json({
        taskId: jobId,
        status: 'converting',
        title: job.title,
        duration: job.duration,
        durationFormatted: job.durationFormatted,
      });
    }

    // Handle JSON payload (YouTube URL or Sample)
    const body = await req.json().catch(() => ({}));
    const { url, sampleId } = body;

    // Handle Sample conversion request
    if (sampleId) {
      const jobId = crypto.randomUUID();
      let sampleSource = path.join(process.cwd(), 'public/samples/sample-audio.m4a');
      let sampleTitle = 'Acoustic Harmony Demo';

      if (sampleId === 'video') {
        sampleSource = path.join(process.cwd(), 'public/samples/sample-video.mp4');
        sampleTitle = 'Demo Video Soundtrack';
      }

      if (!fs.existsSync(sampleSource)) {
        return NextResponse.json({ error: 'Sample audio file not found on server.' }, { status: 404 });
      }

      const inputPath = path.join(INPUTS_DIR, `${jobId}_sample.m4a`);
      fs.copyFileSync(sampleSource, inputPath);

      const probed = await probeMedia(inputPath);
      const duration = probed.duration || 10;

      const job: JobState = {
        id: jobId,
        sourceType: 'sample',
        status: 'converting',
        progress: 10,
        stage: 'Processing authorized sample file...',
        title: sampleTitle,
        artist: 'Authorized Audio Sample',
        duration,
        durationFormatted: formatDuration(duration),
        outputFilename: `${sampleTitle}.mp3`,
        createdAt: Date.now(),
      };
      jobsStore.set(jobId, job);

      // Trigger FFmpeg in background (don't delete original public sample)
      convertToMp3WithFFmpeg(jobId, inputPath, sampleTitle, duration, true).catch((err) => {
        console.error('FFmpeg sample conversion error:', err);
      });

      return NextResponse.json({
        taskId: jobId,
        status: 'converting',
        title: sampleTitle,
        duration,
        durationFormatted: formatDuration(duration),
      });
    }

    // Handle YouTube URL
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'Please enter a valid YouTube URL.' }, { status: 400 });
    }

    const parsed = parseYouTubeUrl(url);
    if (!parsed.isValid) {
      return NextResponse.json({
        error: 'Invalid YouTube URL. Please enter a valid youtube.com or youtu.be link (e.g., https://www.youtube.com/watch?v=...).',
      }, { status: 400 });
    }

    const jobId = crypto.randomUUID();

    // 1. Fetch official YouTube oEmbed metadata for accurate title & thumbnail
    const oembed = await fetchYouTubeOEmbed(parsed.cleanUrl || url);
    const videoTitle = oembed?.title || `YouTube Audio (${parsed.videoId})`;
    const author = oembed?.author || 'YouTube Creator';
    const thumbnailUrl = oembed?.thumbnailUrl || (parsed.videoId ? `https://i.ytimg.com/vi/${parsed.videoId}/hqdefault.jpg` : '');

    const job: JobState = {
      id: jobId,
      sourceType: 'youtube',
      status: 'extracting',
      progress: 12,
      stage: 'Connecting to media source & analyzing stream...',
      title: videoTitle,
      author,
      thumbnailUrl,
      duration: 0,
      durationFormatted: '--:--',
      outputFilename: `${videoTitle.replace(/[/\\?%*:|"<>]/g, '_')}.mp3`,
      createdAt: Date.now(),
    };
    jobsStore.set(jobId, job);

    // Run extraction & FFmpeg conversion asynchronously
    runYouTubeExtractionPipeline(jobId, parsed.cleanUrl || url, videoTitle).catch((err) => {
      console.error('YouTube extraction pipeline error:', err);
    });

    return NextResponse.json({
      taskId: jobId,
      status: 'extracting',
      title: videoTitle,
      author,
      thumbnailUrl,
    });
  } catch (error: any) {
    console.error('POST /api/convert error:', error);
    return NextResponse.json({ error: error.message || 'Internal conversion error.' }, { status: 500 });
  }
}

async function runYouTubeExtractionPipeline(jobId: string, url: string, initialTitle: string) {
  const job = jobsStore.get(jobId);
  if (!job) return;

  const ytDlpPath = path.join(process.cwd(), 'bin/yt-dlp');
  const tempInputTemplate = path.join(INPUTS_DIR, `${jobId}.%(ext)s`);

  // Attempt yt-dlp audio download
  // If cloud IP is blocked by YouTube bot challenge, yt-dlp returns non-zero with "Sign in to confirm you're not a bot"
  job.stage = 'Extracting audio stream from source...';
  job.progress = 25;

  const ytdlProcess = spawn(ytDlpPath, [
    '--no-playlist',
    '--extract-audio',
    '--audio-format', 'mp3',
    '--audio-quality', '192K',
    '--ffmpeg-location', '/usr/bin/ffmpeg',
    '-o', tempInputTemplate,
    '--no-warnings',
    url,
  ]);

  let stderrOutput = '';
  ytdlProcess.stderr.on('data', (d) => {
    stderrOutput += d.toString();
  });

  ytdlProcess.stdout.on('data', (d) => {
    const text = d.toString();
    if (text.includes('[download]')) {
      const match = text.match(/\[download\]\s+([\d.]+)%/);
      if (match && match[1]) {
        const dlPercent = parseFloat(match[1]);
        job.progress = Math.min(85, Math.round(25 + (dlPercent * 0.6)));
        job.stage = `Downloading audio stream (${Math.round(dlPercent)}%)...`;
      }
    } else if (text.includes('[ExtractAudio]') || text.includes('ffmpeg')) {
      job.progress = 90;
      job.stage = 'Converting audio to MP3 with FFmpeg...';
    }
  });

  ytdlProcess.on('close', async (code) => {
    const expectedMp3 = path.join(INPUTS_DIR, `${jobId}.mp3`);

    if (code === 0 && fs.existsSync(expectedMp3)) {
      // Direct extraction succeeded! Now move to outputs and probe final stats
      const finalOutputPath = path.join(process.cwd(), '..', '..', 'tmp/mp3-downloader/outputs', `${jobId}.mp3`);
      const outputsDir = path.dirname(finalOutputPath);
      if (!fs.existsSync(outputsDir)) fs.mkdirSync(outputsDir, { recursive: true });

      fs.renameSync(expectedMp3, finalOutputPath);

      const probed = await probeMedia(finalOutputPath);
      const stats = fs.statSync(finalOutputPath);

      job.status = 'completed';
      job.progress = 100;
      job.stage = 'Conversion complete';
      job.duration = probed.duration || 0;
      job.durationFormatted = formatDuration(job.duration);
      job.outputFilePath = finalOutputPath;
      job.fileSizeBytes = stats.size;
    } else {
      // Check if YouTube blocked due to bot protection / datacenter IP check
      const isBotBlocked =
        stderrOutput.includes('Sign in to confirm you’re not a bot') ||
        stderrOutput.includes('bot verification') ||
        stderrOutput.includes('HTTP Error 429') ||
        stderrOutput.includes('403: Forbidden');

      job.status = 'error';
      if (isBotBlocked) {
        job.errorCode = 'BOT_RESTRICTION';
        job.error =
          'YouTube cloud IP restriction: YouTube requires bot verification for cloud extraction. You can convert any saved video/audio file directly via our FFmpeg engine below, or test with our sample track.';
      } else {
        job.errorCode = 'CONVERSION_FAILED';
        job.error =
          stderrOutput.slice(-300).trim() ||
          'Could not extract audio from this URL. The video may be private, age-restricted, or region-locked.';
      }
    }
  });

  ytdlProcess.on('error', (err) => {
    job.status = 'error';
    job.errorCode = 'CONVERSION_FAILED';
    job.error = `Extraction service error: ${err.message}`;
  });
}
