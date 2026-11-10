import { prisma } from '@/server/db';
import { isLessonVisible } from '@/server/content/visibility';
import { ANNOUNCEMENTS_AVAILABLE } from '@/server/dashboards/announcements';
import type { EngagementFilters } from '@/lib/validators/reports';
import type { ReportContext, ReportOutput } from './index';

/**
 * PRD-16 FR-38: lesson completion by course and parent sign-ins over 7 / 30 days
 * (AuditLog auth.login.success, with User.lastLoginAt as a fallback). The announcement
 * read rate is omitted until PRD-12 lands.
 */

const DAY = 86_400_000;

async function run(_f: EngagementFilters, ctx: ReportContext): Promise<ReportOutput> {
  const now = new Date();
  const courses = await prisma.course.findMany({
    where: { academicYearId: ctx.year.id, archivedAt: null },
    select: {
      id: true,
      name: true,
      enrollments: { where: { status: 'ACTIVE' }, select: { studentId: true } },
      modules: { select: { status: true, publishAt: true, lessons: { select: { id: true, status: true, publishAt: true } } } },
    },
    orderBy: { name: 'asc' },
  });
  const lessonIds = courses.flatMap((c) => c.modules.flatMap((m) => m.lessons.filter((l) => isLessonVisible(l, m, now)).map((l) => l.id)));
  const progress = lessonIds.length
    ? await prisma.lessonProgress.findMany({ where: { lessonId: { in: lessonIds }, completedAt: { not: null } }, select: { lessonId: true, studentId: true } })
    : [];

  const rows = courses.map((c) => {
    const lessons = new Set(c.modules.flatMap((m) => m.lessons.filter((l) => isLessonVisible(l, m, now)).map((l) => l.id)));
    const students = new Set(c.enrollments.map((e) => e.studentId));
    const completed = progress.filter((p) => lessons.has(p.lessonId) && students.has(p.studentId)).length;
    const possible = lessons.size * students.size;
    return { course: c.name, lessons: lessons.size, completedLessonProgress: completed, completionRate: possible ? Math.round((completed / possible) * 1000) / 10 : null };
  });

  const parents = await prisma.user.findMany({ where: { role: 'PARENT', status: 'ACTIVE', archivedAt: null }, select: { id: true, lastLoginAt: true } });
  const since30 = new Date(now.getTime() - 30 * DAY);
  const since7 = new Date(now.getTime() - 7 * DAY);
  const logins = parents.length
    ? await prisma.auditLog.findMany({
        where: { action: 'auth.login.success', createdAt: { gte: since30 }, actorId: { in: parents.map((p) => p.id) } },
        select: { actorId: true, createdAt: true },
      })
    : [];
  const signedInSince = (since: Date) =>
    new Set([...logins.filter((l) => l.createdAt >= since).map((l) => l.actorId!), ...parents.filter((p) => p.lastLoginAt && p.lastLoginAt >= since).map((p) => p.id)]).size;
  const parentsSignedIn7d = signedInSince(since7);
  const parentsSignedIn30d = signedInSince(since30);

  return {
    rows,
    charts: [
      {
        kind: 'bar',
        summary: rows.length ? `Lesson completion by course: ${rows.map((r) => `${r.course} ${r.completionRate ?? 0} %`).join(', ')}` : 'No courses this year',
        xAxis: rows.map((r) => r.course),
        series: [{ id: 'completion', label: 'Lesson completion %', data: rows.map((r) => r.completionRate) }],
      },
    ],
    summary: { parentsSignedIn7d, parentsSignedIn30d, totalParents: parents.length },
    notes: ANNOUNCEMENTS_AVAILABLE ? [] : ['Announcement read rate is not available yet (announcements have not been released).'],
  };
}

export const report = {
  title: 'Engagement',
  description: 'Lesson completion by course and parent sign-ins over the last 7 and 30 days.',
  columns: [
    { key: 'course', header: 'Course' },
    { key: 'lessons', header: 'Visible lessons' },
    { key: 'completedLessonProgress', header: 'Lessons completed' },
    { key: 'completionRate', header: 'Completion %' },
  ],
  run,
};
