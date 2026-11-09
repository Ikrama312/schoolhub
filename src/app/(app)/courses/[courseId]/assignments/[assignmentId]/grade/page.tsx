import { notFound, redirect } from 'next/navigation';
import Box from '@mui/material/Box';
import { requirePageRole } from '@/server/auth/requireRole';
import { AppError } from '@/server/http';
import { getAssignment, getSchoolTimezone, listGradingRoster } from '@/server/assignments/assignments-service';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { GradingWorkspace } from './GradingWorkspace';

export const dynamic = 'force-dynamic';

/** FR-28: grading page (manage course; checked by getAssignment/listGradingRoster). */
export default async function GradePage({ params }: { params: { courseId: string; assignmentId: string } }) {
  const user = await requirePageRole('TEACHER', 'ADMIN');
  let data: Awaited<ReturnType<typeof getAssignment>>;
  let roster: Awaited<ReturnType<typeof listGradingRoster>>;
  try {
    data = await getAssignment(user, params.assignmentId);
    if (!data.canManage) redirect('/forbidden');
    roster = await listGradingRoster(user, params.assignmentId, { sort: 'name' }, { skip: 0, take: 1000 });
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    if (error instanceof AppError && error.code === 'FORBIDDEN') redirect('/forbidden');
    throw error;
  }
  if (data.assignment.courseId !== params.courseId) notFound();
  const timezone = await getSchoolTimezone();

  return (
    <Box>
      <PageHeader
        title={`Grade: ${data.assignment.title}`}
        breadcrumbs={[
          { label: 'Assignments', href: `/courses/${params.courseId}/assignments` },
          { label: data.assignment.title, href: `/courses/${params.courseId}/assignments/${params.assignmentId}` },
          { label: 'Grade' },
        ]}
      />
      <GradingWorkspace assignment={data.assignment} initialRoster={roster.items} timezone={timezone} />
    </Box>
  );
}
