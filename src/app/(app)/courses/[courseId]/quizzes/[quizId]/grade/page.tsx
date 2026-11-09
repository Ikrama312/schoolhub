import { notFound, redirect } from 'next/navigation';
import Box from '@mui/material/Box';
import { requirePageRole } from '@/server/auth/requireRole';
import { AppError } from '@/server/http';
import { listManagerAttempts } from '@/server/quiz/attempt-service';
import { getQuizForManager } from '@/server/quiz/quiz-service';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { QuizGradingWorkspace } from './QuizGradingWorkspace';

export const dynamic = 'force-dynamic';

/** FR-24/FR-25 manual grading (manage course only). listManagerAttempts auto-submits expired attempts first (FR-18). */
export default async function QuizGradePage({ params }: { params: { courseId: string; quizId: string } }) {
  const user = await requirePageRole('TEACHER', 'ADMIN');
  let quiz: Awaited<ReturnType<typeof getQuizForManager>>;
  let attempts: Awaited<ReturnType<typeof listManagerAttempts>>;
  try {
    quiz = await getQuizForManager(user, params.quizId);
    attempts = await listManagerAttempts(user, params.quizId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    if (error instanceof AppError && error.code === 'FORBIDDEN') redirect('/forbidden');
    throw error;
  }
  if (quiz.courseId !== params.courseId) notFound();
  return (
    <Box>
      <PageHeader
        title={`Grade: ${quiz.title}`}
        breadcrumbs={[
          { label: 'Quizzes', href: `/courses/${params.courseId}/quizzes` },
          { label: quiz.title, href: `/courses/${params.courseId}/quizzes/${quiz.id}/edit` },
          { label: 'Grade' },
        ]}
      />
      <QuizGradingWorkspace questions={quiz.questions} initialAttempts={attempts} />
    </Box>
  );
}
