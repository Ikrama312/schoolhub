import { Suspense } from 'react';
import { prisma } from '@/server/db';
import { requirePageRole } from '@/server/auth/requireRole';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { LoadingSkeleton } from '@/components/LoadingSkeleton/LoadingSkeleton';
import { ConferenceEventsClient } from './ConferenceEventsClient';

/** /admin/conferences — ADMIN creates and edits parent–teacher conference events (FR-28). */
export default async function AdminConferencesPage() {
  await requirePageRole('ADMIN');
  const gradeLevels = await prisma.gradeLevel.findMany({ where: { archivedAt: null }, orderBy: { order: 'asc' }, select: { id: true, name: true } });
  return (
    <>
      <PageHeader title="Parent–teacher conferences" description="Create conference days, set the booking window and choose which grade levels can book." />
      <Suspense fallback={<LoadingSkeleton variant="table" />}>
        <ConferenceEventsClient gradeLevels={gradeLevels} />
      </Suspense>
    </>
  );
}
