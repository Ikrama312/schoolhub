// @vitest-environment node
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DATABASE_URL ??= 'postgresql://unused@localhost/unused';
  process.env.APP_URL ??= 'http://localhost:3000';
  process.env.AUTH_SECRET ??= 'test-secret';
  process.env.MAX_UPLOAD_MB = '1';
});

import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import { resolveKey } from '@/server/storage';
import { purgeOrphanFiles } from '@/server/files/purge';
import {
  attachFiles,
  deleteUnattachedFile,
  getFileForDownload,
  uploadFile,
} from '@/server/files/files-service';

/**
 * SH-8 QA: upload -> download -> delete/purge through the real service and a
 * migrated Postgres (FR-3..FR-12, FR-17, FR-41, NFR-1, NFR-5). Fixtures are
 * tagged with MARK and removed. Skipped without TEST_DATABASE_URL.
 */
const MARK = 'qa-sh8';
const uploadDir = mkdtempSync(path.join(tmpdir(), 'sh8-uploads-'));
process.env.UPLOAD_DIR = uploadDir;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const ELF = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]), Buffer.alloc(200)]);

const u = {} as Record<'owner' | 'other' | 'admin', { id: string; role: string }>;

function req(context: string, name: string, bytes: Buffer, type = 'application/octet-stream') {
  const form = new FormData();
  form.append('context', context);
  form.append('file', new Blob([bytes], { type }), name);
  return new Request('http://localhost/api/files', { method: 'POST', body: form });
}

async function code(p: Promise<unknown>) {
  try {
    await p;
    return 'OK';
  } catch (e) {
    if (e instanceof AppError) return `${e.code}: ${e.message}`;
    throw e;
  }
}

const drain = async (s: NodeJS.ReadableStream) => {
  const chunks: Buffer[] = [];
  for await (const c of s) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
};

describe.skipIf(!process.env.TEST_DATABASE_URL)('files: upload -> access -> delete/purge', () => {
  beforeAll(async () => {
    for (const [key, role] of [['owner', 'TEACHER'], ['other', 'STUDENT'], ['admin', 'ADMIN']] as const) {
      const user = await prisma.user.create({
        data: { email: `${key}@${MARK}.test`, firstName: key, lastName: MARK, role },
      });
      u[key] = { id: user.id, role };
    }
  });

  afterAll(async () => {
    const ids = Object.values(u).map((x) => x.id);
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } }).catch(() => undefined);
    await prisma.fileObject.deleteMany({ where: { ownerId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    rmSync(uploadDir, { recursive: true, force: true });
    await prisma.$disconnect();
  });

  it('stores a valid PNG unattached with sha256, sanitised name and server-side mime', async () => {
    const f = await uploadFile(u.owner, req('lesson', '../../evil\\name.png', PNG, 'text/html'));
    const row = await prisma.fileObject.findUniqueOrThrow({ where: { id: f.id } });
    expect(row.originalName).toBe('name.png'); // busboy basenames; sanitizeFilename strips the rest
    expect(row.mimeType).toBe('image/png');
    expect(row.contextId).toBeNull();
    expect(row.sizeBytes).toBe(PNG.length);
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.storageKey).toMatch(/^\d{4}\/\d{2}\/[0-9a-z]+\.png$/);
    expect(existsSync(resolveKey(row.storageKey))).toBe(true);
    expect(resolveKey(row.storageKey).startsWith(uploadDir)).toBe(true);
  });

  it('rejects disallowed extension, disguised executable, SVG outside logo, and oversize', async () => {
    expect(await code(uploadFile(u.owner, req('lesson', 'run.exe', ELF)))).toBe(
      'VALIDATION_ERROR: File type .exe is not allowed.',
    );
    expect(await code(uploadFile(u.owner, req('lesson', 'notes.txt', ELF)))).toBe(
      'VALIDATION_ERROR: File type .txt is not allowed.',
    );
    expect(await code(uploadFile(u.owner, req('lesson', 'x.svg', Buffer.from('<svg/>'))))).toMatch(/not allowed/);
    const big = Buffer.concat([PNG, Buffer.alloc(1024 * 1024 + 10)]);
    expect(await code(uploadFile(u.owner, req('lesson', 'big.png', big)))).toBe('VALIDATION_ERROR: File exceeds 1 MB.');
    // Nothing from the rejected uploads is left on disk outside .tmp.
    expect(await prisma.fileObject.count({ where: { ownerId: u.owner.id, originalName: { in: ['big.png', 'notes.txt'] } } })).toBe(0);
  });

  it('accepts txt with no signature and SVG for the logo context', async () => {
    expect(await code(uploadFile(u.owner, req('lesson', 'a.txt', Buffer.from('hello'))))).toBe('OK');
    expect(await code(uploadFile(u.admin, req('logo', 'logo.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))))).toBe('OK');
  });

  it('unattached files: owner and admin can download, others and anonymous get NOT_FOUND', async () => {
    const f = await uploadFile(u.owner, req('lesson', 'dl.png', PNG));
    const { stream } = await getFileForDownload(u.owner, f.id);
    expect((await drain(stream)).equals(PNG)).toBe(true);
    expect(await code(getFileForDownload(u.admin, f.id).then((r) => r.stream.destroy()))).toBe('OK');
    expect(await code(getFileForDownload(u.other, f.id))).toBe('NOT_FOUND: File not found');
    expect(await code(getFileForDownload(null, f.id))).toBe('NOT_FOUND: File not found');
  });

  it('attached logo is public; attached lesson file to a missing lesson is denied', async () => {
    const logo = await uploadFile(u.admin, req('logo', 'logo.png', PNG));
    await prisma.$transaction((tx) => attachFiles(tx, u.admin, [logo.id], 'logo', 'school'));
    expect(await code(getFileForDownload(null, logo.id).then((r) => r.stream.destroy()))).toBe('OK');

    const lf = await uploadFile(u.owner, req('lesson', 'l.png', PNG));
    await prisma.$transaction((tx) => attachFiles(tx, u.owner, [lf.id], 'lesson', 'no-such-lesson'));
    expect(await code(getFileForDownload(u.other, lf.id))).toBe('NOT_FOUND: File not found');
  });

  it('attach refuses files owned by someone else (non-admin)', async () => {
    const f = await uploadFile(u.owner, req('lesson', 'mine.png', PNG));
    expect(await code(prisma.$transaction((tx) => attachFiles(tx, u.other, [f.id], 'lesson', 'x')))).toBe(
      'VALIDATION_ERROR: One or more files cannot be attached.',
    );
  });

  it('delete: owner ok while unattached (row + bytes gone), attached -> CONFLICT, stranger -> NOT_FOUND', async () => {
    const f = await uploadFile(u.owner, req('lesson', 'del.png', PNG));
    const { storageKey } = await prisma.fileObject.findUniqueOrThrow({ where: { id: f.id } });
    expect(await code(deleteUnattachedFile(u.other, f.id))).toBe('NOT_FOUND: File not found');
    await deleteUnattachedFile(u.owner, f.id);
    expect(await prisma.fileObject.findUnique({ where: { id: f.id } })).toBeNull();
    expect(existsSync(resolveKey(storageKey))).toBe(false);

    const g = await uploadFile(u.owner, req('lesson', 'att.png', PNG));
    await prisma.$transaction((tx) => attachFiles(tx, u.owner, [g.id], 'lesson', 'some-lesson'));
    expect(await code(deleteUnattachedFile(u.owner, g.id))).toMatch(/^CONFLICT/);
  });

  it('admin deleting another user\'s file writes an audit row', async () => {
    const f = await uploadFile(u.owner, req('lesson', 'aud.png', PNG));
    await deleteUnattachedFile(u.admin, f.id);
    expect(await prisma.auditLog.count({ where: { actorId: u.admin.id, entityId: f.id, action: 'file.delete' } })).toBe(1);
  });

  it('NFR-3: the 61st upload in an hour is RATE_LIMITED', async () => {
    // 'other' has made no successful uploads; every call (even a rejected one) counts.
    for (let i = 0; i < 60; i++) await uploadFile(u.other, req('lesson', `r${i}.txt`, Buffer.from('x')));
    expect(await code(uploadFile(u.other, req('lesson', 'r60.txt', Buffer.from('x'))))).toMatch(/^RATE_LIMITED/);
  });

  it('purgeOrphanFiles removes only unattached files older than 24 h, with their bytes', async () => {
    const old = await uploadFile(u.owner, req('lesson', 'old.png', PNG));
    const fresh = await uploadFile(u.owner, req('lesson', 'fresh.png', PNG));
    const oldAttached = await uploadFile(u.owner, req('lesson', 'oldatt.png', PNG));
    await prisma.$transaction((tx) => attachFiles(tx, u.owner, [oldAttached.id], 'lesson', 'kept'));
    const past = new Date(Date.now() - 25 * 3600_000);
    await prisma.fileObject.updateMany({ where: { id: { in: [old.id, oldAttached.id] } }, data: { createdAt: past } });
    const { storageKey } = await prisma.fileObject.findUniqueOrThrow({ where: { id: old.id } });

    expect(await purgeOrphanFiles()).toBeGreaterThanOrEqual(1);
    expect(await prisma.fileObject.findUnique({ where: { id: old.id } })).toBeNull();
    expect(existsSync(resolveKey(storageKey))).toBe(false);
    expect(await prisma.fileObject.findUnique({ where: { id: fresh.id } })).not.toBeNull();
    expect(await prisma.fileObject.findUnique({ where: { id: oldAttached.id } })).not.toBeNull();
  });
});
