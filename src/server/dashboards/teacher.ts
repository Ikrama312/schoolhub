import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import type { AccessUser } from '@/server/auth/student-access';
import { getToday } from '@/server/attendance/attendance-service';
import { getScheduleForDate } from '@/server/timetable/timetable-service';
import { getSchoolTimezone, visibleWhere } from '@/server/assignments/assignments-service';
import { unreadCount } from '@/server/messaging/conversations';
import { addDateDays, nowAndNext, schoolDateOf, schoolMidnight, schoolNow } from '@/lib/dates';
import { ANNOUNCEMENTS_AVAILABLE, latestAnnouncements } from './announcements';
import { cached, TAGS } from './insights';

/** PRD-16 teacher dashboard (FR-4–FR-8). Scoped to courses the caller teaches or co-teaches. */

const myCourses = (user: AccessUser): Prisma.CourseWhereInput => ({
  archivedAt: null,
  academicYear: { isCurrent: true },
  OR: [{ teacherId: user.id }, { coTeacherIds: { has: user.id } }],
});
const name = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`;

/** FR-4: live (not cached) so the taken/not-taken state is current. */
export async function getTodaysClasses(user: AccessUser) {
  const now = new Date();
  const [today, schedule, tz] = await Promise.all([getToday(user), getScheduleForDate({ userId: user.id, role: 'TEACHER' }, now), getSchoolTimezone()]);
  const rooms = new Map(schedule.map((s) => [`${s.course.id}:${s.period.id}`, s.room?.name ?? null]));
  const { now: current, next } = nowAndNext(today.meetings, schoolNow(now, tz).hhmm);
  return today.meetings.map((m) => ({
    slotId: `${m.courseId}:${m.periodId}`,
    periodName: m.periodName,
    startTime: m.startTime,
    endTime: m.endTime,
    courseId: m.courseId,
    courseName: m.courseName,
    sectionName: m.sectionName || null,
    roomName: rooms.get(`${m.courseId}:${m.periodId}`) ?? null,
    badge: m === current ? ('NOW' as const) : m === next ? ('NEXT' as const) : null,
    attendanceTaken: m.taken !== null,
    takeAttendanceHref: `/attendance/take/${m.courseId}?date=${today.date}&periodId=${m.periodId}`,
    courseHref: `/courses/${m.courseId}`,
  }));
}

/** FR-5: ungraded submissions + quiz attempts needing manual grading; count and the 5 oldest. */
export function getToGrade(user: AccessUser) {
  return cached(
    async () => {
      const subWhere: Prisma.SubmissionWhereInput = {
        status: 'SUBMITTED',
        gradedAt: null,
        attemptNumber: { gt: 0 },
        assignment: { archivedAt: null, course: myCourses(user) },
      };
      const attemptWhere: Prisma.QuizAttemptWhereInput = { status: 'NEEDS_GRADING', quiz: { course: myCourses(user) } };
      const [subCount, attemptCount, subs, attempts] = await Promise.all([
        prisma.submission.count({ where: subWhere }),
        prisma.quizAttempt.count({ where: attemptWhere }),
        prisma.submission.findMany({
          where: subWhere,
          select: {
            id: true,
            submittedAt: true,
            student: { select: { firstName: true, lastName: true } },
            assignment: { select: { id: true, title: true, courseId: true, course: { select: { name: true } } } },
          },
          orderBy: { submittedAt: 'asc' },
          take: 5,
        }),
        prisma.quizAttempt.findMany({
          where: attemptWhere,
          select: {
            id: true,
            submittedAt: true,
            startedAt: true,
            student: { select: { firstName: true, lastName: true } },
            quiz: { select: { id: true, title: true, courseId: true, course: { select: { name: true } } } },
          },
          orderBy: { submittedAt: 'asc' },
          take: 5,
        }),
      ]);
      const items = [
        ...subs.map((s) => ({
          kind: 'SUBMISSION' as const,
          id: s.id,
          title: s.assignment.title,
          studentName: name(s.student),
          courseName: s.assignment.course.name,
          submittedAt: s.submittedAt.toISOString(),
          href: `/courses/${s.assignment.courseId}/assignments/${s.assignment.id}/grade`,
        })),
        ...attempts.map((a) => ({
          kind: 'QUIZ_ATTEMPT' as const,
          id: a.id,
          title: a.quiz.title,
          studentName: name(a.student),
          courseName: a.quiz.course.name,
          submittedAt: (a.submittedAt ?? a.startedAt).toISOString(),
          href: `/courses/${a.quiz.courseId}/quizzes/${a.quiz.id}/grade`,
        })),
      ]
        .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))
        .slice(0, 5);
      return { count: subCount + attemptCount, items };
    },
    ['dash', 'teacher', user.id, 'to-grade'],
    { revalidate: 900, tags: [TAGS.teacher] },
  );
}

/** FR-6: assignments and quizzes due in the next 7 school days, with submission rate. */
export function getUpcomingDeadlines(user: AccessUser) {
  return cached(
    async () => {
      const now = new Date();
      const tz = await getSchoolTimezone();
      const until = schoolMidnight(addDateDays(schoolDateOf(now, tz), 8), tz);
      const [assignments, quizzes] = await Promise.all([
        prisma.assignment.findMany({
          where: { AND: [visibleWhere(now), { dueAt: { gte: now, lt: until }, course: myCourses(user) }] },
          select: { id: true, title: true, dueAt: true, courseId: true, course: { select: { name: true } } },
        }),
        prisma.quiz.findMany({
          where: { status: 'PUBLISHED', isPractice: false, availableUntil: { gte: now, lt: until }, course: myCourses(user) },
          select: { id: true, title: true, availableUntil: true, courseId: true, course: { select: { name: true } } },
        }),
      ]);
      const courseIds = [...new Set([...assignments, ...quizzes].map((x) => x.courseId))];
      if (!courseIds.length) return [];
      const [enrolled, submitted, attempted] = await Promise.all([
        prisma.enrollment.groupBy({ by: ['courseId'], where: { courseId: { in: courseIds }, status: 'ACTIVE' }, _count: { _all: true } }),
        prisma.submission.groupBy({ by: ['assignmentId'], where: { assignmentId: { in: assignments.map((a) => a.id) }, attemptNumber: { gt: 0 } }, _count: { _all: true } }),
        prisma.quizAttempt.groupBy({ by: ['quizId', 'studentId'], where: { quizId: { in: quizzes.map((q) => q.id) }, status: { not: 'IN_PROGRESS' } } }),
      ]);
      const expectedOf = new Map(enrolled.map((e) => [e.courseId, e._count._all]));
      const subsOf = new Map(submitted.map((s) => [s.assignmentId, s._count._all]));
      const quizSubs = new Map<string, number>();
      for (const a of attempted) quizSubs.set(a.quizId, (quizSubs.get(a.quizId) ?? 0) + 1);
      const row = (kind: 'ASSIGNMENT' | 'QUIZ', x: { id: string; title: string; courseId: string; course: { name: string } }, dueAt: Date, done: number) => {
        const expected = expectedOf.get(x.courseId) ?? 0;
        return {
          kind,
          id: x.id,
          title: x.title,
          courseName: x.course.name,
          dueAt: dueAt.toISOString(),
          submitted: done,
          expected,
          submissionRate: expected ? Math.round((done / expected) * 1000) / 10 : 0,
          href: kind === 'ASSIGNMENT' ? `/courses/${x.courseId}/assignments/${x.id}` : `/courses/${x.courseId}/quizzes`,
        };
      };
      return [
        ...assignments.map((a) => row('ASSIGNMENT', a, a.dueAt, subsOf.get(a.id) ?? 0)),
        ...quizzes.map((q) => row('QUIZ', q, q.availableUntil, quizSubs.get(q.id) ?? 0)),
      ].sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    },
    ['dash', 'teacher', user.id, 'deadlines'],
    { revalidate: 900, tags: [TAGS.teacher] },
  );
}

/** FR-8: unread conversations + announcements (PRD-12 gap → empty). */
export async function getTeacherMessages(user: AccessUser) {
  const [count, announcements] = await Promise.all([unreadCount(user.id), latestAnnouncements()]);
  return { unreadCount: count, announcementsAvailable: ANNOUNCEMENTS_AVAILABLE, announcements };
}
