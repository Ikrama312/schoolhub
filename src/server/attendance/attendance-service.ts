import { Prisma, type AttendanceMode } from '@prisma/client';
import { fromZonedTime } from 'date-fns-tz';
import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import { audit } from '@/server/audit';
import { assertCanManageCourse } from '@/server/auth/course-access';
import { assertCanViewStudent, type AccessUser } from '@/server/auth/student-access';
import { notify, notifyStudentAndParents } from '@/server/notifications/notify';
import { getScheduleForDate, getSchoolScheduleForDate } from '@/server/timetable/timetable-service';
import { formatInSchoolTz, schoolNow } from '@/lib/dates';
import type { RegisterKey, RegisterRecordInput, ReportFilters } from '@/lib/validators/attendance';
import {
  addDays,
  canEdit,
  canOpen,
  countStatuses,
  dayColour,
  diffRecords,
  notificationsFor,
  schoolToday,
  type Rec,
  type Status,
  type StatusCounts,
} from './attendance-rules';

/**
 * PRD-07 attendance service (FR-37). The only writer of AttendanceSession /
 * AttendanceRecord. Route handlers and server pages stay thin.
 *
 * Deliberately does not import services/settings.ts: its react.cache()
 * wrapper is undefined outside Next, and the integration test imports this.
 */

type Tx = Prisma.TransactionClient;
type CourseKey = { courseId: string; date: string; periodId: string };
const isCourseKey = (k: RegisterKey): k is CourseKey => 'courseId' in k;

const toDbDate = (d: string) => new Date(`${d}T00:00:00Z`);
const fromDbDate = (d: Date) => d.toISOString().slice(0, 10);
/** A Date that falls on `d` in any timezone within ±11h -- for weekday lookups. */
const middayOf = (d: string) => new Date(`${d}T12:00:00Z`);
const fullName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`;
const userRef = (u: { id: string; firstName: string; lastName: string } | null) => (u ? { id: u.id, name: fullName(u) } : null);
const longDate = (d: string) => formatInSchoolTz(toDbDate(d), 'EEEE d MMM yyyy', 'UTC');

async function loadSettings() {
  const s = await prisma.schoolSettings.upsert({ where: { id: 'singleton' }, update: {}, create: { id: 'singleton' } });
  return { tz: s.timezone, mode: s.attendanceMode, threshold: s.attendanceAlertThreshold };
}

/** FR-28: which session kind counts toward rates for the configured mode. */
function kindWhere(mode: AttendanceMode): Prisma.AttendanceSessionWhereInput {
  return mode === 'DAILY_HOMEROOM' ? { sectionId: { not: null } } : { courseId: { not: null } };
}

/** FR-15: ADMIN or the section's homeroom teacher. Private to this module. */
async function assertCanManageSection(user: AccessUser, sectionId: string) {
  const section = await prisma.section.findUnique({ where: { id: sectionId }, select: { id: true, name: true, homeroomTeacherId: true } });
  if (!section) throw new AppError('NOT_FOUND', 'Section not found');
  if (user.role === 'ADMIN' || (user.role === 'TEACHER' && section.homeroomTeacherId === user.id)) return section;
  throw new AppError('FORBIDDEN', 'You do not have permission to take this register.');
}

/** Access check + header labels. NOT_FOUND for a missing course/section/period. */
async function loadKey(user: AccessUser, key: RegisterKey) {
  if (isCourseKey(key)) {
    await assertCanManageCourse(user, key.courseId);
    const [course, period] = await Promise.all([
      prisma.course.findUnique({ where: { id: key.courseId }, select: { name: true, section: { select: { name: true } } } }),
      prisma.period.findUnique({ where: { id: key.periodId }, select: { name: true } }),
    ]);
    if (!course) throw new AppError('NOT_FOUND', 'Course not found');
    if (!period) throw new AppError('NOT_FOUND', 'Period not found');
    return { courseName: course.name, sectionName: course.section?.name ?? '', periodName: period.name as string | null, date: key.date };
  }
  const section = await assertCanManageSection(user, key.sectionId);
  return { courseName: null as string | null, sectionName: section.name, periodName: null as string | null, date: key.date };
}

function assertOpen(user: AccessUser, date: string, today: string) {
  const open = canOpen(user.role, date, today);
  if (!open.ok) throw new AppError(open.code === 'FUTURE' ? 'VALIDATION_ERROR' : 'FORBIDDEN', open.reason);
}

/** NFR-3 / FR-9: students active on `date`, sorted by last name. */
async function activeRoster(db: Tx, key: RegisterKey, tz: string) {
  const student = { select: { id: true, firstName: true, lastName: true } } as const;
  let students: { id: string; firstName: string; lastName: string }[];
  if (isCourseKey(key)) {
    // enrolledAt::date <= date AND (ACTIVE OR droppedAt::date > date), dates in the school timezone.
    const nextDay = fromZonedTime(`${addDays(key.date, 1)}T00:00:00`, tz);
    const rows = await db.enrollment.findMany({
      where: { courseId: key.courseId, enrolledAt: { lt: nextDay }, OR: [{ status: 'ACTIVE' }, { droppedAt: { gte: nextDay } }] },
      select: { student },
    });
    students = rows.map((r) => r.student);
  } else {
    const rows = await db.sectionMember.findMany({ where: { sectionId: key.sectionId }, select: { student } });
    students = rows.map((r) => r.student);
  }
  return students.sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
}

function sessionWhere(key: RegisterKey): Prisma.AttendanceSessionWhereInput {
  return isCourseKey(key)
    ? { courseId: key.courseId, periodId: key.periodId, date: toDbDate(key.date) }
    : { sectionId: key.sectionId, date: toDbDate(key.date) };
}

const toRec = (r: { studentId: string; status: Status; minutesLate: number | null; note: string | null }): Rec => ({
  studentId: r.studentId,
  status: r.status,
  minutesLate: r.minutesLate,
  note: r.note,
});

// ---------------------------------------------------------------------------
// Teacher landing (FR-6, FR-7)
// ---------------------------------------------------------------------------

const takenSelect = { createdAt: true, takenBy: { select: { id: true, firstName: true, lastName: true } } } as const;

export async function getToday(user: AccessUser, date?: string) {
  const { tz, mode } = await loadSettings();
  const now = new Date();
  const today = schoolToday(now, tz);
  const day = date ?? today;
  assertOpen(user, day, today);

  const schedule = await getScheduleForDate({ userId: user.id, role: user.role }, day === today ? now : middayOf(day));
  const { hhmm } = schoolNow(now, tz);
  const courseSessions = schedule.length
    ? await prisma.attendanceSession.findMany({
        where: { date: toDbDate(day), courseId: { in: schedule.map((s) => s.course.id) } },
        select: { courseId: true, periodId: true, ...takenSelect },
      })
    : [];
  const taken = (s: { createdAt: Date; takenBy: { id: string; firstName: string; lastName: string } } | undefined) =>
    s ? { at: s.createdAt.toISOString(), by: userRef(s.takenBy)! } : null;

  const meetings = schedule.map((s) => ({
    kind: 'course' as const,
    courseId: s.course.id,
    courseName: s.course.name,
    sectionName: s.course.section?.name ?? '',
    periodId: s.period.id,
    periodName: s.period.name,
    startTime: s.period.startTime,
    endTime: s.period.endTime,
    isCurrent: day === today && s.period.startTime <= hhmm && hhmm < s.period.endTime,
    taken: taken(courseSessions.find((x) => x.courseId === s.course.id && x.periodId === s.period.id)),
  }));

  let dailyRegisters: { kind: 'section'; sectionId: string; sectionName: string; taken: ReturnType<typeof taken> }[] = [];
  if (mode !== 'PER_PERIOD') {
    const sections = await prisma.section.findMany({
      where: { homeroomTeacherId: user.id, academicYear: { isCurrent: true } },
      select: { id: true, name: true, attendanceSessions: { where: { date: toDbDate(day) }, select: takenSelect } },
      orderBy: { name: 'asc' },
    });
    dailyRegisters = sections.map((s) => ({ kind: 'section', sectionId: s.id, sectionName: s.name, taken: taken(s.attendanceSessions[0]) }));
  }

  return { date: day, today, meetings, dailyRegisters };
}

// ---------------------------------------------------------------------------
// Register read / save (FR-8 to FR-22, NFR-1, NFR-3)
// ---------------------------------------------------------------------------

export type Register = Awaited<ReturnType<typeof getRegister>>;

export async function getRegister(user: AccessUser, key: RegisterKey) {
  const header = await loadKey(user, key);
  const { tz } = await loadSettings();
  const today = schoolToday(new Date(), tz);
  assertOpen(user, key.date, today);

  const [students, session] = await Promise.all([
    activeRoster(prisma, key, tz),
    prisma.attendanceSession.findFirst({
      where: sessionWhere(key),
      include: {
        records: true,
        takenBy: { select: { id: true, firstName: true, lastName: true } },
        updatedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
  ]);
  const edit = canEdit(user.role, key.date, today);

  return {
    key,
    header,
    sessionId: session?.id ?? null,
    students: students.map((s) => ({ ...s, avatarUrl: null as string | null })),
    records: (session?.records ?? []).map((r) => ({
      studentId: r.studentId,
      status: r.status,
      ...(r.minutesLate != null ? { minutesLate: r.minutesLate } : {}),
      ...(r.note ? { note: r.note } : {}),
    })),
    takenBy: userRef(session?.takenBy ?? null),
    updatedBy: userRef(session?.updatedBy ?? null),
    updatedAt: session?.updatedAt.toISOString() ?? null,
    readOnly: !edit.ok,
    readOnlyReason: edit.ok ? null : (edit.reason ?? null),
    canExcuse: user.role === 'ADMIN',
  };
}

export async function saveRegister(user: AccessUser, key: RegisterKey, records: RegisterRecordInput[]) {
  const header = await loadKey(user, key);
  const { tz } = await loadSettings();
  const today = schoolToday(new Date(), tz);
  assertOpen(user, key.date, today);
  const edit = canEdit(user.role, key.date, today);
  if (!edit.ok) throw new AppError('FORBIDDEN', edit.reason ?? 'You cannot edit this register.');
  if (user.role !== 'ADMIN' && records.some((r) => r.status === 'EXCUSED')) {
    throw new AppError('FORBIDDEN', 'Only administrators can mark a student excused.');
  }

  const next: Rec[] = records.map((r) => ({
    studentId: r.studentId,
    status: r.status,
    minutesLate: r.status === 'LATE' ? (r.minutesLate ?? null) : null,
    note: r.note ? r.note : null,
  }));

  const write = () =>
    prisma.$transaction(async (tx) => {
      const roster = new Set((await activeRoster(tx, key, tz)).map((s) => s.id));
      const given = new Set(next.map((r) => r.studentId));
      const invalidStudentIds = [...given].filter((id) => !roster.has(id));
      if (invalidStudentIds.length) {
        throw new AppError('VALIDATION_ERROR', 'Some students are not on this register for that date.', { invalidStudentIds });
      }
      const missingStudentIds = [...roster].filter((id) => !given.has(id));
      if (missingStudentIds.length) {
        throw new AppError('VALIDATION_ERROR', 'Mark every student before saving.', { missingStudentIds });
      }

      const session =
        (await tx.attendanceSession.findFirst({ where: sessionWhere(key), select: { id: true } })) ??
        (await tx.attendanceSession.create({
          data: {
            ...(isCourseKey(key) ? { courseId: key.courseId, periodId: key.periodId } : { sectionId: key.sectionId }),
            date: toDbDate(key.date),
            takenById: user.id,
            updatedById: user.id,
          },
          select: { id: true },
        }));

      const prev = await tx.attendanceRecord.findMany({ where: { sessionId: session.id } });
      const diff = diffRecords(new Map(prev.map((r) => [r.studentId, toRec(r)])), next);
      if (diff.created.length) {
        await tx.attendanceRecord.createMany({
          data: diff.created.map((r) => ({ sessionId: session.id, studentId: r.studentId, status: r.status, minutesLate: r.minutesLate, note: r.note })),
        });
      }
      for (const c of diff.changed) {
        await tx.attendanceRecord.update({
          where: { sessionId_studentId: { sessionId: session.id, studentId: c.studentId } },
          data: { status: c.next.status, minutesLate: c.next.minutesLate, note: c.next.note },
        });
      }
      await tx.attendanceSession.update({ where: { id: session.id }, data: { updatedById: user.id } });
      return { sessionId: session.id, diff };
    });

  let result: Awaited<ReturnType<typeof write>>;
  try {
    result = await write();
  } catch (error) {
    // ADR-3: two first-saves raced on the partial unique index. The aborted tx can't
    // re-read, so run it once more -- findFirst now sees the winner's session.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') result = await write();
    else throw error;
  }

  // After commit (audit/notify never throw).
  const { sessionId, diff } = result;
  await Promise.all(
    diff.changed
      .filter((c) => c.prev.status !== c.next.status)
      .map((c) =>
        audit({
          actorId: user.id,
          action: 'attendance.record.update',
          entityType: 'AttendanceSession',
          entityId: sessionId,
          metadata: { studentId: c.studentId, old: c.prev.status, new: c.next.status, note: c.next.note },
        }),
      ),
  );

  const notes = notificationsFor(diff);
  const affected = [...notes.absent, ...notes.late, ...notes.corrected].map((r) => r.studentId);
  if (affected.length) {
    const names = new Map(
      (await prisma.user.findMany({ where: { id: { in: affected } }, select: { id: true, firstName: true, lastName: true } })).map((u) => [u.id, fullName(u)]),
    );
    const body = header.courseName
      ? `${header.courseName} – ${header.sectionName}, ${header.periodName}, ${longDate(key.date)}`
      : `${header.sectionName} daily register, ${longDate(key.date)}`;
    const send = (type: 'attendance.absent' | 'attendance.late' | 'attendance.corrected', r: Rec, title: string) =>
      notifyStudentAndParents({
        type,
        studentIds: [r.studentId],
        title,
        body,
        link: `/students/${r.studentId}/attendance`,
        email: { template: 'generic-notification' },
      });
    await Promise.all([
      ...notes.absent.map((r) => send('attendance.absent', r, `${names.get(r.studentId)} was marked absent`)),
      ...notes.late.map((r) => send('attendance.late', r, `${names.get(r.studentId)} was marked late (${r.minutesLate} min)`)),
      ...notes.corrected.map((r) => send('attendance.corrected', r, `Attendance corrected: ${names.get(r.studentId)} was present`)),
    ]);
  }

  return getRegister(user, key);
}

// ---------------------------------------------------------------------------
// Student tab (FR-25 to FR-28)
// ---------------------------------------------------------------------------

async function currentYearWithTerm(today: string) {
  const year = await prisma.academicYear.findFirst({
    where: { isCurrent: true },
    select: { id: true, startDate: true, terms: { select: { name: true, startDate: true, endDate: true }, orderBy: { startDate: 'asc' } } },
  });
  if (!year) return null;
  const terms = year.terms.map((t) => ({ name: t.name, start: fromDbDate(t.startDate), end: fromDbDate(t.endDate) }));
  // FR-25: the term containing today, else the latest ended one.
  const term = terms.find((t) => t.start <= today && today <= t.end) ?? terms.filter((t) => t.end < today).pop() ?? null;
  return { id: year.id, start: fromDbDate(year.startDate), term };
}

export async function getStudentAttendance(user: AccessUser, studentId: string, range: { from?: string; to?: string }) {
  await assertCanViewStudent(user, studentId);
  const { tz, mode } = await loadSettings();
  const today = schoolToday(new Date(), tz);
  const from = range.from ?? `${today.slice(0, 8)}01`;
  // Day 28 + 4 always lands in next month; its 1st minus one day is this month's last day.
  const to = range.to ?? addDays(`${addDays(`${today.slice(0, 8)}28`, 4).slice(0, 8)}01`, -1);
  const year = await currentYearWithTerm(today);

  const lo = year && year.start < from ? year.start : from;
  const hi = to > today ? to : today;
  const rows = await prisma.attendanceRecord.findMany({
    where: { studentId, session: { date: { gte: toDbDate(lo), lte: toDbDate(hi) }, ...kindWhere(mode) } },
    select: {
      id: true,
      status: true,
      minutesLate: true,
      note: true,
      session: {
        select: {
          date: true,
          period: { select: { name: true, order: true } },
          course: { select: { name: true, section: { select: { name: true } } } },
          section: { select: { name: true } },
        },
      },
    },
  });
  const recs = rows.map((r) => ({ ...r, date: fromDbDate(r.session.date) }));
  const within = (a: string, b: string) => recs.filter((r) => r.date >= a && r.date <= b).map((r) => r.status);

  const term = year?.term;
  const summary = {
    term: { ...(term ? countStatuses(within(term.start, term.end < today ? term.end : today)) : countStatuses([])), termName: term?.name ?? null },
    year: year ? countStatuses(within(year.start, today)) : countStatuses([]),
  };

  const inRange = recs.filter((r) => r.date >= from && r.date <= to);
  const byDay = new Map<string, Status[]>();
  for (const r of inRange) byDay.set(r.date, [...(byDay.get(r.date) ?? []), r.status]);
  const calendar = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, statuses]) => {
      const c = countStatuses(statuses);
      return { date, colour: dayColour(statuses), present: c.present, absent: c.absent, late: c.late, excused: c.excused };
    });

  const showNotes = user.role === 'ADMIN' || user.role === 'TEACHER'; // FR-27
  const records = inRange
    .sort((a, b) => b.date.localeCompare(a.date) || (a.session.period?.order ?? 0) - (b.session.period?.order ?? 0))
    .map((r) => ({
      id: r.id,
      date: r.date,
      periodName: r.session.period?.name ?? null,
      courseName: r.session.course?.name ?? null,
      sectionName: r.session.section?.name ?? r.session.course?.section?.name ?? null,
      status: r.status,
      minutesLate: r.minutesLate,
      ...(showNotes ? { note: r.note } : {}),
    }));

  return { from, to, summary, calendar, records };
}

// ---------------------------------------------------------------------------
// Course matrix (FR-29)
// ---------------------------------------------------------------------------

export async function getCourseMatrix(user: AccessUser, courseId: string) {
  await assertCanManageCourse(user, courseId);
  const sessions = (
    await prisma.attendanceSession.findMany({
      where: { courseId },
      orderBy: [{ date: 'desc' }, { period: { order: 'desc' } }],
      take: 20,
      select: { id: true, date: true, periodId: true, period: { select: { name: true } }, records: { select: { studentId: true, status: true } } },
    })
  ).reverse();

  const [enrollments, totals] = await Promise.all([
    prisma.enrollment.findMany({
      where: { courseId },
      select: { status: true, student: { select: { id: true, firstName: true, lastName: true } } },
    }),
    prisma.attendanceRecord.groupBy({ by: ['studentId', 'status'], where: { session: { courseId } }, _count: { _all: true } }),
  ]);

  const cells = new Map<string, Record<string, Status>>();
  for (const s of sessions) for (const r of s.records) cells.set(r.studentId, { ...(cells.get(r.studentId) ?? {}), [s.id]: r.status });

  const students = enrollments
    .filter((e) => e.status === 'ACTIVE' || cells.has(e.student.id))
    .map((e) => ({
      studentId: e.student.id,
      firstName: e.student.firstName,
      lastName: e.student.lastName,
      enrollmentStatus: e.status,
      cells: cells.get(e.student.id) ?? {},
      rate: foldCounts(totals.filter((t) => t.studentId === e.student.id)).rate,
    }))
    .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));

  return {
    sessions: sessions.map((s) => ({ sessionId: s.id, date: fromDbDate(s.date), periodId: s.periodId ?? '', periodName: s.period?.name ?? '' })),
    students,
  };
}

function foldCounts(groups: { status: Status; _count: { _all: number } }[]): StatusCounts {
  return countStatuses(groups.flatMap((g) => Array<Status>(g._count._all).fill(g.status)));
}

// ---------------------------------------------------------------------------
// Admin: overview, remind, report, below threshold (FR-30 to FR-33)
// ---------------------------------------------------------------------------

function plusMinutes(hhmm: string, minutes: number) {
  const [h, m] = hhmm.split(':').map(Number);
  const t = h * 60 + m + minutes;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

export async function getOverview(dateArg?: string) {
  const { tz, mode } = await loadSettings();
  const now = new Date();
  const today = schoolToday(now, tz);
  const date = dateArg ?? today;
  if (date > today) throw new AppError('VALIDATION_ERROR', 'The overview cannot be shown for a future date.');

  const [schedule, sections, sessions, groups] = await Promise.all([
    getSchoolScheduleForDate(date === today ? now : middayOf(date)),
    mode === 'PER_PERIOD'
      ? Promise.resolve([] as { id: string }[])
      : prisma.section.findMany({ where: { academicYear: { isCurrent: true } }, select: { id: true } }),
    prisma.attendanceSession.findMany({ where: { date: toDbDate(date) }, select: { courseId: true, periodId: true, sectionId: true } }),
    prisma.attendanceRecord.groupBy({ by: ['status'], where: { session: { date: toDbDate(date), ...kindWhere(mode) } }, _count: { _all: true } }),
  ]);

  const done = new Set(sessions.map((s) => (s.courseId ? `${s.courseId}|${s.periodId}` : `section|${s.sectionId}`)));
  const takenMeetings = schedule.filter((s) => done.has(`${s.course.id}|${s.period.id}`));
  const takenSections = sections.filter((s) => done.has(`section|${s.id}`));
  const { hhmm } = schoolNow(now, tz);

  const missing =
    date !== today
      ? []
      : schedule
          .filter((s) => !done.has(`${s.course.id}|${s.period.id}`) && plusMinutes(s.period.startTime, 15) <= hhmm)
          .map((s) => ({
            courseId: s.course.id,
            courseName: s.course.name,
            sectionName: s.course.section?.name ?? '',
            periodId: s.period.id,
            periodName: s.period.name,
            startTime: s.period.startTime,
            teacher: userRef(s.course.teacher)!,
          }));

  return {
    date,
    expected: schedule.length + sections.length,
    taken: takenMeetings.length + takenSections.length,
    rate: foldCounts(groups).rate,
    missing,
  };
}

export async function remindTeacher(admin: AccessUser, input: { courseId: string; periodId: string; date: string }, request?: Request) {
  const [course, period] = await Promise.all([
    prisma.course.findUnique({ where: { id: input.courseId }, select: { id: true, name: true, teacher: { select: { id: true, firstName: true, lastName: true } } } }),
    prisma.period.findUnique({ where: { id: input.periodId }, select: { name: true } }),
  ]);
  if (!course) throw new AppError('NOT_FOUND', 'Course not found');
  if (!period) throw new AppError('NOT_FOUND', 'Period not found');

  await notify({
    type: 'attendance.register_missing',
    userIds: [course.teacher.id],
    title: `Register not taken: ${course.name}`,
    body: `${period.name}, ${longDate(input.date)}`,
    link: `/attendance/take/${course.id}?date=${input.date}&periodId=${input.periodId}`,
  });
  await audit({ actorId: admin.id, action: 'attendance.remind', entityType: 'Course', entityId: course.id, metadata: { ...input, teacherId: course.teacher.id }, request });
  return { reminded: userRef(course.teacher)! };
}

export interface StudentSummaryRow extends StatusCounts {
  studentId: string;
  studentName: string;
  sectionName: string | null;
  gradeLevelName: string | null;
}

/** groupBy (studentId, status) → per-student rows with names, sorted by last name. */
async function aggregate(where: Prisma.AttendanceRecordWhereInput, mustHave?: Status): Promise<StudentSummaryRow[]> {
  const groups = await prisma.attendanceRecord.groupBy({ by: ['studentId', 'status'], where, _count: { _all: true } });
  const byStudent = new Map<string, typeof groups>();
  for (const g of groups) byStudent.set(g.studentId, [...(byStudent.get(g.studentId) ?? []), g]);
  const ids = [...byStudent.keys()].filter((id) => !mustHave || byStudent.get(id)!.some((g) => g.status === mustHave));
  if (!ids.length) return [];

  const students = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      studentProfile: { select: { gradeLevel: { select: { name: true } } } },
      sectionMemberships: { where: { section: { academicYear: { isCurrent: true } } }, select: { section: { select: { name: true } } } },
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });
  return students.map((s) => ({
    studentId: s.id,
    studentName: fullName(s),
    sectionName: s.sectionMemberships[0]?.section.name ?? null,
    gradeLevelName: s.studentProfile?.gradeLevel.name ?? null,
    ...foldCounts(byStudent.get(s.id)!),
  }));
}

// ponytail: rows are paginated in memory after the groupBy -- bounded by the student count;
// move to SQL window pagination if the school grows past a few thousand students.
export async function getReport(filters: ReportFilters): Promise<StudentSummaryRow[]> {
  const { mode } = await loadSettings();
  const student: Prisma.UserWhereInput = {
    ...(filters.gradeLevelId ? { studentProfile: { gradeLevelId: filters.gradeLevelId } } : {}),
    ...(filters.sectionId ? { sectionMemberships: { some: { sectionId: filters.sectionId } } } : {}),
  };
  return aggregate(
    {
      session: {
        date: { gte: toDbDate(filters.from), lte: toDbDate(filters.to) },
        ...(filters.courseId ? { courseId: filters.courseId } : kindWhere(mode)),
      },
      student,
    },
    filters.status,
  );
}

export async function getBelowThreshold() {
  const { tz, mode, threshold } = await loadSettings();
  const today = schoolToday(new Date(), tz);
  const year = await currentYearWithTerm(today);
  if (!year) return { threshold, rows: [] };
  const rows = (await aggregate({ session: { date: { gte: toDbDate(year.start), lte: toDbDate(today) }, ...kindWhere(mode) } }))
    .filter((r) => r.rate !== null && r.rate < threshold)
    .sort((a, b) => (a.rate ?? 0) - (b.rate ?? 0))
    .map((r) => ({ ...r, href: `/students/${r.studentId}/attendance` }));
  return { threshold, rows };
}

/** For the admin Settings card. */
export async function getAttendanceSettings() {
  const { mode, threshold } = await loadSettings();
  return { attendanceMode: mode, attendanceAlertThreshold: threshold };
}
