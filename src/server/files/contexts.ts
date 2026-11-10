import { prisma } from '@/server/db';
import { assertCanViewCourse } from '@/server/auth/course-access';
import { canSeeDrafts, isLessonVisible } from '@/server/content/visibility';
import { isAssignmentVisible } from '@/server/assignments/assignments-service';
import type { FileAccessResolver } from './access';

/**
 * Built-in file contexts (PRD-08 FR-10). Registered lazily by access.ts on
 * first canAccessFile call, so every caller gets them.
 */

/** 'lesson': the caller can view the course and (unless they manage it) the lesson is visible. */
export const lessonResolver: FileAccessResolver = async (user, file) => {
  if (!user || !file.contextId) return false;
  const lesson = await prisma.lesson.findUnique({
    where: { id: file.contextId },
    select: {
      status: true,
      publishAt: true,
      module: {
        select: { status: true, publishAt: true, course: { select: { id: true, teacherId: true, coTeacherIds: true } } },
      },
    },
  });
  if (!lesson) return false;
  try {
    await assertCanViewCourse(user as Parameters<typeof assertCanViewCourse>[0], lesson.module.course.id);
  } catch {
    return false;
  }
  return canSeeDrafts(user, lesson.module.course) || isLessonVisible(lesson, lesson.module, new Date());
};

/** 'assignment' (PRD-09 FR-47): the caller can view the course and (unless they manage it) the assignment is visible. */
export const assignmentResolver: FileAccessResolver = async (user, file) => {
  if (!user || !file.contextId) return false;
  const a = await prisma.assignment.findUnique({
    where: { id: file.contextId },
    select: { status: true, availableFrom: true, archivedAt: true, course: { select: { id: true, teacherId: true, coTeacherIds: true } } },
  });
  if (!a) return false;
  try {
    await assertCanViewCourse(user as Parameters<typeof assertCanViewCourse>[0], a.course.id);
  } catch {
    return false;
  }
  return canSeeDrafts(user, a.course) || isAssignmentVisible(a, new Date());
};

/**
 * 'submission' (PRD-09 FR-47, NFR-4): the submitting student, their linked parents, or a course
 * manager (ADMIN / teacher / co-teacher). Everyone else, including other students, is denied.
 */
export const submissionResolver: FileAccessResolver = async (user, file) => {
  if (!user || !file.contextId) return false;
  const sub = await prisma.submission.findUnique({
    where: { id: file.contextId },
    select: { studentId: true, assignment: { select: { course: { select: { teacherId: true, coTeacherIds: true } } } } },
  });
  if (!sub) return false;
  if (sub.studentId === user.id) return true;
  if (canSeeDrafts(user, sub.assignment.course)) return true;
  if (user.role !== 'PARENT') return false;
  const link = await prisma.parentStudentLink.findFirst({ where: { parentId: user.id, studentId: sub.studentId }, select: { id: true } });
  return link !== null;
};

/** 'quiz' (PRD-10 FR-39): a course manager, or a course viewer once the quiz is PUBLISHED/CLOSED (images live only in prompts). */
export const quizResolver: FileAccessResolver = async (user, file) => {
  if (!user || !file.contextId) return false;
  const q = await prisma.quiz.findUnique({
    where: { id: file.contextId },
    select: { status: true, course: { select: { id: true, teacherId: true, coTeacherIds: true } } },
  });
  if (!q) return false;
  try {
    await assertCanViewCourse(user as Parameters<typeof assertCanViewCourse>[0], q.course.id);
  } catch {
    return false;
  }
  return canSeeDrafts(user, q.course) || q.status !== 'DRAFT';
};

/**
 * 'message' (PRD-13 FR-27, A7): a participant of the message's conversation who has not left, or an
 * ACTIVE ADMIN safeguarding lead (flag read from the DB). Errors deny (canAccessFile catches).
 */
export const messageResolver: FileAccessResolver = async (user, file) => {
  if (!user || !file.contextId) return false;
  const m = await prisma.message.findUnique({ where: { id: file.contextId }, select: { conversationId: true } });
  if (!m) return false;
  const p = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId: m.conversationId, userId: user.id } },
    select: { leftAt: true },
  });
  if (p && !p.leftAt) return true;
  if (user.role !== 'ADMIN') return false;
  const lead = await prisma.user.findUnique({ where: { id: user.id }, select: { isSafeguardingLead: true, status: true } });
  return !!lead?.isSafeguardingLead && lead.status === 'ACTIVE';
};

/**
 * 'absence-note' (PRD-15 FR-41): any parent linked to the note's student, the student's
 * current homeroom teacher, or ADMIN. Lazy import: absence-notes-service → files-service → access → here.
 */
export const absenceNoteResolver: FileAccessResolver = async (user, file) => {
  if (!user || !file.contextId) return false;
  if (user.role === 'ADMIN') return true;
  const note = await prisma.absenceNote.findUnique({ where: { id: file.contextId }, select: { studentId: true } });
  if (!note) return false;
  if (user.role === 'PARENT') {
    const link = await prisma.parentStudentLink.findFirst({ where: { parentId: user.id, studentId: note.studentId }, select: { id: true } });
    return link !== null;
  }
  if (user.role !== 'TEACHER') return false;
  const { homeroomTeacherOf } = await import('@/server/absence-notes/absence-notes-service');
  return (await homeroomTeacherOf(note.studentId)) === user.id;
};

/** 'logo': public, including anonymous (app shell, login page, emails). */
export const logoResolver: FileAccessResolver = () => true;

export function registerBuiltInContexts(register: (context: string, resolver: FileAccessResolver) => void): void {
  register('lesson', lessonResolver);
  register('logo', logoResolver);
  register('assignment', assignmentResolver);
  register('submission', submissionResolver);
  register('quiz', quizResolver);
  register('message', messageResolver);
  register('absence-note', absenceNoteResolver);
}
