import { requirePageUser } from '@/server/auth/requireRole';
import { prisma } from '@/server/db';
import { NotificationsList } from './NotificationsList';

export const dynamic = 'force-dynamic';

/** /notifications — PRD-04 FR-26. */
export default async function NotificationsPage() {
  await requirePageUser();
  const settings = await prisma.schoolSettings.findUnique({ where: { id: 'singleton' }, select: { timezone: true } });
  return <NotificationsList timezone={settings?.timezone ?? 'UTC'} />;
}
