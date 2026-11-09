import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import { assertCanManageCourse, assertCanViewCourse } from '@/server/auth/course-access';
import type { AccessUser } from '@/server/auth/student-access';
import { resultsVisible, type AttemptState, type Visibility } from './grading';

/**
 * PRD-10 access (FR-34, NFR-5). Quiz resources never reveal existence: every denial is NOT_FOUND,
 * so the course helpers' FORBIDDEN is remapped here.
 */

export const quizNotFound = () => new AppError('NOT_FOUND', 'Quiz not found');
export const attemptNotFound = () => new AppError('NOT_FOUND', 'Attempt not found');

async function hide(check: Promise<void>, notFound: () => AppError): Promise<void> {
  try {
    await check;
  } catch (error) {
    if (error instanceof AppError && (error.code === 'FORBIDDEN' || error.code === 'NOT_FOUND')) throw notFound();
    throw error;
  }
}

export const viewCourseOrNotFound = (user: AccessUser, courseId: string, nf = quizNotFound) => hide(assertCanViewCourse(user, courseId), nf);
export const manageCourseOrNotFound = (user: AccessUser, courseId: string, nf = quizNotFound) => hide(assertCanManageCourse(user, courseId), nf);

export async function canManageCourse(user: AccessUser, courseId: string): Promise<boolean> {
  if (user.role !== 'ADMIN' && user.role !== 'TEACHER') return false;
  try {
    await assertCanManageCourse(user, courseId);
    return true;
  } catch {
    return false;
  }
}

export interface AttemptForAccess {
  studentId: string;
  status: AttemptState;
  quiz: { courseId: string; resultsVisibility: Visibility; availableUntil: Date; resultsReleasedAt: Date | null };
}

export type AttemptViewer = 'OWNER' | 'MANAGER' | 'PARENT';

/**
 * Owner (read/write), course manager (read/write), or linked PARENT (read-only, only once results
 * are visible). Anyone else → NOT_FOUND.
 */
export async function assertCanAccessAttempt(
  user: AccessUser,
  attempt: AttemptForAccess,
  { write = false, now = new Date() }: { write?: boolean; now?: Date } = {},
): Promise<AttemptViewer> {
  if (user.role === 'STUDENT' && attempt.studentId === user.id) return 'OWNER';
  if (await canManageCourse(user, attempt.quiz.courseId)) return 'MANAGER';
  if (!write && user.role === 'PARENT' && resultsVisible(attempt.quiz, attempt, now)) {
    const link = await prisma.parentStudentLink.findFirst({ where: { parentId: user.id, studentId: attempt.studentId }, select: { id: true } });
    if (link) return 'PARENT';
  }
  throw attemptNotFound();
}
