import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { notify } from '@/server/notifications/notify';
import { formatInSchoolTz } from '@/lib/dates';
import { getSchoolTimezone, visibleWhere } from './assignments-service';

/**
 * FR-43 / FR-45 / FR-60 maintenance pass, run on every dispatcher request (system-design §2.3).
 * Idempotent through the AssignmentReminder unique key: insert per (assignment, student, kind)
 * and notify only when the insert succeeded, so concurrent dispatchers send once.
 */

const HOUR = 3_600_000;
// ponytail: missing pass only looks back 8 days; widen or add a cursor if the dispatcher can be down longer.
const MISSING_LOOKBACK_MS = 8 * 24 * HOUR;

type Kind = 'due_soon' | 'missing';

/** ACTIVE enrollees with no submission and no exemption, for assignments in the window. */
async function candidates(dueAt: Prisma.DateTimeFilter, now: Date) {
  const assignments = await prisma.assignment.findMany({
    where: { AND: [visibleWhere(now), { dueAt, submissionType: { not: 'NO_SUBMISSION' } }] },
    select: {
      id: true,
      title: true,
      dueAt: true,
      courseId: true,
      course: { select: { name: true, enrollments: { where: { status: 'ACTIVE' }, select: { studentId: true } } } },
      submissions: { select: { studentId: true } },
      exemptions: { select: { studentId: true } },
    },
  });
  return assignments.map((a) => {
    const done = new Set([...a.submissions, ...a.exemptions].map((r) => r.studentId));
    return { a, studentIds: a.course.enrollments.map((e) => e.studentId).filter((id) => !done.has(id)) };
  });
}

/** True only for the caller that inserted the row. P2003 = the assignment was hard-deleted mid-pass: skip it. */
async function claim(assignmentId: string, studentId: string, kind: Kind): Promise<boolean> {
  try {
    await prisma.assignmentReminder.create({ data: { assignmentId, studentId, kind } });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2003'].includes(error.code)) return false;
    throw error;
  }
}

export async function sendDueReminders(now = new Date()): Promise<{ dueSoon: number; missing: number }> {
  const tz = await getSchoolTimezone();
  let dueSoon = 0;
  let missing = 0;

  for (const { a, studentIds } of await candidates({ gt: now, lte: new Date(now.getTime() + 24 * HOUR) }, now)) {
    for (const studentId of studentIds) {
      if (!(await claim(a.id, studentId, 'due_soon'))) continue;
      dueSoon++;
      await notify({
        type: 'assignment.due_soon',
        userIds: [studentId],
        title: `Due soon: ${a.title}`,
        body: `${a.course.name} — due ${formatInSchoolTz(a.dueAt, 'EEE d MMM, HH:mm', tz)}`,
        link: `/courses/${a.courseId}/assignments/${a.id}`,
      });
    }
  }

  const missingWindow = { gte: new Date(now.getTime() - MISSING_LOOKBACK_MS), lte: new Date(now.getTime() - 24 * HOUR) };
  for (const { a, studentIds } of await candidates(missingWindow, now)) {
    if (studentIds.length === 0) continue;
    const [students, links] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: studentIds } }, select: { id: true, firstName: true, lastName: true } }),
      prisma.parentStudentLink.findMany({ where: { studentId: { in: studentIds } }, select: { studentId: true, parentId: true } }),
    ]);
    for (const student of students) {
      if (!(await claim(a.id, student.id, 'missing'))) continue;
      missing++;
      const parents = links.filter((l) => l.studentId === student.id).map((l) => l.parentId);
      // Parents only (FR-45); email defaults on for this type.
      await notify({
        type: 'assignment.missing',
        userIds: parents,
        title: `Missing assignment: ${a.title}`,
        body: `${student.firstName} ${student.lastName} has not submitted "${a.title}" (${a.course.name}), due ${formatInSchoolTz(a.dueAt, 'EEE d MMM, HH:mm', tz)}.`,
        link: `/assignments?studentId=${student.id}`,
        email: { template: 'generic-notification' },
      });
    }
  }
  return { dueSoon, missing };
}
