import { notFound, redirect } from 'next/navigation';
import { requirePageRole } from '@/server/auth/requireRole';
import { AppError } from '@/server/http';
import { createQuiz } from '@/server/quiz/quiz-service';
import { quizSettingsSchema } from '@/lib/validators/quiz';

export const dynamic = 'force-dynamic';

const DAY = 24 * 60 * 60_000;

/** FR-6: creates a DRAFT with defaults (opens tomorrow, closes a week later) and goes straight to the builder. */
export default async function NewQuizPage({ params }: { params: { courseId: string } }) {
  const user = await requirePageRole('TEACHER', 'ADMIN');
  const start = new Date(Math.ceil((Date.now() + DAY) / 3_600_000) * 3_600_000);
  let quizId: string;
  try {
    const input = quizSettingsSchema.parse({ title: 'Untitled quiz', availableFrom: start, availableUntil: new Date(start.getTime() + 7 * DAY) });
    quizId = (await createQuiz(user, params.courseId, input)).id;
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  redirect(`/courses/${params.courseId}/quizzes/${quizId}/edit`);
}
