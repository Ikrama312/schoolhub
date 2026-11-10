import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { prisma } from '@/server/db';
import { requirePageRole } from '@/server/auth/requireRole';
import { getSelectedChild } from '@/server/parent/selected-child';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { LoadingSkeleton } from '@/components/LoadingSkeleton/LoadingSkeleton';
import { AbsenceNotesReviewClient } from './AbsenceNotesReviewClient';

/**
 * /attendance/absence-notes — review queue for homeroom TEACHERs (own section) and ADMIN (FR-21, FR-22).
 * PARENTs land here from the nav and are sent to their selected child's notes (FR-42).
 */
export default async function AbsenceNotesReviewPage() {
  const user = await requirePageRole('ADMIN', 'TEACHER', 'PARENT');
  if (user.role === 'PARENT') {
    const child = await getSelectedChild(user);
    redirect(child ? `/my-children/${child.studentId}/absence` : '/my-children');
  }
  if (user.role === 'TEACHER') {
    const homeroom = await prisma.section.count({ where: { homeroomTeacherId: user.id, academicYear: { isCurrent: true } } });
    if (!homeroom) redirect('/forbidden');
  }
  return (
    <>
      <PageHeader
        title="Absence notes"
        description={user.role === 'ADMIN' ? 'Notes from parents across the school.' : 'Notes from parents of students in your homeroom.'}
      />
      <Suspense fallback={<LoadingSkeleton variant="table" />}>
        <AbsenceNotesReviewClient />
      </Suspense>
    </>
  );
}
