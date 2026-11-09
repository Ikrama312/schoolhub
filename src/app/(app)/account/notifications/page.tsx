import { requirePageUser } from '@/server/auth/requireRole';
import { getPreferencesFor } from '@/server/notifications/preferences';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { PreferencesTable } from './PreferencesTable';

export const dynamic = 'force-dynamic';

/** /account/notifications — PRD-04 FR-28..30. */
export default async function NotificationPreferencesPage() {
  const me = await requirePageUser();
  const initial = await getPreferencesFor(me);
  return (
    <>
      <PageHeader title="Notification preferences" description="Choose how you hear about activity in SchoolHub." />
      <PreferencesTable initial={initial} />
    </>
  );
}
