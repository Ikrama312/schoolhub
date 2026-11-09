import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { env } from '@/lib/env';

/**
 * Local-disk file storage (PRD-08 FR-2, NFR-5, NFR-11). Single implementation,
 * no interface: bytes live under UPLOAD_DIR (never public/) and are only ever
 * served through GET /api/files/:id.
 */

function root(): string {
  // Read per call so tests can point UPLOAD_DIR at a temp dir.
  return path.resolve(process.env.UPLOAD_DIR || env.UPLOAD_DIR);
}

/** Absolute path for a storage key; throws if the key escapes UPLOAD_DIR (traversal guard). */
export function resolveKey(storageKey: string): string {
  const base = root();
  const full = path.resolve(base, storageKey);
  if (!full.startsWith(base + path.sep)) throw new Error('Invalid storage key');
  return full;
}

export interface SavedFile {
  storageKey: string;
  sizeBytes: number;
  sha256: string;
}

/**
 * Streams `stream` to UPLOAD_DIR/.tmp, hashing and counting bytes on the way,
 * then renames to <yyyy>/<mm>/<id>.<ext>. On any stream error (including an
 * abort for oversize/bad type) the tmp file is removed and the error rethrown.
 */
export async function saveFile(stream: Readable, meta: { ext: string }): Promise<SavedFile> {
  const base = root();
  const id = randomUUID().replace(/-/g, '');
  const tmpDir = path.join(base, '.tmp');
  await mkdir(tmpDir, { recursive: true });
  const tmp = path.join(tmpDir, id);

  const hash = createHash('sha256');
  let sizeBytes = 0;
  const tap = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      hash.update(chunk);
      sizeBytes += chunk.length;
      cb(null, chunk);
    },
  });

  try {
    await pipeline(stream, tap, createWriteStream(tmp));
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }

  const now = new Date();
  const ext = meta.ext.toLowerCase().replace(/[^a-z0-9]/g, '');
  const storageKey = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}${ext ? `.${ext}` : ''}`;
  const dest = resolveKey(storageKey);
  await mkdir(path.dirname(dest), { recursive: true });
  await rename(tmp, dest);
  return { storageKey, sizeBytes, sha256: hash.digest('hex') };
}

export function readFile(storageKey: string): Readable {
  return createReadStream(resolveKey(storageKey));
}

/** Removes stored bytes; a missing file is not an error. */
export async function deleteFile(storageKey: string): Promise<void> {
  try {
    await unlink(resolveKey(storageKey));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
