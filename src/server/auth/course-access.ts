import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import type { AccessUser } from '@/server/auth/student-access';

/**
 * PRD-05 FR-18. `user` is whatever requireRole(...) resolved (NFR-7 stand-in
 * until PRD-01 lands). NOT_FOUND for a missing course, FORBIDDEN otherwise.
 */

async function loadCourse(courseId: string) {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, teacherId: true, coTeacherIds: true },
  });
  if (!course) throw new AppError('NOT_FOUND', 'Course not found');
  return course;
}

function teaches(user: AccessUser, course: { teacherId: string; coTeacherIds: string[] }) {
  return course.teacherId === user.id || course.coTeacherIds.includes(user.id);
}

const forbidden = () => new AppError('FORBIDDEN', 'You do not have permission to view this course.');

export async function assertCanViewCourse(user: AccessUser, courseId: string): Promise<void> {
  const course = await loadCourse(courseId);

  switch (user.role) {
    case 'ADMIN':
      return;
    case 'TEACHER':
      if (teaches(user, course)) return;
      throw forbidden();
    case 'STUDENT': {
      const enrollment = await prisma.enrollment.findFirst({
        where: { courseId, studentId: user.id, status: 'ACTIVE' },
        select: { id: true },
      });
      if (enrollment) return;
      throw forbidden();
    }
    case 'PARENT': {
      const enrollment = await prisma.enrollment.findFirst({
        where: { courseId, status: 'ACTIVE', student: { studentLinks: { some: { parentId: user.id } } } },
        select: { id: true },
      });
      if (enrollment) return;
      throw forbidden();
    }
    default:
      throw forbidden();
  }
}

/** ADMIN, teacher or co-teacher — for later PRDs' course write operations. */
export async function assertCanManageCourse(user: AccessUser, courseId: string): Promise<void> {
  const course = await loadCourse(courseId);
  if (user.role === 'ADMIN') return;
  if (user.role === 'TEACHER' && teaches(user, course)) return;
  throw new AppError('FORBIDDEN', 'You do not have permission to manage this course.');
}
