import NextLink from 'next/link';
import { notFound, redirect } from 'next/navigation';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import AddIcon from '@mui/icons-material/Add';
import { requirePageUser } from '@/server/auth/requireRole';
import { AppError } from '@/server/http';
import { getSchoolTimezone, listCourseAssignments } from '@/server/assignments/assignments-service';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { AssignmentList } from '../../../assignments/AssignmentList';
import { CourseAssignmentsTable } from './CourseAssignmentsTable';

export const dynamic = 'force-dynamic';

/** Course "Assignments" tab (FR-16..FR-18). Role-shaped by the service; course access in the layout and service. */
export default async function CourseAssignmentsPage({ params, searchParams }: { params: { courseId: string }; searchParams: { studentId?: string } }) {
  const user = await requirePageUser();
  let data: Awaited<ReturnType<typeof listCourseAssignments>>;
  try {
    data = await listCourseAssignments(user, params.courseId, searchParams.studentId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    if (error instanceof AppError && error.code === 'FORBIDDEN') redirect('/forbidden');
    throw error;
  }
  const timezone = await getSchoolTimezone();

  if (data.view === 'manager') {
    return (
      <Box>
        <PageHeader
          title="Assignments"
          actions={
            <Button variant="contained" startIcon={<AddIcon />} component={NextLink} href={`/courses/${params.courseId}/assignments/new`}>
              New assignment
            </Button>
          }
        />
        <CourseAssignmentsTable courseId={params.courseId} items={data.items} timezone={timezone} />
      </Box>
    );
  }
  return (
    <Box>
      <PageHeader title="Assignments" />
      <AssignmentList variant="grouped" rows={data.items} timezone={timezone} childOptions={data.children} studentId={data.studentId} />
    </Box>
  );
}
