import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import { audit } from '@/server/audit';
import { logger } from '@/lib/logger';
import { ISO_DAY_NAMES, schoolNow } from '@/lib/dates';
import type { Role } from '@/config/navigation';
import type {
  PeriodInput,
  PeriodUpdateInput,
  SchoolDaysInput,
  SlotCreateInput,
  SlotUpdateInput,
  TimetableViewKind,
} from '@/lib/validators/timetable';
import { clashesForCell, periodsOverlap, type CandidateCourse, type Clash, type OtherSlot } from './clash-rules';

/**
 * PRD-06 timetable service: the only writer of Period / SchoolDay /
 * TimetableSlot. Route handlers stay thin (NFR-8). audit() runs after the
 * transaction commits, so a rolled-back write is never audited (D7).
 *
 * Note: this file deliberately does not import services/settings.ts or
 * services/academicYears.ts -- their react.cache() wrappers are undefined
 * outside Next (vitest/tsx), and the concurrency test imports this module.
 */

type Tx = Prisma.TransactionClient;
export interface AuditCtx {
  actorId?: string | null;
  request?: Request;
}

// ---------------------------------------------------------------------------
// Bell schedule: periods (FR-5, FR-6, FR-8, FR-33)
// ---------------------------------------------------------------------------

export function listPeriods(db: Tx = prisma) {
  return db.period.findMany({ orderBy: { order: 'asc' } });
}

async function assertNoOverlap(candidate: { startTime: string; endTime: string }, excludeId?: string) {
  const others = await prisma.period.findMany({ where: excludeId ? { id: { not: excludeId } } : {} });
  const hit = others.find((o) => periodsOverlap(candidate, o));
  if (hit) {
    throw new AppError('VALIDATION_ERROR', `Overlaps '${hit.name}' (${hit.startTime}–${hit.endTime}).`);
  }
}

export async function createPeriod(input: PeriodInput, ctx: AuditCtx = {}) {
  await assertNoOverlap(input);
  const max = await prisma.period.aggregate({ _max: { order: true } });
  const period = await prisma.period.create({ data: { ...input, order: (max._max.order ?? 0) + 1 } });
  await audit({ ...ctx, action: 'period.create', entityType: 'Period', entityId: period.id, metadata: { ...input } });
  return period;
}

export async function updatePeriod(id: string, patch: PeriodUpdateInput, ctx: AuditCtx = {}) {
  const existing = await prisma.period.findUnique({ where: { id } });
  if (!existing) throw new AppError('NOT_FOUND', 'Period not found');
  const merged = { ...existing, ...stripUndefined(patch) };
  if (merged.endTime <= merged.startTime) {
    throw new AppError('VALIDATION_ERROR', 'End time must be after start time');
  }
  await assertNoOverlap(merged, id);
  const period = await prisma.period.update({ where: { id }, data: stripUndefined(patch) });
  await audit({ ...ctx, action: 'period.update', entityType: 'Period', entityId: id, metadata: { ...patch } });
  return period;
}

export async function deletePeriod(id: string, ctx: AuditCtx = {}) {
  const existing = await prisma.period.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!existing) throw new AppError('NOT_FOUND', 'Period not found');
  const slotCount = await prisma.timetableSlot.count({ where: { periodId: id } });
  if (slotCount > 0) {
    throw new AppError('CONFLICT', `Period has ${slotCount} timetable slots. Remove them first.`, { slotCount });
  }
  await prisma.period.delete({ where: { id } });
  await audit({ ...ctx, action: 'period.delete', entityType: 'Period', entityId: id, metadata: { name: existing.name } });
  return { id };
}

/** Index 0 → order 1. Two-phase write so the @unique order never collides mid-update. */
export async function reorderPeriods(periodIds: string[], ctx: AuditCtx = {}) {
  const periods = await prisma.$transaction(async (tx) => {
    const existing = await tx.period.findMany({ select: { id: true } });
    const known = new Set(existing.map((p) => p.id));
    if (known.size !== periodIds.length || !periodIds.every((id) => known.has(id))) {
      throw new AppError('VALIDATION_ERROR', 'periodIds must list every period exactly once');
    }
    for (const [i, id] of periodIds.entries()) await tx.period.update({ where: { id }, data: { order: -(i + 1) } });
    for (const [i, id] of periodIds.entries()) await tx.period.update({ where: { id }, data: { order: i + 1 } });
    return listPeriods(tx);
  });
  await audit({ ...ctx, action: 'period.reorder', entityType: 'Period', metadata: { periodIds } });
  return periods;
}

// ---------------------------------------------------------------------------
// Teaching days (FR-7, FR-34)
// ---------------------------------------------------------------------------

/** Always 7 rows Mon→Sun; a missing row (unseeded DB) defaults to Mon–Fri teaching. */
async function loadDays(db: Tx = prisma) {
  const rows = await db.schoolDay.findMany();
  return [1, 2, 3, 4, 5, 6, 7].map(
    (dayOfWeek) => rows.find((r) => r.dayOfWeek === dayOfWeek) ?? { dayOfWeek, isTeaching: dayOfWeek <= 5 },
  );
}

/** slotCount covers all academic years -- the same set updateSchoolDays deletes (D3). */
export async function listSchoolDays(db: Tx = prisma) {
  const [days, counts] = await Promise.all([
    loadDays(db),
    db.timetableSlot.groupBy({ by: ['dayOfWeek'], _count: { _all: true } }),
  ]);
  return days.map((d) => ({ ...d, slotCount: counts.find((c) => c.dayOfWeek === d.dayOfWeek)?._count._all ?? 0 }));
}

export async function updateSchoolDays(input: SchoolDaysInput['days'], ctx: AuditCtx = {}) {
  const result = await prisma.$transaction(async (tx) => {
    const current = await loadDays(tx);
    const changed = input.filter((d) => current.find((c) => c.dayOfWeek === d.dayOfWeek)?.isTeaching !== d.isTeaching);
    const off = changed.filter((d) => !d.isTeaching).map((d) => d.dayOfWeek);
    const { count: deletedSlotCount } = off.length
      ? await tx.timetableSlot.deleteMany({ where: { dayOfWeek: { in: off } } })
      : { count: 0 };
    for (const d of input) {
      await tx.schoolDay.upsert({ where: { dayOfWeek: d.dayOfWeek }, update: { isTeaching: d.isTeaching }, create: d });
    }
    return { days: await listSchoolDays(tx), changed, deletedSlotCount };
  });
  await audit({
    ...ctx,
    action: 'schoolDay.update',
    entityType: 'SchoolDay',
    metadata: { changed: result.changed, deletedSlotCount: result.deletedSlotCount },
  });
  return { days: result.days, deletedSlotCount: result.deletedSlotCount };
}

// ---------------------------------------------------------------------------
// Clash validation (FR-9..FR-14)
// ---------------------------------------------------------------------------

const clashCourseInclude = {
  subject: { select: { name: true } },
  section: { select: { name: true } },
} satisfies Prisma.CourseInclude;

type ClashCourseRow = Prisma.CourseGetPayload<{ include: typeof clashCourseInclude }>;

function toCandidate(c: ClashCourseRow): CandidateCourse {
  return {
    id: c.id,
    code: c.code,
    teacherId: c.teacherId,
    coTeacherIds: c.coTeacherIds,
    sectionId: c.sectionId,
    sectionName: c.section?.name ?? null,
    subjectName: c.subject.name,
  };
}

async function teacherNames(courses: CandidateCourse[], db: Tx) {
  const ids = [...new Set(courses.flatMap((c) => [c.teacherId, ...c.coTeacherIds]))];
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } });
  return new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
}

/** courseId → number of the given course's ACTIVE students also ACTIVE in it. One query. */
async function overlapByCourse(courseId: string, otherIds: string[] | undefined, db: Tx) {
  const rows = await db.enrollment.groupBy({
    by: ['courseId'],
    where: {
      status: 'ACTIVE',
      courseId: otherIds ? { in: otherIds } : { not: courseId },
      student: { enrollments: { some: { courseId, status: 'ACTIVE' } } },
    },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.courseId, r._count._all]));
}

export interface ValidateSlotInput {
  courseId: string;
  dayOfWeek: number;
  periodId: string;
  roomId: string | null;
  excludeSlotId?: string;
}

/** Returns ALL clashes for placing the course at the cell (FR-14). */
export async function validateSlot(input: ValidateSlotInput, db: Tx = prisma): Promise<Clash[]> {
  const [course, period, day] = await Promise.all([
    db.course.findUnique({ where: { id: input.courseId }, include: clashCourseInclude }),
    db.period.findUnique({ where: { id: input.periodId } }),
    db.schoolDay.findUnique({ where: { dayOfWeek: input.dayOfWeek } }),
  ]);
  if (!course) throw new AppError('NOT_FOUND', 'Course not found');
  if (!period) throw new AppError('NOT_FOUND', 'Period not found');

  const rows = await db.timetableSlot.findMany({
    where: {
      academicYearId: course.academicYearId,
      dayOfWeek: input.dayOfWeek,
      periodId: input.periodId,
      ...(input.excludeSlotId ? { id: { not: input.excludeSlotId } } : {}),
    },
    include: { course: { include: clashCourseInclude }, room: { select: { name: true } } },
  });
  const others: OtherSlot[] = rows.map((r) => ({ id: r.id, roomId: r.roomId, roomName: r.room?.name, course: toCandidate(r.course) }));
  const candidate = toCandidate(course);
  const [names, overlap] = await Promise.all([
    teacherNames([candidate, ...others.map((o) => o.course)], db),
    overlapByCourse(course.id, others.map((o) => o.course.id), db),
  ]);

  return clashesForCell(
    candidate,
    input.roomId,
    {
      dayLabel: ISO_DAY_NAMES[input.dayOfWeek],
      period: period,
      isTeaching: day?.isTeaching ?? input.dayOfWeek <= 5,
    },
    others,
    overlap,
    { teacherNames: names },
  );
}

// ---------------------------------------------------------------------------
// Slot writes (FR-17, FR-18, FR-21, FR-37, NFR-1)
// ---------------------------------------------------------------------------

/** Retries a SERIALIZABLE transaction that lost a write conflict (P2034). Local until a 2nd caller exists (D6). */
async function withSerializableRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
      if (!retryable || attempt >= attempts) throw error;
      logger.warn('Timetable write conflict, retrying', { attempt });
    }
  }
}

const serializable = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable };

export const slotInclude = {
  course: {
    select: {
      id: true,
      code: true,
      name: true,
      sectionId: true,
      subject: { select: { id: true, name: true, color: true } },
      teacher: { select: { id: true, firstName: true, lastName: true } },
      section: { select: { id: true, name: true } },
    },
  },
  room: { select: { id: true, name: true } },
  period: true,
} satisfies Prisma.TimetableSlotInclude;

export type ExpandedSlot = Prisma.TimetableSlotGetPayload<{ include: typeof slotInclude }>;

/** D4: archived courses/rooms can't receive new placements. Returns the course's year. */
async function assertWritable(tx: Tx, courseId: string, roomId: string | null | undefined) {
  const course = await tx.course.findUnique({ where: { id: courseId }, select: { academicYearId: true, archivedAt: true } });
  if (!course) throw new AppError('NOT_FOUND', 'Course not found');
  if (course.archivedAt) throw new AppError('VALIDATION_ERROR', 'Archived courses cannot be scheduled.');
  if (roomId) {
    const room = await tx.room.findUnique({ where: { id: roomId }, select: { archivedAt: true } });
    if (!room || room.archivedAt) throw new AppError('VALIDATION_ERROR', 'Room is archived or does not exist.');
  }
  return course.academicYearId;
}

function throwIfClashes(clashes: Clash[]) {
  if (!clashes.length) return;
  const more = clashes.length > 1 ? ` (+${clashes.length - 1} more)` : '';
  throw new AppError('CONFLICT', clashes[0].message + more, { clashes });
}

export async function createSlot(input: SlotCreateInput, ctx: AuditCtx = {}) {
  const roomId = input.roomId ?? null;
  const slot = await withSerializableRetry(() =>
    prisma.$transaction(async (tx) => {
      const academicYearId = await assertWritable(tx, input.courseId, roomId);
      throwIfClashes(await validateSlot({ ...input, roomId }, tx));
      return tx.timetableSlot.create({
        data: { academicYearId, courseId: input.courseId, dayOfWeek: input.dayOfWeek, periodId: input.periodId, roomId },
        include: slotInclude,
      });
    }, serializable),
  );
  await audit({
    ...ctx,
    action: 'timetableSlot.create',
    entityType: 'TimetableSlot',
    entityId: slot.id,
    metadata: { courseId: slot.courseId, dayOfWeek: slot.dayOfWeek, periodId: slot.periodId, roomId: slot.roomId },
  });
  return slot;
}

export async function moveSlot(id: string, patch: SlotUpdateInput, ctx: AuditCtx = {}) {
  const { from, slot } = await withSerializableRetry(() =>
    prisma.$transaction(async (tx) => {
      const existing = await tx.timetableSlot.findUnique({ where: { id } });
      if (!existing) throw new AppError('NOT_FOUND', 'Timetable slot not found');
      const to = {
        dayOfWeek: patch.dayOfWeek ?? existing.dayOfWeek,
        periodId: patch.periodId ?? existing.periodId,
        roomId: patch.roomId === undefined ? existing.roomId : patch.roomId,
      };
      // Only a newly chosen room is checked for archival; an unchanged one rides along.
      await assertWritable(tx, existing.courseId, patch.roomId);
      throwIfClashes(await validateSlot({ courseId: existing.courseId, ...to, excludeSlotId: id }, tx));
      const updated = await tx.timetableSlot.update({ where: { id }, data: to, include: slotInclude });
      return { from: existing, slot: updated };
    }, serializable),
  );
  await audit({
    ...ctx,
    action: 'timetableSlot.update',
    entityType: 'TimetableSlot',
    entityId: id,
    metadata: {
      courseId: slot.courseId,
      from: { dayOfWeek: from.dayOfWeek, periodId: from.periodId, roomId: from.roomId },
      to: { dayOfWeek: slot.dayOfWeek, periodId: slot.periodId, roomId: slot.roomId },
    },
  });
  return slot;
}

export async function deleteSlot(id: string, ctx: AuditCtx = {}) {
  const existing = await prisma.timetableSlot.findUnique({ where: { id } });
  if (!existing) throw new AppError('NOT_FOUND', 'Timetable slot not found');
  await prisma.timetableSlot.delete({ where: { id } });
  await audit({
    ...ctx,
    action: 'timetableSlot.delete',
    entityType: 'TimetableSlot',
    entityId: id,
    metadata: { courseId: existing.courseId, dayOfWeek: existing.dayOfWeek, periodId: existing.periodId, roomId: existing.roomId },
  });
  return { id };
}

// ---------------------------------------------------------------------------
// Reads (FR-15, FR-19, FR-21, FR-24, FR-27, FR-35, FR-36, FR-38)
// ---------------------------------------------------------------------------

/**
 * Clash preview while dragging (FR-19, D2): cell key `${day}-${periodId}` →
 * messages, clashing cells only. Fixed query count regardless of grid size (NFR-3).
 * ponytail: in-memory clash map; move to SQL aggregation near ~50k slots/year.
 */
export async function getAvailability(courseId: string, roomId?: string): Promise<Record<string, string[]>> {
  const course = await prisma.course.findUnique({ where: { id: courseId }, include: clashCourseInclude });
  if (!course) throw new AppError('NOT_FOUND', 'Course not found');

  const [periods, days, rows, overlap] = await Promise.all([
    prisma.period.findMany({ where: { kind: 'CLASS' }, orderBy: { order: 'asc' } }),
    loadDays(),
    prisma.timetableSlot.findMany({
      where: { academicYearId: course.academicYearId, courseId: { not: courseId } },
      include: { course: { include: clashCourseInclude }, room: { select: { name: true } } },
    }),
    overlapByCourse(courseId, undefined, prisma),
  ]);
  const candidate = toCandidate(course);
  const others = rows.map((r) => ({
    key: `${r.dayOfWeek}-${r.periodId}`,
    slot: { id: r.id, roomId: r.roomId, roomName: r.room?.name, course: toCandidate(r.course) } as OtherSlot,
  }));
  const names = await teacherNames([candidate, ...others.map((o) => o.slot.course)], prisma);

  const result: Record<string, string[]> = {};
  for (const day of days.filter((d) => d.isTeaching)) {
    for (const period of periods) {
      const key = `${day.dayOfWeek}-${period.id}`;
      const cellOthers = others.filter((o) => o.key === key).map((o) => o.slot);
      if (!cellOthers.length) continue;
      const clashes = clashesForCell(
        candidate,
        roomId ?? null,
        { dayLabel: ISO_DAY_NAMES[day.dayOfWeek], period, isTeaching: true },
        cellOthers,
        overlap,
        { teacherNames: names },
      );
      if (clashes.length) result[key] = clashes.map((c) => c.message);
    }
  }
  return result;
}

export function getFreeRooms(q: { dayOfWeek: number; periodId: string; academicYearId: string; excludeSlotId?: string }) {
  return prisma.room.findMany({
    where: {
      archivedAt: null,
      timetableSlots: {
        none: {
          academicYearId: q.academicYearId,
          dayOfWeek: q.dayOfWeek,
          periodId: q.periodId,
          ...(q.excludeSlotId ? { id: { not: q.excludeSlotId } } : {}),
        },
      },
    },
    select: { id: true, name: true, capacity: true },
    orderBy: { name: 'asc' },
  });
}

export type SlotTarget =
  | { kind: 'section'; sectionId: string }
  | { kind: 'teacher'; userId: string }
  | { kind: 'room'; roomId: string }
  | { kind: 'student'; studentId: string };

function slotWhere(target: SlotTarget): Prisma.TimetableSlotWhereInput {
  switch (target.kind) {
    case 'section':
      return { course: { sectionId: target.sectionId } };
    case 'teacher':
      return { course: { OR: [{ teacherId: target.userId }, { coTeacherIds: { has: target.userId } }] } };
    case 'room':
      return { roomId: target.roomId };
    case 'student':
      return { course: { enrollments: { some: { studentId: target.studentId, status: 'ACTIVE' } } } };
  }
}

async function loadView(target: SlotTarget | null, academicYearId: string | null) {
  const [periods, days, slots] = await Promise.all([
    listPeriods(),
    loadDays(),
    target && academicYearId
      ? prisma.timetableSlot.findMany({ where: { academicYearId, ...slotWhere(target) }, include: slotInclude })
      : Promise.resolve([] as ExpandedSlot[]),
  ]);
  return { periods, days, slots };
}

export type TimetableViewData = Awaited<ReturnType<typeof loadView>>;

/** Everything the grid needs in one response (NFR-2). */
export function getTimetable(view: TimetableViewKind, id: string, academicYearId: string) {
  const target: SlotTarget =
    view === 'section' ? { kind: 'section', sectionId: id } : view === 'teacher' ? { kind: 'teacher', userId: id } : { kind: 'room', roomId: id };
  return loadView(target, academicYearId);
}

/** FR-35 / D8. ADMIN any view; TEACHER own teacher view or sections they homeroom/teach; else FORBIDDEN. */
export async function assertCanViewTimetable(user: { id: string; role: Role }, view: TimetableViewKind, id: string) {
  if (user.role === 'ADMIN') return;
  if (user.role === 'TEACHER') {
    if (view === 'teacher' && id === user.id) return;
    if (view === 'section') {
      const section = await prisma.section.findFirst({
        where: {
          id,
          OR: [
            { homeroomTeacherId: user.id },
            { courses: { some: { archivedAt: null, OR: [{ teacherId: user.id }, { coTeacherIds: { has: user.id } }] } } },
          ],
        },
        select: { id: true },
      });
      if (section) return;
    }
  }
  throw new AppError('FORBIDDEN', 'You do not have permission to view this timetable.');
}

async function currentYearId() {
  const year = await prisma.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
  return year?.id ?? null;
}

async function schoolTimezone() {
  const settings = await prisma.schoolSettings.findUnique({ where: { id: 'singleton' }, select: { timezone: true } });
  return settings?.timezone ?? 'UTC';
}

export type PersonalTarget = { kind: 'teacher'; userId: string } | { kind: 'student'; studentId: string };

/**
 * FR-25/FR-38 access, shared by GET /api/me/timetable and the /timetable page (NFR-7).
 * null = no personal timetable (ADMIN, D5; or a parent with no linked child).
 */
export async function resolvePersonalTarget(
  user: { id: string; role: Role },
  studentId?: string,
): Promise<PersonalTarget | null> {
  switch (user.role) {
    case 'TEACHER':
      return { kind: 'teacher', userId: user.id };
    case 'STUDENT':
      if (studentId && studentId !== user.id) throw new AppError('FORBIDDEN', 'You can only view your own timetable.');
      return { kind: 'student', studentId: user.id };
    case 'PARENT': {
      const links = await prisma.parentStudentLink.findMany({ where: { parentId: user.id }, select: { studentId: true } });
      if (studentId) {
        if (!links.some((l) => l.studentId === studentId)) {
          throw new AppError('FORBIDDEN', 'You do not have permission to view this student.');
        }
        return { kind: 'student', studentId };
      }
      if (links.length > 1) throw new AppError('VALIDATION_ERROR', 'studentId is required when you have more than one child.');
      return links.length ? { kind: 'student', studentId: links[0].studentId } : null;
    }
    default:
      return null;
  }
}

/** Teacher (incl. co-taught) or student (ACTIVE enrollments) week; year defaults to the current one. */
export async function getPersonalTimetable(target: PersonalTarget | null, academicYearId?: string) {
  return loadView(target, academicYearId ?? (await currentYearId()));
}

// ---------------------------------------------------------------------------
// Exports for later PRDs (FR-30, FR-31): PRD-07 attendance, PRD-16 dashboards
// ---------------------------------------------------------------------------

export type ScheduleTarget = { userId: string; role: Role } | { sectionId: string };
export interface ScheduleEntry {
  period: ExpandedSlot['period'];
  course: ExpandedSlot['course'];
  room: ExpandedSlot['room'];
}

/** The target's classes on `date` (school timezone), ordered by period. [] on non-teaching days. */
export async function getScheduleForDate(target: ScheduleTarget, date: Date): Promise<ScheduleEntry[]> {
  let slotTarget: SlotTarget | null;
  if ('sectionId' in target) slotTarget = { kind: 'section', sectionId: target.sectionId };
  else if (target.role === 'TEACHER') slotTarget = { kind: 'teacher', userId: target.userId };
  else if (target.role === 'STUDENT') slotTarget = { kind: 'student', studentId: target.userId };
  else return []; // ADMIN/PARENT have no own schedule; callers pass the student.

  const { isoDay } = schoolNow(date, await schoolTimezone());
  // PRD-14 holidays hook in here: return [] when `date` is a school holiday.
  const day = await prisma.schoolDay.findUnique({ where: { dayOfWeek: isoDay } });
  if (!(day?.isTeaching ?? isoDay <= 5)) return [];

  const academicYearId = await currentYearId();
  if (!academicYearId) return [];
  const slots = await prisma.timetableSlot.findMany({
    where: { academicYearId, dayOfWeek: isoDay, ...slotWhere(slotTarget) },
    include: slotInclude,
    orderBy: { period: { order: 'asc' } },
  });
  return slots.map((s) => ({ period: s.period, course: s.course, room: s.room }));
}

/**
 * PRD-07 FR-30/31: every class meeting school-wide on `date` (school timezone),
 * ordered by period. Same rules as getScheduleForDate, no target filter.
 */
export async function getSchoolScheduleForDate(date: Date): Promise<ScheduleEntry[]> {
  const { isoDay } = schoolNow(date, await schoolTimezone());
  // PRD-14 holidays hook in here: return [] when `date` is a school holiday.
  const day = await prisma.schoolDay.findUnique({ where: { dayOfWeek: isoDay } });
  if (!(day?.isTeaching ?? isoDay <= 5)) return [];

  const academicYearId = await currentYearId();
  if (!academicYearId) return [];
  const slots = await prisma.timetableSlot.findMany({
    where: { academicYearId, dayOfWeek: isoDay },
    include: slotInclude,
    orderBy: { period: { order: 'asc' } },
  });
  return slots.map((s) => ({ period: s.period, course: s.course, room: s.room }));
}

/** The entry running at `now` in the school timezone, else null. */
export async function getCurrentSlot(user: { userId: string; role: Role }, now: Date): Promise<ScheduleEntry | null> {
  const [schedule, tz] = await Promise.all([getScheduleForDate(user, now), schoolTimezone()]);
  const { hhmm } = schoolNow(now, tz);
  return schedule.find((s) => s.period.startTime <= hhmm && hhmm < s.period.endTime) ?? null;
}

function stripUndefined<T extends object>(obj: T) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}
