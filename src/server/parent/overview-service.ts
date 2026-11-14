import { prisma } from '@/server/db';
import { assertCanViewStudent, type AccessUser } from '@/server/auth/student-access';
import { getScheduleForDate } from '@/server/timetable/timetable-service';
import { getStudentAttendance } from '@/server/attendance/attendance-service';
import { schoolToday } from '@/server/attendance/attendance-rules';
import { listStudentAssignments } from '@/server/assignments/assignments-service';
import { getStudentGrades } from '@/server/gradebook/student-grades-service';
import { audienceWhereForUser } from '@/server/announcements/audience';
import { expandOccurrences } from '@/server/calendar/recurrence';
import { listMyMeetings } from '@/server/conferences/conferences-service';
import { list as listConsentForms } from '@/server/consent-forms/consent-forms-service';
import { addDateDays, schoolMidnight, schoolNow } from '@/lib/dates';
import { outstandingByStudent } from '@/server/fees/reports';

/**
 * PRD-15 child overview (FR-7, FR-9 to FR-16, FR-35, NFR-2). One function per
 * card so the page can stream each in its own Suspense boundary. Callers check
 * access once (assertCanViewStudent); getOverview does it for API consumers.
 * Everything reuses the existing services; "today" is the school-tz date (NFR-8).
 */

const DAY_MS = 86_400_000;
export const OVERVIEW_CARDS = ['today', 'attendance', 'assignments', 'grades', 'announcements', 'events', 'teachers', 'actions', 'fees'] as const;
export type OverviewCard = (typeof OVERVIEW_CARDS)[number];

async function schoolTz(): Promise<string> {
  const s = await prisma.schoolSettings.findUnique({ where: { id: 'singleton' }, select: { timezone: true } });
  return s?.timezone ?? 'UTC';
}

// FR-9
export async function getToday(_user: AccessUser, studentId: string) {
  const tz = await schoolTz();
  const now = new Date();
  const today = schoolToday(now, tz);
  const [dayStart, dayEnd] = [schoolMidnight(today, tz), schoolMidnight(addDateDays(today, 1), tz)];
  const [holiday, schoolDay] = await Promise.all([
    prisma.calendarEvent.findFirst({ where: { isNoSchool: true, recurrence: 'NONE', startAt: { lt: dayEnd }, endAt: { gt: dayStart } }, select: { title: true } }),
    prisma.schoolDay.findUnique({ where: { dayOfWeek: schoolNow(now, tz).isoDay } }),
  ]);
  if (holiday) return { isSchoolDay: false, noSchoolReason: holiday.title, periods: [] };
  if (schoolDay && !schoolDay.isTeaching) return { isSchoolDay: false, noSchoolReason: 'No school today', periods: [] };
  const schedule = await getScheduleForDate({ userId: studentId, role: 'STUDENT' }, now);
  return {
    isSchoolDay: true,
    noSchoolReason: null as string | null,
    periods: schedule.map((s) => ({
      periodName: s.period.name,
      startsAt: s.period.startTime,
      endsAt: s.period.endTime,
      courseName: s.course.name,
      room: s.room?.name ?? null,
      teacherName: `${s.course.teacher.firstName} ${s.course.teacher.lastName}`,
    })),
  };
}

// FR-10
export async function getAttendanceSummary(user: AccessUser, studentId: string) {
  const a = await getStudentAttendance(user, studentId, {});
  return {
    rateTerm: a.summary.term.rate === null ? null : a.summary.term.rate / 100,
    termName: a.summary.term.termName,
    absences: a.summary.term.absent,
    lates: a.summary.term.late,
    last5: a.records.slice(0, 5).map((r) => ({ date: r.date, periodName: r.periodName, status: r.status })),
  };
}

// FR-11
export async function getAssignmentsSummary(user: AccessUser, studentId: string) {
  const { items } = await listStudentAssignments(user, studentId);
  const now = Date.now();
  const row = (r: (typeof items)[number]) => ({ id: r.assignment.id, title: r.assignment.title, courseName: r.assignment.courseName, dueAt: r.assignment.dueAt });
  return {
    missing: items.filter((r) => r.group === 'MISSING').map(row),
    dueNext7Days: items
      .filter((r) => r.group === 'UPCOMING' && Date.parse(r.assignment.dueAt) >= now && Date.parse(r.assignment.dueAt) <= now + 7 * DAY_MS)
      .map(row)
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
  };
}

// FR-12
export async function getRecentGrades(user: AccessUser, studentId: string) {
  const [grades, recent] = await Promise.all([
    getStudentGrades(user, studentId),
    prisma.grade.findMany({
      where: { studentId, score: { not: null }, excused: false, gradeItem: { isVisible: true, term: { academicYear: { isCurrent: true } } } },
      select: { score: true, updatedAt: true, gradeItem: { select: { id: true, title: true, maxPoints: true, course: { select: { name: true } } } } },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    }),
  ]);
  return {
    recent: recent.map((g) => ({
      gradeItemId: g.gradeItem.id,
      title: g.gradeItem.title,
      courseName: g.gradeItem.course.name,
      score: Number(g.score),
      maxScore: Number(g.gradeItem.maxPoints),
      returnedAt: g.updatedAt.toISOString(),
    })),
    courses: grades.courses.map((c) => ({ courseId: c.course.id, courseName: c.course.name, currentPct: c.percent === null ? null : Number(c.percent) })),
  };
}

/** FR-13 partial (ADR-11): PRD-12 announcements don't exist yet. */
export async function listUnreadAnnouncements(_user: AccessUser, _studentId: string): Promise<never[]> {
  return [];
}

// FR-14, FR-35
export async function getUpcomingEvents(user: AccessUser, studentId: string) {
  const tz = await schoolTz();
  const now = new Date();
  const to = new Date(now.getTime() + 90 * DAY_MS);
  const viewer: AccessUser = user.role === 'PARENT' ? user : { id: studentId, role: 'STUDENT' };
  const audience = await audienceWhereForUser(viewer, user.role === 'PARENT' ? { studentIds: [studentId] } : {});
  const [events, meetings] = await Promise.all([
    prisma.calendarEvent.findMany({
      where: { audiences: { some: audience }, startAt: { lt: to }, OR: [{ endAt: { gt: now } }, { recurrence: { not: 'NONE' } }] },
      select: { id: true, title: true, startAt: true, endAt: true, allDay: true, recurrence: true, recurrenceUntil: true },
      take: 50,
    }),
    user.role === 'PARENT' ? listMyMeetings(user, { from: now, to }, { studentId }) : Promise.resolve([]),
  ]);
  const items = [
    ...events.flatMap((e) =>
      expandOccurrences(e, now, to, tz).map((o) => ({ id: e.id, title: e.title, startsAt: o.start.toISOString(), endsAt: o.end.toISOString(), allDay: e.allDay, source: 'calendar' as const })),
    ),
    ...meetings.map((m) => ({ id: m.id, title: m.title, startsAt: m.startsAt, endsAt: m.endsAt, allDay: false, source: 'myMeetings' as const })),
  ];
  return items.sort((a, b) => a.startsAt.localeCompare(b.startsAt)).slice(0, 5);
}

// FR-15
export async function getTeachers(_user: AccessUser, studentId: string) {
  const enrollments = await prisma.enrollment.findMany({
    where: { studentId, status: 'ACTIVE', course: { archivedAt: null, academicYear: { isCurrent: true } } },
    select: { course: { select: { subject: { select: { name: true } }, teacher: { select: { id: true, firstName: true, lastName: true } } } } },
  });
  const byTeacher = new Map<string, { userId: string; name: string; subjects: Set<string> }>();
  for (const { course } of enrollments) {
    const t = byTeacher.get(course.teacher.id) ?? { userId: course.teacher.id, name: `${course.teacher.firstName} ${course.teacher.lastName}`, subjects: new Set<string>() };
    t.subjects.add(course.subject.name);
    byTeacher.set(t.userId, t);
  }
  return [...byTeacher.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    // ponytail: /messages has no ?to= prefill yet; the link lands on Messages where "New message" opens compose.
    .map((t) => ({ userId: t.userId, name: t.name, subjects: [...t.subjects].sort(), messageHref: `/messages?to=${t.userId}` }));
}

// FR-16
export async function getActionItems(user: AccessUser, studentId: string) {
  if (user.role !== 'PARENT') return [];
  const now = new Date();
  const [consent, profile] = await Promise.all([
    listConsentForms(user, { pending: true, studentId, sort: { field: 'dueAt', dir: 'asc' } }, { page: 1, pageSize: 20, skip: 0, take: 20 }),
    prisma.studentProfile.findUnique({ where: { userId: studentId }, select: { gradeLevelId: true } }),
  ]);
  const conferences = profile
    ? await prisma.conferenceEvent.findMany({
        where: {
          gradeLevelIds: { has: profile.gradeLevelId },
          bookingOpensAt: { lte: now },
          bookingClosesAt: { gt: now },
          NOT: { slots: { some: { bookedForStudentId: studentId } } },
        },
        select: { id: true, title: true, bookingClosesAt: true },
        orderBy: { bookingClosesAt: 'asc' },
      })
    : [];
  return [
    ...consent.rows.map((f) => ({ type: 'consent' as const, id: f.id, title: f.title, dueAt: f.dueAt, href: `/consent-forms/${f.id}` })),
    ...conferences.map((c) => ({ type: 'conference' as const, id: c.id, title: c.title, dueAt: c.bookingClosesAt.toISOString(), href: `/conferences/${c.id}?studentId=${studentId}` })),
  ];
}

// PRD-17 FR-40: null when nothing is owed (the card is hidden). Callers have already checked access.
export async function getFeesSummary(_user: AccessUser, studentId: string) {
  const { byStudent, currency } = await outstandingByStudent([studentId]);
  const outstanding = byStudent.get(studentId);
  return outstanding && outstanding !== '0.00' ? { outstanding, currency, href: '/fees' } : null;
}

const CARD_FNS = {
  today: getToday,
  attendance: getAttendanceSummary,
  assignments: getAssignmentsSummary,
  grades: getRecentGrades,
  announcements: listUnreadAnnouncements,
  events: getUpcomingEvents,
  teachers: getTeachers,
  actions: getActionItems,
  fees: getFeesSummary,
} satisfies Record<OverviewCard, (user: AccessUser, studentId: string) => Promise<unknown>>;

/** GET /api/students/:id/overview: the same functions the streaming page uses. */
export async function getOverview(user: AccessUser, studentId: string, cards: readonly OverviewCard[] = OVERVIEW_CARDS) {
  await assertCanViewStudent(user, studentId);
  const entries = await Promise.all(cards.map(async (c) => [c, await CARD_FNS[c](user, studentId)] as const));
  return Object.fromEntries(entries);
}

// FR-7
export async function getChildrenSummary(parent: AccessUser) {
  const links = await prisma.parentStudentLink.findMany({
    where: { parentId: parent.id },
    select: {
      student: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          sectionMemberships: { where: { section: { academicYear: { isCurrent: true } } }, select: { section: { select: { name: true } } } },
        },
      },
    },
    orderBy: [{ student: { firstName: 'asc' } }, { student: { lastName: 'asc' } }],
  });
  return Promise.all(
    links.map(async ({ student: s }) => {
      const [attendance, assignments, grades] = await Promise.all([
        getAttendanceSummary(parent, s.id),
        getAssignmentsSummary(parent, s.id),
        getStudentGrades(parent, s.id),
      ]);
      const pcts = grades.courses.flatMap((c) => (c.percent === null ? [] : [Number(c.percent)]));
      return {
        student: { id: s.id, firstName: s.firstName, lastName: s.lastName, avatarUrl: null as string | null, sectionName: s.sectionMemberships[0]?.section.name ?? null },
        attendanceRateTerm: attendance.rateTerm,
        missingAssignments: assignments.missing.length,
        averageGradePct: pcts.length ? Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 10) / 10 : null,
      };
    }),
  );
}
