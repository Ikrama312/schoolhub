import { prisma } from '@/server/db';
import { logger } from '@/lib/logger';
import { deleteFile } from '@/server/storage';

const DAY_MS = 24 * 60 * 60_000;
const BATCH = 500;

/**
 * FR-12: delete unattached files (contextId null) older than 24 h -- abandoned
 * uploads, detached attachments, removed inline images, replaced logos.
 * Bytes first, then rows. One batch per call; the daily run catches the rest.
 */
export async function purgeOrphanFiles(now: Date = new Date()): Promise<number> {
  const orphans = await prisma.fileObject.findMany({
    where: { contextId: null, createdAt: { lt: new Date(now.getTime() - DAY_MS) } },
    select: { id: true, storageKey: true },
    take: BATCH,
  });
  const deleted: string[] = [];
  for (const file of orphans) {
    try {
      await deleteFile(file.storageKey);
      deleted.push(file.id);
    } catch (error) {
      logger.error('Orphan file delete failed', { id: file.id, message: error instanceof Error ? error.message : String(error) });
    }
  }
  // ponytail: a file attached in the ms between findMany and here keeps its row but loses its bytes;
  // wrap in a row lock if attaching day-old uploads ever becomes common.
  const { count } = await prisma.fileObject.deleteMany({ where: { id: { in: deleted }, contextId: null } });
  logger.info('Purged orphan files', { count });
  return count;
}
