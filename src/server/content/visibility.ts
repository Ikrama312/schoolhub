import type { AssignmentStatus, ContentStatus } from '@prisma/client';

/**
 * Single source of truth for content visibility (PRD-08 FR-18, FR-19, FR-44).
 * Pure: evaluated at read time, no background job. Used by list, get,
 * prev/next, file access, progress and the Learning tab.
 */

export interface Publishable {
  /** PRD-09 reuses this for assignments: same DRAFT/SCHEDULED/PUBLISHED values. */
  status: ContentStatus | AssignmentStatus;
  publishAt: Date | null;
}

export function isVisible(item: Publishable, now: Date): boolean {
  if (item.status === 'PUBLISHED') return true;
  return item.status === 'SCHEDULED' && item.publishAt !== null && item.publishAt.getTime() <= now.getTime();
}

/** A lesson is visible to students/parents only when it AND its module are visible. */
export function isLessonVisible(lesson: Publishable, module: Publishable, now: Date): boolean {
  return isVisible(module, now) && isVisible(lesson, now);
}

/** ADMIN, or the course's teacher/co-teacher, see drafts and scheduled items. */
export function canSeeDrafts(
  user: { id: string; role: string },
  course: { teacherId: string; coTeacherIds: string[] },
): boolean {
  if (user.role === 'ADMIN') return true;
  return user.role === 'TEACHER' && (course.teacherId === user.id || course.coTeacherIds.includes(user.id));
}
