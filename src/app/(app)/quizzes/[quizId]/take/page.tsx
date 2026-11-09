import { notFound, redirect } from 'next/navigation';
import Box from '@mui/material/Box';
import { requirePageUser } from '@/server/auth/requireRole';
import { AppError } from '@/server/http';
import { prisma } from '@/server/db';
import { getSchoolTimezone } from '@/server/assignments/assignments-service';
import { canManageCourse } from '@/server/quiz/access';
import { getAttemptView, listOwnAttempts } from '@/server/quiz/attempt-service';
import { getQuizForStudent } from '@/server/quiz/quiz-service';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { QuizPlayer, StartScreen } from './QuizPlayer';

export const dynamic = 'force-dynamic';

/** FR-12/FR-14: start screen, or the player when an attempt is IN_PROGRESS (expired ones are auto-submitted first, FR-18). */
export default async function TakeQuizPage({ params }: { params: { quizId: string } }) {
  const user = await requirePageUser();
  const course = await prisma.quiz.findUnique({ where: { id: params.quizId }, select: { courseId: true } });
  if (!course) notFound();
  if (await canManageCourse(user, course.courseId)) redirect(`/courses/${course.courseId}/quizzes/${params.quizId}/edit`);
  if (user.role === 'PARENT') redirect(`/courses/${course.courseId}/quizzes`);

  let quiz: Awaited<ReturnType<typeof getQuizForStudent>>;
  try {
    quiz = await getQuizForStudent(user, params.quizId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }

  if (quiz.inProgressAttemptId) {
    const view = await getAttemptView(user, quiz.inProgressAttemptId);
    if (view.view === 'attempt') return <QuizPlayer attempt={view.data} />;
  }
  const [timezone, attempts] = await Promise.all([getSchoolTimezone(), listOwnAttempts(user, params.quizId)]);
  return (
    <Box>
      <PageHeader title={quiz.title} breadcrumbs={[{ label: 'Quizzes', href: `/courses/${quiz.courseId}/quizzes` }, { label: quiz.title }]} />
      <StartScreen quiz={quiz} timezone={timezone} attempts={attempts} />
    </Box>
  );
}
