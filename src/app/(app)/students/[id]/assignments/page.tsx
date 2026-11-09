import { notFound, redirect } from 'next/navigation';
import Box from '@mui/material/Box';
import { requirePageUser } from '@/server/auth/requireRole';
import { AppError } from '@/server/http';
import { getSchoolTimezone, listStudentAssignments } from '@/server/assignments/assignments-service';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { AssignmentList } from '../../../assignments/AssignmentList';

export const dynamic = 'force-dynamic';

/**
 * Student "Assignments" tab (FR-41, FR-58). assertCanViewStudent in the service. No studentTabs
 * renderer exists yet, so this page is reachable by URL only (known gap).
 */
export default async function StudentAssignmentsPage({ params }: { params: { id: string } }) {
  const user = await requirePageUser();
  let data: Awaited<ReturnType<typeof listStudentAssignments>>;
  try {
    data = await listStudentAssignments(user, params.id);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    if (error instanceof AppError && error.code === 'FORBIDDEN') redirect('/forbidden');
    throw error;
  }
  const timezone = await getSchoolTimezone();
  const courses = [...new Map(data.items.map((r) => [r.assignment.courseId, { id: r.assignment.courseId, name: r.assignment.courseName }])).values()];

  return (
    <Box>
      <PageHeader title="Assignments" description={data.student.name} />
      <AssignmentList variant="tabs" showCourse rows={data.items} timezone={timezone} courses={courses} />
    </Box>
  );
}
