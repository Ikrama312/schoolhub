import { requirePageUser } from '@/server/auth/requireRole';
import { prisma } from '@/server/db';
import { getPreferencesFor } from '@/server/notifications/preferences';
import { getSettings } from '@/server/messaging/quiet-hours';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { QuietHoursSection } from '@/components/messaging/QuietHoursSection';
import { PreferencesTable } from './PreferencesTable';

export const dynamic = 'force-dynamic';

/** /account/notifications — PRD-04 FR-28..30, plus PRD-13 FR-21 quiet hours. */
export default async function NotificationPreferencesPage() {
  const me = await requirePageUser();
  const [initial, quiet, settings] = await Promise.all([
    getPreferencesFor(me),
    getSettings(me.id),
    prisma.schoolSettings.findUnique({ where: { id: 'singleton' }, select: { timezone: true } }),
  ]);
  return (
    <>
      <PageHeader title="Notification preferences" description="Choose how you hear about activity in SchoolHub." />
      <PreferencesTable initial={initial} />
      <QuietHoursSection initial={quiet} timezone={settings?.timezone ?? 'UTC'} />
    </>
  );
}
