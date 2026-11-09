import { Readable } from 'node:stream';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';
import type { FileObject, Prisma } from '@prisma/client';
// @ts-expect-error -- ponytail: busboy ships without types and comes transitively via next (ADR-2); add @types/busboy if it becomes a direct dep.
import busboy from 'busboy';
import { fileTypeFromBuffer } from 'file-type';
import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import { audit } from '@/server/audit';
import { rateLimit } from '@/server/rate-limit';
import { env } from '@/lib/env';
import { deleteFile, readFile, saveFile } from '@/server/storage';
import { canAccessFile, type FileAccessUser } from './access';
import { checkType, extOf, maxBytesFor, sanitizeFilename } from './validate';

/**
 * File business logic (PRD-08 FR-3, FR-8, FR-11, FR-17, FR-46, NFR-3, NFR-5).
 * Route handlers in src/app/api/files stay thin.
 */

const HEAD_BYTES = 4100;
const MULTIPART_SLACK = 64 * 1024;
const CONTEXT_RE = /^[a-z][a-z0-9_-]{0,39}$/;
const UPLOADS_PER_HOUR = 60;

export interface FileSummary {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

export const toSummary = (f: Pick<FileObject, 'id' | 'originalName' | 'mimeType' | 'sizeBytes'>): FileSummary => ({
  id: f.id,
  originalName: f.originalName,
  mimeType: f.mimeType,
  sizeBytes: f.sizeBytes,
});

function maxUploadMb(): number {
  const fromProcess = Number(process.env.MAX_UPLOAD_MB);
  return Number.isInteger(fromProcess) && fromProcess > 0 ? fromProcess : env.MAX_UPLOAD_MB;
}

/** Lets busboy reach 'close' after we stop reading a part (the async iterator's 'readable' listener blocks resume()). */
function drain(stream: Readable): void {
  stream.removeAllListeners('readable');
  stream.resume();
}

const tooBig = (maxBytes: number) =>
  new AppError('VALIDATION_ERROR', `File exceeds ${Math.round(maxBytes / (1024 * 1024))} MB.`);

/** Streams one file part to disk: sniff the head, then hash+count while writing (NFR-5). */
async function storePart(
  user: FileAccessUser,
  context: string,
  filename: string,
  stream: Readable & { truncated?: boolean },
  maxBytes: number,
): Promise<FileSummary> {
  const originalName = sanitizeFilename(filename);
  const ext = extOf(originalName);

  // Peek the first HEAD_BYTES without buffering the rest.
  const iterator = stream[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
  const headChunks: Buffer[] = [];
  let headLength = 0;
  let done = false;
  while (headLength < HEAD_BYTES) {
    const next = await iterator.next();
    if (next.done) {
      done = true;
      break;
    }
    headChunks.push(next.value);
    headLength += next.value.length;
  }
  const head = Buffer.concat(headChunks);
  const sniffed = head.length ? (await fileTypeFromBuffer(head))?.mime : undefined;
  const check = checkType(ext, sniffed, context, head);
  if (!check.ok) {
    drain(stream);
    throw new AppError('VALIDATION_ERROR', check.error);
  }
  if (head.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'File is empty.');
  }

  async function* body() {
    let total = head.length;
    if (total > maxBytes) throw tooBig(maxBytes);
    yield head;
    if (!done) {
      for (let next = await iterator.next(); !next.done; next = await iterator.next()) {
        total += next.value.length;
        // Per-context cap (logo 2 MB) is enforced here mid-stream; saveFile unlinks the tmp file.
        if (total > maxBytes) throw tooBig(maxBytes);
        yield next.value;
      }
    }
    // busboy stops emitting at limits.fileSize and marks the stream truncated.
    if (stream.truncated) throw tooBig(maxBytes);
  }

  const saved = await saveFile(Readable.from(body()), { ext });
  const row = await prisma.fileObject.create({
    data: {
      ownerId: user.id,
      originalName,
      mimeType: check.mime,
      sizeBytes: saved.sizeBytes,
      storageKey: saved.storageKey,
      sha256: saved.sha256,
      context,
      contextId: null,
    },
  });
  return toSummary(row);
}

/** POST /api/files: multipart with a `context` field BEFORE the `file` part (ADR-2). */
export async function uploadFile(user: FileAccessUser, request: Request): Promise<FileSummary> {
  const limit = rateLimit(`upload:${user.id}`, UPLOADS_PER_HOUR, 3_600_000);
  if (!limit.ok) {
    throw new AppError('RATE_LIMITED', 'Too many uploads. Try again later.', {
      retryAfterSeconds: Math.ceil(limit.retryAfterMs / 1000),
    });
  }

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.startsWith('multipart/form-data') || !request.body) {
    throw new AppError('VALIDATION_ERROR', 'Expected multipart/form-data.');
  }
  const globalMax = maxBytesFor('lesson', maxUploadMb());
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > globalMax + MULTIPART_SLACK) throw tooBig(globalMax);

  return new Promise<FileSummary>((resolve, reject) => {
    let context: string | null = null;
    let work: Promise<FileSummary> | null = null;
    let parser: ReturnType<typeof busboy>;
    try {
      parser = busboy({
        headers: { 'content-type': contentType },
        limits: { files: 1, fields: 5, fileSize: globalMax },
      });
    } catch {
      reject(new AppError('VALIDATION_ERROR', 'Malformed multipart body.'));
      return;
    }

    parser.on('field', (name: string, value: string) => {
      if (name === 'context') context = value;
    });

    parser.on('file', (_name: string, stream: Readable & { truncated?: boolean }, info: { filename?: string }) => {
      if (work) {
        drain(stream);
        return;
      }
      if (!context || !CONTEXT_RE.test(context)) {
        drain(stream);
        work = Promise.reject(new AppError('VALIDATION_ERROR', 'A valid context field must precede the file.'));
        work.catch(() => undefined);
        return;
      }
      work = storePart(user, context, info.filename ?? 'file', stream, maxBytesFor(context, maxUploadMb()));
      // On failure keep draining so busboy reaches 'close' and the promise settles.
      work.catch(() => drain(stream));
    });

    parser.on('error', () => reject(new AppError('VALIDATION_ERROR', 'Malformed multipart body.')));
    parser.on('close', () => {
      if (!work) reject(new AppError('VALIDATION_ERROR', 'No file was uploaded.'));
      else work.then(resolve, reject);
    });

    Readable.fromWeb(request.body as unknown as NodeWebReadableStream).on('error', reject).pipe(parser);
  });
}

/** Loads the row and runs the registry; denial is NOT_FOUND before any bytes are read (FR-9, NFR-1). */
export async function getFileForDownload(user: FileAccessUser | null, id: string) {
  const file = await prisma.fileObject.findUnique({ where: { id } });
  if (!file || !(await canAccessFile(user, file))) throw new AppError('NOT_FOUND', 'File not found');
  return { file, stream: readFile(file.storageKey) };
}

/** FR-11: owner or ADMIN, only while unattached. Row first, then bytes. */
export async function deleteUnattachedFile(user: FileAccessUser, id: string, request?: Request): Promise<void> {
  const file = await prisma.fileObject.findUnique({ where: { id } });
  if (!file || (user.role !== 'ADMIN' && file.ownerId !== user.id)) throw new AppError('NOT_FOUND', 'File not found');
  if (file.contextId !== null) throw new AppError('CONFLICT', 'File is attached and cannot be deleted.');
  await prisma.fileObject.delete({ where: { id } });
  await deleteFile(file.storageKey);
  if (file.ownerId !== user.id) {
    await audit({
      actorId: user.id,
      action: 'file.delete',
      entityType: 'FileObject',
      entityId: id,
      metadata: { ownerId: file.ownerId, originalName: file.originalName },
      request,
    });
  }
}

type Tx = Prisma.TransactionClient;

/**
 * FR-17: attach files to (context, contextId). Each must be the caller's
 * (any for ADMIN) and either unattached or already on this same record.
 */
export async function attachFiles(
  tx: Tx,
  user: FileAccessUser,
  fileIds: string[],
  context: string,
  contextId: string,
): Promise<void> {
  const ids = [...new Set(fileIds)];
  if (ids.length === 0) return;
  const files = await tx.fileObject.findMany({
    where: { id: { in: ids } },
    select: { id: true, ownerId: true, context: true, contextId: true },
  });
  const eligible = files.filter(
    (f) =>
      (user.role === 'ADMIN' || f.ownerId === user.id) &&
      (f.contextId === null || (f.contextId === contextId && f.context === context)),
  );
  if (eligible.length !== ids.length) {
    throw new AppError('VALIDATION_ERROR', 'One or more files cannot be attached.', {
      fileIds: ids.filter((id) => !eligible.some((f) => f.id === id)),
    });
  }
  await tx.fileObject.updateMany({ where: { id: { in: ids } }, data: { context, contextId } });
}

/** D5: detached files get contextId null and are purged 24 h later. */
export async function detachFiles(tx: Tx, fileIds: string[]): Promise<void> {
  if (fileIds.length === 0) return;
  await tx.fileObject.updateMany({ where: { id: { in: fileIds } }, data: { contextId: null } });
}
