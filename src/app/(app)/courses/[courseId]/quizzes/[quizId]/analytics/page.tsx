import { notFound, redirect } from 'next/navigation';
import Box from '@mui/material/Box';
import { requirePageRole } from '@/server/auth/requireRole';
import { AppError } from '@/server/http';
import { getQuizAnalytics } from '@/server/quiz/analytics';
import { getQuizForManager } from '@/server/quiz/quiz-service';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { QuizAnalytics } from './QuizAnalytics';

export const dynamic = 'force-dynamic';

/** FR-26/FR-27 analytics (manage course only). */
export default async function QuizAnalyticsPage({ params }: { params: { courseId: string; quizId: string } }) {
  const user = await requirePageRole('TEACHER', 'ADMIN');
  let quiz: Awaited<ReturnType<typeof getQuizForManager>>;
  let analytics: Awaited<ReturnType<typeof getQuizAnalytics>>;
  try {
    [quiz, analytics] = await Promise.all([getQuizForManager(user, params.quizId), getQuizAnalytics(user, params.quizId)]);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    if (error instanceof AppError && error.code === 'FORBIDDEN') redirect('/forbidden');
    throw error;
  }
  if (quiz.courseId !== params.courseId) notFound();
  return (
    <Box>
      <PageHeader
        title={`Analytics: ${quiz.title}`}
        breadcrumbs={[
          { label: 'Quizzes', href: `/courses/${params.courseId}/quizzes` },
          { label: quiz.title, href: `/courses/${params.courseId}/quizzes/${quiz.id}/edit` },
          { label: 'Analytics' },
        ]}
      />
      <QuizAnalytics quizId={quiz.id} data={analytics} />
    </Box>
  );
}
