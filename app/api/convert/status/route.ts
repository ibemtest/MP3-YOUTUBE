import { NextRequest, NextResponse } from 'next/server';
import { jobsStore } from '@/lib/converter';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'Missing job ID.' }, { status: 400 });
  }

  const job = jobsStore.get(id);
  if (!job) {
    return NextResponse.json({ error: 'Conversion task not found or expired.' }, { status: 404 });
  }

  return NextResponse.json({
    id: job.id,
    sourceType: job.sourceType,
    status: job.status,
    progress: job.progress,
    stage: job.stage,
    title: job.title,
    author: job.author,
    duration: job.duration,
    durationFormatted: job.durationFormatted,
    thumbnailUrl: job.thumbnailUrl,
    outputFilename: job.outputFilename,
    fileSizeBytes: job.fileSizeBytes,
    error: job.error,
    errorCode: job.errorCode,
  });
}
