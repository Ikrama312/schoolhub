import { notFound, redirect } from 'next/navigation';
import Box from '@mui/material/Box';
import { requirePageRole } from '@/server/auth/requireRole';
import { AppError } from '@/server/http';
import { getSchoolTimezone } from '@/server/assignments/assignments-service';
import { getQuizForManager, listAccommodations } from '@/server/quiz/quiz-service';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { QuizBuilder } from './QuizBuilder';

export const dynamic = 'force-dynamic';

/** FR-6..FR-10, FR-28 quiz builder (manage course only; checked by the service, NFR-5). */
export default async function EditQuizPage({ params }: { params: { courseId: string; quizId: string } }) {
  const user = await requirePageRole('TEACHER', 'ADMIN');
  let quiz: Awaited<ReturnType<typeof getQuizForManager>>;
  let accommodations: Awaited<ReturnType<typeof listAccommodations>>;
  try {
    [quiz, accommodations] = await Promise.all([getQuizForManager(user, params.quizId), listAccommodations(user, params.quizId)]);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    if (error instanceof AppError && error.code === 'FORBIDDEN') redirect('/forbidden');
    throw error;
  }
  if (quiz.courseId !== params.courseId) notFound();
  const timezone = await getSchoolTimezone();
  return (
    <Box>
      <PageHeader title={quiz.title} breadcrumbs={[{ label: 'Quizzes', href: `/courses/${params.courseId}/quizzes` }, { label: quiz.title }]} />
      <QuizBuilder quiz={quiz} timezone={timezone} accommodations={accommodations} />
    </Box>
  );
}
