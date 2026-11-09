import NextLink from 'next/link';
import { notFound, redirect } from 'next/navigation';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import AddIcon from '@mui/icons-material/Add';
import { requirePageUser } from '@/server/auth/requireRole';
import { AppError, parsePagination } from '@/server/http';
import { getSchoolTimezone } from '@/server/assignments/assignments-service';
import { listCourseQuizzes, type CourseQuizList } from '@/server/quiz/quiz-service';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { CourseQuizzesView } from './CourseQuizzesView';

export const dynamic = 'force-dynamic';

/** Course "Quizzes" tab (FR-11). Role-shaped by the service; course access in the layout and service (NFR-5). */
export default async function CourseQuizzesPage({ params, searchParams }: { params: { courseId: string }; searchParams: Record<string, string> }) {
  const user = await requirePageUser();
  let data: CourseQuizList;
  try {
    data = await listCourseQuizzes(user, params.courseId, parsePagination(new URLSearchParams(searchParams)));
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    if (error instanceof AppError && error.code === 'FORBIDDEN') redirect('/forbidden');
    throw error;
  }
  const timezone = await getSchoolTimezone();
  return (
    <Box>
      <PageHeader
        title="Quizzes"
        actions={
          data.role === 'MANAGER' ? (
            <Button variant="contained" startIcon={<AddIcon />} component={NextLink} href={`/courses/${params.courseId}/quizzes/new`} prefetch={false}>
              New quiz
            </Button>
          ) : undefined
        }
      />
      <CourseQuizzesView courseId={params.courseId} data={data} timezone={timezone} />
    </Box>
  );
}
