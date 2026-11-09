import { notFound, redirect } from 'next/navigation';
import Box from '@mui/material/Box';
import { requirePageRole } from '@/server/auth/requireRole';
import { AppError } from '@/server/http';
import { getAssignment, getSchoolTimezone, listManagedCourses } from '@/server/assignments/assignments-service';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { AssignmentForm } from '../../AssignmentForm';

export const dynamic = 'force-dynamic';

/** FR-9, FR-14, FR-15: edit page (manage course only). */
export default async function EditAssignmentPage({ params }: { params: { courseId: string; assignmentId: string } }) {
  const user = await requirePageRole('TEACHER', 'ADMIN');
  let data: Awaited<ReturnType<typeof getAssignment>>;
  try {
    data = await getAssignment(user, params.assignmentId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    if (error instanceof AppError && error.code === 'FORBIDDEN') redirect('/forbidden');
    throw error;
  }
  if (data.assignment.courseId !== params.courseId) notFound();
  if (!data.canManage) redirect('/forbidden');
  const [timezone, managedCourses] = await Promise.all([getSchoolTimezone(), listManagedCourses(user)]);

  return (
    <Box>
      <PageHeader
        title={`Edit: ${data.assignment.title}`}
        breadcrumbs={[
          { label: 'Assignments', href: `/courses/${params.courseId}/assignments` },
          { label: data.assignment.title, href: `/courses/${params.courseId}/assignments/${params.assignmentId}` },
          { label: 'Edit' },
        ]}
      />
      <AssignmentForm
        courseId={params.courseId}
        timezone={timezone}
        defaultDueAt={data.assignment.dueAt}
        initial={data.assignment}
        submissionCount={data.submissionCount}
        managedCourses={managedCourses}
      />
    </Box>
  );
}
