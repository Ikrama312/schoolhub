import { Readable } from 'node:stream';
import { ok, withHandler } from '@/server/http';
import { getCurrentUser, requireUser } from '@/server/auth/requireRole';
import { deleteUnattachedFile, getFileForDownload } from '@/server/files/files-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: { id: string } };

/**
 * GET /api/files/:id (FR-8, FR-9, FR-41). Anonymous callers reach this (D1);
 * canAccessFile decides, and a denial is 404 before any bytes are read.
 */
export const GET = withHandler(async (request: Request, { params }: Ctx) => {
  const user = await getCurrentUser();
  const { file, stream } = await getFileForDownload(user, params.id);

  const wantInline = new URL(request.url).searchParams.get('inline') === '1';
  const inlineOk = file.mimeType.startsWith('image/') || file.mimeType === 'application/pdf';
  const disposition = wantInline && inlineOk ? 'inline' : 'attachment';

  const headers = new Headers({
    'Content-Type': file.mimeType,
    'Content-Length': String(file.sizeBytes),
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
    'Cache-Control': file.context === 'logo' ? 'public, max-age=3600' : 'private, no-store',
  });
  if (file.mimeType === 'image/svg+xml') {
    headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  }
  return new Response(Readable.toWeb(stream) as ReadableStream, { status: 200, headers });
});

/** DELETE /api/files/:id: owner or ADMIN, only while unattached (FR-11). */
export const DELETE = withHandler(async (request: Request, { params }: Ctx) => {
  const user = await requireUser();
  await deleteUnattachedFile(user, params.id, request);
  return ok({ id: params.id });
});
