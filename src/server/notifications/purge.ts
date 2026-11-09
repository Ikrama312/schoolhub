import { prisma } from '@/server/db';

export const RETENTION_DAYS = 180;

/** FR-27: deletes notifications older than 180 days. Returns the deleted count. */
export async function purgeOldNotifications(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60_000);
  const { count } = await prisma.notification.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return count;
}
