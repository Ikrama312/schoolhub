import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Button from '@mui/material/Button';
import Grid from '@mui/material/Grid';
import { prisma } from '@/server/db';
import { requirePageUser } from '@/server/auth/requireRole';
import { assertCanViewStudent } from '@/server/auth/student-access';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { LoadingSkeleton } from '@/components/LoadingSkeleton/LoadingSkeleton';
import {
  ActionsCard,
  AnnouncementsCard,
  AssignmentsCard,
  AttendanceCard,
  EventsCard,
  GradesCard,
  TeachersCard,
  TodayCard,
} from './OverviewCards';

/**
 * /my-children/[studentId] — the parent landing page (FR-8 to FR-17, NFR-2). Access is checked once,
 * the header paints first, and each card streams in its own Suspense boundary.
 */
export default async function ChildOverviewPage({ params }: { params: { studentId: string } }) {
  const user = await requirePageUser();
  await assertCanViewStudent(user, params.studentId).catch(() => notFound());
  const student = await prisma.user.findFirst({
    where: { id: params.studentId, role: 'STUDENT' },
    select: { firstName: true, lastName: true, sectionMemberships: { where: { section: { academicYear: { isCurrent: true } } }, select: { section: { select: { name: true } } } } },
  });
  if (!student) notFound();
  const props = { user, studentId: params.studentId };
  const cards = [TodayCard, AttendanceCard, AssignmentsCard, GradesCard, AnnouncementsCard, EventsCard, TeachersCard, ActionsCard];
  return (
    <>
      <PageHeader
        title={`${student.firstName} ${student.lastName}`}
        description={student.sectionMemberships[0]?.section.name}
        breadcrumbs={user.role === 'PARENT' ? [{ label: 'My children', href: '/my-children' }, { label: student.firstName }] : undefined}
        actions={
          user.role === 'PARENT' ? (
            <Button variant="outlined" component={Link} href={`/my-children/${params.studentId}/absence/new`}>
              Report an absence
            </Button>
          ) : undefined
        }
      />
      <Grid container spacing={2}>
        {cards.map((Card, i) => (
          <Grid key={i} size={{ xs: 12, md: 6, xl: 4 }}>
            <Suspense fallback={<LoadingSkeleton variant="card" />}>
              <Card {...props} />
            </Suspense>
          </Grid>
        ))}
      </Grid>
    </>
  );
}
