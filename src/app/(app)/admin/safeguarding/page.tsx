import { prisma } from '@/server/db';
import { requirePageSafeguardingLead } from '@/server/messaging/access';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { SafeguardingTabs } from '@/components/messaging/SafeguardingReports';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Safeguarding' };

/** /admin/safeguarding — ADMIN safeguarding leads only (FR-23, FR-24); everyone else is redirected to /forbidden. */
export default async function SafeguardingPage() {
  await requirePageSafeguardingLead();
  const settings = await prisma.schoolSettings.findUnique({ where: { id: 'singleton' }, select: { timezone: true } });
  return (
    <>
      <PageHeader title="Safeguarding" description="Review reported messages and conversations that involve students. Every view is audited." />
      <SafeguardingTabs timezone={settings?.timezone ?? 'UTC'} />
    </>
  );
}
