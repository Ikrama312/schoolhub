import { notFound, redirect } from 'next/navigation';
import Box from '@mui/material/Box';
import { requirePageRole } from '@/server/auth/requireRole';
import { assertCanManageCourse } from '@/server/auth/course-access';
import { AppError } from '@/server/http';
import { prisma } from '@/server/db';
import { getSchoolTimezone, listManagedCourses } from '@/server/assignments/assignments-service';
import { nextTeachingDayDueAt } from '@/lib/dates';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { AssignmentForm } from '../AssignmentForm';

export const dynamic = 'force-dynamic';

/** FR-9: create page (manage course). dueAt default = next teaching day 23:59 school time (FR-10). */
export default async function NewAssignmentPage({ params }: { params: { courseId: string } }) {
  const user = await requirePageRole('TEACHER', 'ADMIN');
  try {
    await assertCanManageCourse(user, params.courseId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    if (error instanceof AppError && error.code === 'FORBIDDEN') redirect('/forbidden');
    throw error;
  }
  const [timezone, days, managedCourses] = await Promise.all([
    getSchoolTimezone(),
    prisma.schoolDay.findMany(),
    listManagedCourses(user),
  ]);
  // A missing SchoolDay row (unseeded DB) defaults to Mon–Fri teaching, as in the timetable service.
  const teaching = [1, 2, 3, 4, 5, 6, 7].filter((d) => days.find((r) => r.dayOfWeek === d)?.isTeaching ?? d <= 5);
  const defaultDueAt = nextTeachingDayDueAt(new Date(), timezone, teaching).toISOString();

  return (
    <Box>
      <PageHeader title="New assignment" breadcrumbs={[{ label: 'Assignments', href: `/courses/${params.courseId}/assignments` }, { label: 'New' }]} />
      <AssignmentForm courseId={params.courseId} timezone={timezone} defaultDueAt={defaultDueAt} managedCourses={managedCourses} />
    </Box>
  );
}
