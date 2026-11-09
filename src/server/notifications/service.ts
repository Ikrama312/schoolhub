import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import type { ListNotificationsQuery } from '@/lib/validators/notifications';
import { categoryOf, typesInCategory } from './types';

const SELECT = { id: true, type: true, title: true, body: true, link: true, readAt: true, createdAt: true } as const;

/** FR-34: caller's own notifications, newest first. Category is derived from the registry. */
export async function listNotifications(
  userId: string,
  query: ListNotificationsQuery,
  page: { skip: number; take: number },
) {
  const where = {
    userId,
    ...(query.unread === 'true' ? { readAt: null } : {}),
    ...(query.category ? { type: { in: typesInCategory(query.category) } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, select: SELECT, ...page }),
    prisma.notification.count({ where }),
  ]);
  return { rows: rows.map((r) => ({ ...r, category: categoryOf(r.type) })), total };
}

/** FR-35: index-only on [userId, readAt, createdAt]. */
export function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

/** FR-36: owner-scoped; 0 rows → NOT_FOUND so other users' ids are never revealed. */
export async function setRead(userId: string, id: string, read: boolean): Promise<{ id: string }> {
  const { count } = await prisma.notification.updateMany({
    where: { id, userId },
    data: { readAt: read ? new Date() : null },
  });
  if (count === 0) throw new AppError('NOT_FOUND', 'Notification not found');
  return { id };
}

export async function markAllRead(userId: string): Promise<{ count: number }> {
  return prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
}
