import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { jobsStore, OUTPUTS_DIR } from '@/lib/converter';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    if (!id) {
      return new NextResponse('Job ID is required', { status: 400 });
    }

    const job = jobsStore.get(id);
    const filePath = job?.outputFilePath || path.join(OUTPUTS_DIR, `${id}.mp3`);

    if (!fs.existsSync(filePath)) {
      return new NextResponse('Converted audio file not found or expired', { status: 404 });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const isPreview = req.nextUrl.searchParams.get('preview') === 'true';
    const filename = job?.outputFilename || `${id}.mp3`;
    const encodedFilename = encodeURIComponent(filename);

    const range = req.headers.get('range');

    if (range) {
      // Partial content streaming for audio scrub/player
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = end - start + 1;

      const fileStream = fs.createReadStream(filePath, { start, end });
      const webStream = new ReadableStream({
        start(controller) {
          fileStream.on('data', (chunk) => controller.enqueue(chunk));
          fileStream.on('end', () => controller.close());
          fileStream.on('error', (err) => controller.error(err));
        },
      });

      return new NextResponse(webStream, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize.toString(),
          'Content-Type': 'audio/mpeg',
        },
      });
    }

    // Full file streaming
    const fileStream = fs.createReadStream(filePath);
    const webStream = new ReadableStream({
      start(controller) {
        fileStream.on('data', (chunk) => controller.enqueue(chunk));
        fileStream.on('end', () => controller.close());
        fileStream.on('error', (err) => controller.error(err));
      },
    });

    const headers: Record<string, string> = {
      'Content-Type': 'audio/mpeg',
      'Content-Length': fileSize.toString(),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
    };

    if (!isPreview) {
      // Set attachment for actual file downloads
      headers['Content-Disposition'] = `attachment; filename="${filename.replace(/"/g, '')}"; filename*=UTF-8''${encodedFilename}`;
    } else {
      headers['Content-Disposition'] = `inline; filename="${filename.replace(/"/g, '')}"`;
    }

    return new NextResponse(webStream, {
      status: 200,
      headers,
    });
  } catch (error: any) {
    console.error('Download route error:', error);
    return new NextResponse('Internal server error streaming audio', { status: 500 });
  }
}
