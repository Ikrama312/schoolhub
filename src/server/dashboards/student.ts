import { prisma } from '@/server/db';
import type { AccessUser } from '@/server/auth/student-access';
import { getToday, getRecentGrades as overviewRecentGrades } from '@/server/parent/overview-service';
import { getStudentGrades } from '@/server/gradebook/student-grades-service';
import { getSchoolTimezone, visibleWhere } from '@/server/assignments/assignments-service';
import { countStatuses, type Status } from '@/server/attendance/attendance-rules';
import { isLessonVisible } from '@/server/content/visibility';
import { addDateDays, nowAndNext, schoolDateOf, schoolMidnight, schoolNow } from '@/lib/dates';
import { missingWork } from './missing-work';
import { currentTerm } from './insights';

/** PRD-16 student dashboard (FR-10–FR-15). The caller's own data; nothing is cached. */

/** FR-10: today's schedule (holiday-aware) with NOW/NEXT badges. */
export async function getStudentToday(user: AccessUser) {
  const [today, tz] = await Promise.all([getToday(user, user.id), getSchoolTimezone()]);
  const periods = today.periods.map((p) => ({ ...p, startTime: p.startsAt, endTime: p.endsAt }));
  const { now, next } = nowAndNext(periods, schoolNow(new Date(), tz).hhmm);
  return {
    isSchoolDay: today.isSchoolDay,
    holidayName: today.noSchoolReason,
    items: periods.map((p, i) => ({
      slotId: String(i),
      periodName: p.periodName,
      startTime: p.startTime,
      endTime: p.endTime,
      courseName: p.courseName,
      roomName: p.room,
      teacherName: p.teacherName,
      badge: p === now ? ('NOW' as const) : p === next ? ('NEXT' as const) : null,
    })),
  };
}

/** FR-11: overdue (missing since term start) first, then everything due in the next 7 days. */
export async function getDueSoon(user: AccessUser) {
  const now = new Date();
  const [tz, term] = await Promise.all([getSchoolTimezone(), currentTerm(now)]);
  const until = schoolMidnight(addDateDays(schoolDateOf(now, tz), 8), tz);
  const myCourse = { enrollments: { some: { studentId: user.id, status: 'ACTIVE' as const } } };

  const [assignments, quizzes, missing] = await Promise.all([
    prisma.assignment.findMany({
      where: {
        AND: [
          visibleWhere(now),
          { dueAt: { gte: now, lt: until }, course: myCourse, submissions: { none: { studentId: user.id } }, exemptions: { none: { studentId: user.id } } },
        ],
      },
      select: { id: true, title: true, dueAt: true, courseId: true, course: { select: { name: true } } },
    }),
    prisma.quiz.findMany({
      where: {
        status: 'PUBLISHED',
        availableFrom: { lte: now },
        availableUntil: { gte: now, lt: until },
        course: myCourse,
        attempts: { none: { studentId: user.id, status: { not: 'IN_PROGRESS' } } },
      },
      select: { id: true, title: true, availableUntil: true, course: { select: { name: true } } },
    }),
    term ? missingWork({ studentIds: [user.id], from: term.startDate, to: now, now }) : Promise.resolve(new Map()),
  ]);

  const missingIds = (missing.get(user.id) ?? []).map((m: { assignmentId: string }) => m.assignmentId);
  const overdue = missingIds.length
    ? await prisma.assignment.findMany({
        where: { id: { in: missingIds } },
        select: { id: true, title: true, dueAt: true, courseId: true, course: { select: { name: true } } },
      })
    : [];

  const assignmentRow = (a: (typeof assignments)[number], isOverdue: boolean) => ({
    kind: 'ASSIGNMENT' as const,
    id: a.id,
    title: a.title,
    courseName: a.course.name,
    dueAt: a.dueAt.toISOString(),
    overdue: isOverdue,
    href: `/courses/${a.courseId}/assignments/${a.id}`,
  });
  const byDue = (a: { dueAt: string }, b: { dueAt: string }) => a.dueAt.localeCompare(b.dueAt);
  return [
    ...overdue.map((a) => assignmentRow(a, true)).sort(byDue),
    ...[
      ...assignments.map((a) => assignmentRow(a, false)),
      ...quizzes.map((q) => ({
        kind: 'QUIZ' as const,
        id: q.id,
        title: q.title,
        courseName: q.course.name,
        dueAt: q.availableUntil.toISOString(),
        overdue: false,
        href: `/quizzes/${q.id}/take`,
      })),
    ].sort(byDue),
  ];
}

/** FR-12: last 5 grades, through the parent overview service. */
export async function getRecentGrades(user: AccessUser) {
  const { recent } = await overviewRecentGrades(user, user.id);
  return recent.map((g) => ({
    gradeItemId: g.gradeItemId,
    title: g.title,
    courseName: g.courseName,
    percent: g.maxScore > 0 ? Math.round((g.score / g.maxScore) * 1000) / 10 : null,
    gradedAt: g.returnedAt,
  }));
}

/** FR-13: percent/letter (same calc as the Grades tab), lesson progress and the next lesson. */
export async function getMyCourses(user: AccessUser) {
  const now = new Date();
  const grades = await getStudentGrades(user, user.id);
  const courseIds = grades.courses.map((c) => c.course.id);
  const [lessons, progress] = await Promise.all([
    prisma.lesson.findMany({
      where: { module: { courseId: { in: courseIds } } },
      select: { id: true, status: true, publishAt: true, module: { select: { courseId: true, status: true, publishAt: true } } },
      orderBy: [{ module: { order: 'asc' } }, { order: 'asc' }],
    }),
    prisma.lessonProgress.findMany({
      where: { studentId: user.id, completedAt: { not: null }, lesson: { module: { courseId: { in: courseIds } } } },
      select: { lessonId: true },
    }),
  ]);
  const done = new Set(progress.map((p) => p.lessonId));
  const visible = lessons.filter((l) => isLessonVisible(l, l.module, now));

  return grades.courses.map((c) => {
    const mine = visible.filter((l) => l.module.courseId === c.course.id);
    const nextLesson = mine.find((l) => !done.has(l.id));
    return {
      courseId: c.course.id,
      courseName: c.course.name,
      percent: c.percent === null ? null : Number(c.percent),
      letter: c.letter,
      progress: { completed: mine.filter((l) => done.has(l.id)).length, total: mine.length },
      // No per-lesson page exists yet; the course page lists the lessons.
      nextLessonHref: nextLesson ? `/courses/${c.course.id}` : null,
    };
  });
}

/** FR-15: attendance rate over the current term up to today. */
export async function getTermAttendance(user: AccessUser) {
  const now = new Date();
  const [tz, term] = await Promise.all([getSchoolTimezone(), currentTerm(now)]);
  if (!term) return { rate: null, present: 0, total: 0 };
  const settings = await prisma.schoolSettings.findUnique({ where: { id: 'singleton' }, select: { attendanceMode: true } });
  const today = schoolDateOf(now, tz);
  const end = term.endDate.toISOString().slice(0, 10) < today ? term.endDate : new Date(`${today}T00:00:00Z`);
  const records = await prisma.attendanceRecord.findMany({
    where: {
      studentId: user.id,
      session: {
        date: { gte: term.startDate, lte: end },
        ...(settings?.attendanceMode === 'DAILY_HOMEROOM' ? { sectionId: { not: null } } : { courseId: { not: null } }),
      },
    },
    select: { status: true },
  });
  const c = countStatuses(records.map((r) => r.status as Status));
  return { rate: c.rate, present: c.present + c.late + c.excused, total: c.records };
}
