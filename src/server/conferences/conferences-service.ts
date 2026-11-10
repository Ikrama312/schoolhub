import { Prisma } from '@prisma/client';
import { fromZonedTime } from 'date-fns-tz';
import { prisma } from '@/server/db';
import { AppError, type PaginationParams } from '@/server/http';
import { audit } from '@/server/audit';
import { assertCanViewStudent, type AccessUser } from '@/server/auth/student-access';
import { notify } from '@/server/notifications/notify';
import { buildCalendar } from '@/server/calendar/ical';
import { addDateDays, formatInSchoolTz, schoolMidnight } from '@/lib/dates';
import type {
  AvailabilityInput,
  BookingInput,
  ConferenceEventInput,
  ConferenceEventPatch,
  ConferenceListQuery,
  SlotPatch,
  SlotsQuery,
} from '@/lib/validators/conferences';
import { generateSlots, overlaps } from './conference-slots';

/**
 * PRD-15 parent–teacher conferences (FR-28 to FR-35, NFR-1). Booking is a
 * conditional UPDATE (bookedByParentId IS NULL), so two parents racing for one
 * slot get exactly one winner; the partial unique index enforces one slot per
 * teacher per child.
 */

const toDbDate = (d: string) => new Date(`${d}T00:00:00Z`);
const fromDbDate = (d: Date) => d.toISOString().slice(0, 10);
const fullName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`;
const nameSelect = { select: { id: true, firstName: true, lastName: true } } as const;
const currentYear = { academicYear: { isCurrent: true } };
const teaches = (userId: string): Prisma.CourseWhereInput => ({ OR: [{ teacherId: userId }, { coTeacherIds: { has: userId } }] });

async function schoolTz(): Promise<string> {
  const s = await prisma.schoolSettings.findUnique({ where: { id: 'singleton' }, select: { timezone: true } });
  return s?.timezone ?? 'UTC';
}

// ---------------------------------------------------------------------------
// Audience helpers
// ---------------------------------------------------------------------------

/** Grade levels of current-year courses the teacher teaches. */
async function teacherGradeIds(teacherId: string): Promise<string[]> {
  const courses = await prisma.course.findMany({
    where: { ...teaches(teacherId), ...currentYear, archivedAt: null, section: { isNot: null } },
    select: { section: { select: { gradeLevelId: true } } },
  });
  return [...new Set(courses.flatMap((c) => (c.section ? [c.section.gradeLevelId] : [])))];
}

async function childGradeIds(parentId: string): Promise<string[]> {
  const profiles = await prisma.studentProfile.findMany({
    where: { user: { studentLinks: { some: { parentId } } } },
    select: { gradeLevelId: true },
  });
  return [...new Set(profiles.map((p) => p.gradeLevelId))];
}

async function eventScope(user: AccessUser): Promise<Prisma.ConferenceEventWhereInput> {
  switch (user.role) {
    case 'ADMIN':
      return {};
    case 'TEACHER':
      return { OR: [{ gradeLevelIds: { hasSome: await teacherGradeIds(user.id) } }, { slots: { some: { teacherId: user.id } } }] };
    case 'PARENT':
      return { gradeLevelIds: { hasSome: await childGradeIds(user.id) } };
    default:
      return { id: '__none__' };
  }
}

/** Teacher ids for a student: teachers and co-teachers of their ACTIVE courses. */
async function teachersOfStudent(studentId: string): Promise<string[]> {
  const rows = await prisma.enrollment.findMany({
    where: { studentId, status: 'ACTIVE', course: { archivedAt: null } },
    select: { course: { select: { teacherId: true, coTeacherIds: true } } },
  });
  return [...new Set(rows.flatMap((r) => [r.course.teacherId, ...r.course.coTeacherIds]))];
}

async function teacherRefs(ids: string[]) {
  if (ids.length === 0) return new Map<string, { id: string; name: string; subjects: string[] }>();
  const [users, courses] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } }),
    prisma.course.findMany({
      where: { OR: [{ teacherId: { in: ids } }, { coTeacherIds: { hasSome: ids } }], ...currentYear, archivedAt: null },
      select: { teacherId: true, coTeacherIds: true, subject: { select: { name: true } } },
    }),
  ]);
  return new Map(
    users.map((u) => {
      const subjects = courses.filter((c) => c.teacherId === u.id || c.coTeacherIds.includes(u.id)).map((c) => c.subject.name);
      return [u.id, { id: u.id, name: fullName(u), subjects: [...new Set(subjects)].sort() }];
    }),
  );
}

// ---------------------------------------------------------------------------
// Events (FR-28)
// ---------------------------------------------------------------------------

const eventInclude = { createdBy: nameSelect } satisfies Prisma.ConferenceEventInclude;
type EventRow = Prisma.ConferenceEventGetPayload<{ include: typeof eventInclude }>;

async function serializeEvents(rows: EventRow[], now = new Date()) {
  const gradeIds = [...new Set(rows.flatMap((r) => r.gradeLevelIds))];
  const grades = gradeIds.length ? await prisma.gradeLevel.findMany({ where: { id: { in: gradeIds } }, select: { id: true, name: true, order: true } }) : [];
  const byId = new Map(grades.map((g) => [g.id, g]));
  return rows.map((e) => ({
    id: e.id,
    title: e.title,
    date: fromDbDate(e.date),
    bookingOpensAt: e.bookingOpensAt.toISOString(),
    bookingClosesAt: e.bookingClosesAt.toISOString(),
    slotMinutes: e.slotMinutes,
    gradeLevels: e.gradeLevelIds
      .flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
      .sort((a, b) => a.order - b.order)
      .map((g) => ({ id: g.id, name: g.name })),
    bookingOpen: e.bookingOpensAt <= now && now < e.bookingClosesAt,
    createdBy: { id: e.createdBy.id, name: fullName(e.createdBy) },
  }));
}

export type ConferenceEventDto = Awaited<ReturnType<typeof serializeEvents>>[number];

export async function listEvents(user: AccessUser, query: ConferenceListQuery, page: PaginationParams) {
  const tz = await schoolTz();
  const today = formatInSchoolTz(new Date(), 'yyyy-MM-dd', tz);
  const where: Prisma.ConferenceEventWhereInput = {
    AND: [
      await eventScope(user),
      query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {},
      query.upcoming ? { date: { gte: toDbDate(today) } } : {},
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.conferenceEvent.findMany({
      where,
      include: eventInclude,
      orderBy: [{ [query.sort.field]: query.sort.dir }, { id: 'asc' }],
      skip: page.skip,
      take: page.take,
    }),
    prisma.conferenceEvent.count({ where }),
  ]);
  return { rows: await serializeEvents(rows), meta: { page: page.page, pageSize: page.pageSize, total } };
}

/** 404 unless the caller is in the event's audience (NFR-5). */
async function loadVisibleEvent(user: AccessUser, id: string): Promise<EventRow> {
  const row = await prisma.conferenceEvent.findFirst({ where: { AND: [{ id }, await eventScope(user)] }, include: eventInclude });
  if (!row) throw new AppError('NOT_FOUND', 'Resource not found');
  return row;
}

export async function getEvent(user: AccessUser, id: string, opts: { studentId?: string } = {}) {
  const row = await loadVisibleEvent(user, id);
  const [dto] = await serializeEvents([row]);
  if (user.role === 'TEACHER') {
    return { ...dto, mySlotCount: await prisma.conferenceSlot.count({ where: { eventId: id, teacherId: user.id } }) };
  }
  if (user.role === 'PARENT' && opts.studentId) {
    await assertCanViewStudent(user, opts.studentId);
    const teacherIds = await teachersOfStudent(opts.studentId);
    const withSlots = await prisma.conferenceSlot.findMany({ where: { eventId: id, teacherId: { in: teacherIds } }, select: { teacherId: true }, distinct: ['teacherId'] });
    const refs = await teacherRefs(withSlots.map((s) => s.teacherId));
    return { ...dto, teachers: [...refs.values()].sort((a, b) => a.name.localeCompare(b.name)) };
  }
  return dto;
}

function checkClosesByEventEnd(date: string, closesAt: string | Date, tz: string) {
  const end = schoolMidnight(addDateDays(date, 1), tz);
  if (new Date(closesAt) > end) {
    throw new AppError('VALIDATION_ERROR', 'Booking must close by the end of the conference day.', {
      fieldErrors: { bookingClosesAt: ['Booking must close by the end of the conference day'] },
    });
  }
}

async function notifyEligibleTeachers(event: { id: string; title: string; date: Date; gradeLevelIds: string[] }) {
  const courses = await prisma.course.findMany({
    where: { ...currentYear, archivedAt: null, section: { gradeLevelId: { in: event.gradeLevelIds } } },
    select: { teacherId: true, coTeacherIds: true },
  });
  await notify({
    type: 'conference.slots_requested',
    userIds: courses.flatMap((c) => [c.teacherId, ...c.coTeacherIds]),
    title: `Set your availability: ${event.title}`,
    body: `Parent–teacher conferences on ${fromDbDate(event.date)}.`,
    link: `/conferences/${event.id}/availability`,
    email: { template: 'generic-notification' },
  });
}

export async function createEvent(admin: AccessUser, input: ConferenceEventInput, request?: Request) {
  const tz = await schoolTz();
  checkClosesByEventEnd(input.date, input.bookingClosesAt, tz);
  const grades = await prisma.gradeLevel.count({ where: { id: { in: input.gradeLevelIds } } });
  if (grades !== new Set(input.gradeLevelIds).size) throw new AppError('VALIDATION_ERROR', 'Unknown grade level.', { fieldErrors: { gradeLevelIds: ['Unknown grade level'] } });
  const row = await prisma.conferenceEvent.create({
    data: {
      title: input.title,
      date: toDbDate(input.date),
      bookingOpensAt: new Date(input.bookingOpensAt),
      bookingClosesAt: new Date(input.bookingClosesAt),
      slotMinutes: input.slotMinutes,
      gradeLevelIds: [...new Set(input.gradeLevelIds)],
      createdById: admin.id,
    },
    include: eventInclude,
  });
  await audit({ actorId: admin.id, action: 'conference_event.create', entityType: 'ConferenceEvent', entityId: row.id, metadata: { ...input }, request });
  await notifyEligibleTeachers(row);
  return (await serializeEvents([row]))[0];
}

export async function updateEvent(admin: AccessUser, id: string, patch: ConferenceEventPatch, request?: Request) {
  const before = await prisma.conferenceEvent.findUnique({ where: { id } });
  if (!before) throw new AppError('NOT_FOUND', 'Resource not found');
  const tz = await schoolTz();
  const merged = {
    date: patch.date ?? fromDbDate(before.date),
    bookingOpensAt: patch.bookingOpensAt ? new Date(patch.bookingOpensAt) : before.bookingOpensAt,
    bookingClosesAt: patch.bookingClosesAt ? new Date(patch.bookingClosesAt) : before.bookingClosesAt,
  };
  if (merged.bookingClosesAt <= merged.bookingOpensAt) {
    throw new AppError('VALIDATION_ERROR', 'Booking must close after it opens.', { fieldErrors: { bookingClosesAt: ['Booking must close after it opens'] } });
  }
  checkClosesByEventEnd(merged.date, merged.bookingClosesAt, tz);

  const structural = (patch.date !== undefined && patch.date !== fromDbDate(before.date)) || (patch.slotMinutes !== undefined && patch.slotMinutes !== before.slotMinutes);
  if (structural && (await prisma.conferenceSlot.count({ where: { eventId: id, bookedByParentId: { not: null } } })) > 0) {
    throw new AppError('CONFLICT', 'The date and slot length cannot change while slots are booked.', { reason: 'SLOT_BOOKED' });
  }

  const row = await prisma.conferenceEvent.update({
    where: { id },
    data: {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.date !== undefined ? { date: toDbDate(patch.date) } : {}),
      ...(patch.slotMinutes !== undefined ? { slotMinutes: patch.slotMinutes } : {}),
      ...(patch.gradeLevelIds !== undefined ? { gradeLevelIds: [...new Set(patch.gradeLevelIds)] } : {}),
      bookingOpensAt: merged.bookingOpensAt,
      bookingClosesAt: merged.bookingClosesAt,
    },
    include: eventInclude,
  });
  await audit({
    actorId: admin.id,
    action: 'conference_event.update',
    entityType: 'ConferenceEvent',
    entityId: id,
    metadata: { before: { title: before.title, date: fromDbDate(before.date), slotMinutes: before.slotMinutes }, patch },
    request,
  });
  const added = (patch.gradeLevelIds ?? []).filter((g) => !before.gradeLevelIds.includes(g));
  if (added.length) await notifyEligibleTeachers({ ...row, gradeLevelIds: added });
  return (await serializeEvents([row]))[0];
}

// ---------------------------------------------------------------------------
// Slots (FR-29, FR-30, FR-34)
// ---------------------------------------------------------------------------

const slotInclude = { bookedByParent: nameSelect, bookedForStudent: nameSelect } satisfies Prisma.ConferenceSlotInclude;
type SlotRow = Prisma.ConferenceSlotGetPayload<{ include: typeof slotInclude }>;

async function serializeSlots(user: AccessUser, rows: SlotRow[]) {
  const refs = await teacherRefs([...new Set(rows.map((r) => r.teacherId))]);
  return rows.map((s) => {
    const seesBooking = user.role === 'ADMIN' || s.teacherId === user.id || s.bookedByParentId === user.id;
    return {
      id: s.id,
      eventId: s.eventId,
      teacher: refs.get(s.teacherId) ?? { id: s.teacherId, name: '', subjects: [] },
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      location: s.location,
      blocked: s.blocked,
      available: !s.bookedByParentId && !s.blocked,
      booking:
        seesBooking && s.bookedByParent && s.bookedForStudent
          ? {
              parent: { id: s.bookedByParent.id, name: fullName(s.bookedByParent) },
              student: { id: s.bookedForStudent.id, firstName: s.bookedForStudent.firstName, lastName: s.bookedForStudent.lastName },
              parentNote: s.parentNote,
            }
          : null,
      mine: s.bookedByParentId === user.id,
    };
  });
}

export type ConferenceSlotDto = Awaited<ReturnType<typeof serializeSlots>>[number];

async function assertTeacherEligible(user: AccessUser, event: { id: string; gradeLevelIds: string[] }) {
  if (user.role !== 'TEACHER') throw new AppError('FORBIDDEN', 'Only teachers set availability.');
  const grades = await teacherGradeIds(user.id);
  if (!event.gradeLevelIds.some((g) => grades.includes(g))) {
    throw new AppError('FORBIDDEN', 'You do not teach students eligible for this event.');
  }
}

export async function setAvailability(user: AccessUser, eventId: string, input: AvailabilityInput) {
  const event = await loadVisibleEvent(user, eventId);
  await assertTeacherEligible(user, event);
  const tz = await schoolTz();
  const date = fromDbDate(event.date);
  const ranges = input.ranges.map((r) => ({ start: fromZonedTime(`${date}T${r.start}:00`, tz), end: fromZonedTime(`${date}T${r.end}:00`, tz) }));
  const generated = generateSlots(ranges, event.slotMinutes);
  const location = input.location || null;

  const result = await prisma.$transaction(async (tx) => {
    const removed = await tx.conferenceSlot.deleteMany({ where: { eventId, teacherId: user.id, bookedByParentId: null, blocked: false } });
    const kept = await tx.conferenceSlot.findMany({ where: { eventId, teacherId: user.id }, select: { startsAt: true, endsAt: true } });
    const fresh = generated.filter((g) => !kept.some((k) => overlaps(g, k)));
    if (fresh.length) {
      await tx.conferenceSlot.createMany({ data: fresh.map((g) => ({ eventId, teacherId: user.id, startsAt: g.startsAt, endsAt: g.endsAt, location })) });
    }
    return { removed: removed.count, kept: kept.length, created: fresh.length };
  });

  const rows = await prisma.conferenceSlot.findMany({ where: { eventId, teacherId: user.id }, include: slotInclude, orderBy: { startsAt: 'asc' } });
  return { slots: await serializeSlots(user, rows), ...result };
}

/** 404 when the slot's event is not visible to the caller; 403 NOT_SLOT_TEACHER for other teachers. */
async function loadManagedSlot(user: AccessUser, slotId: string) {
  const slot = await prisma.conferenceSlot.findUnique({ where: { id: slotId } });
  if (!slot) throw new AppError('NOT_FOUND', 'Resource not found');
  if (user.role === 'ADMIN' || slot.teacherId === user.id) return slot;
  if (user.role === 'TEACHER') throw new AppError('FORBIDDEN', 'This slot belongs to another teacher.', { reason: 'NOT_SLOT_TEACHER' });
  throw new AppError('NOT_FOUND', 'Resource not found');
}

export async function patchSlot(user: AccessUser, slotId: string, patch: SlotPatch) {
  const slot = await loadManagedSlot(user, slotId);
  if (patch.blocked === true && slot.bookedByParentId) throw new AppError('CONFLICT', 'A booked slot cannot be blocked.', { reason: 'SLOT_BOOKED' });
  const row = await prisma.conferenceSlot.update({
    where: { id: slotId },
    data: { ...(patch.blocked !== undefined ? { blocked: patch.blocked } : {}), ...(patch.location !== undefined ? { location: patch.location || null } : {}) },
    include: slotInclude,
  });
  return (await serializeSlots(user, [row]))[0];
}

export async function removeSlot(user: AccessUser, slotId: string) {
  await loadManagedSlot(user, slotId);
  const deleted = await prisma.conferenceSlot.deleteMany({ where: { id: slotId, bookedByParentId: null } });
  if (deleted.count === 0) throw new AppError('CONFLICT', 'A booked slot cannot be removed.', { reason: 'SLOT_BOOKED' });
  return { id: slotId };
}

/** PARENT: the child's teachers' slots; TEACHER: own (view=day → booked only); ADMIN: all (teacherId filter). */
export async function listSlots(user: AccessUser, eventId: string, query: SlotsQuery & { studentId?: string }) {
  const event = await loadVisibleEvent(user, eventId);
  let where: Prisma.ConferenceSlotWhereInput;
  if (user.role === 'PARENT') {
    if (!query.studentId) return [];
    await assertCanViewStudent(user, query.studentId);
    const profile = await prisma.studentProfile.findUnique({ where: { userId: query.studentId }, select: { gradeLevelId: true } });
    if (!profile || !event.gradeLevelIds.includes(profile.gradeLevelId)) return [];
    where = { eventId, teacherId: { in: await teachersOfStudent(query.studentId) } };
  } else if (user.role === 'TEACHER') {
    where = { eventId, teacherId: user.id };
  } else {
    where = { eventId, ...(query.teacherId ? { teacherId: query.teacherId } : {}) };
  }
  if (query.view === 'day') where = { ...where, bookedByParentId: { not: null } };
  const rows = await prisma.conferenceSlot.findMany({ where, include: slotInclude, orderBy: [{ startsAt: 'asc' }, { teacherId: 'asc' }] });
  return serializeSlots(user, rows);
}

/** FR-34: the teacher's booked slots, in order. */
export function teacherDay(user: AccessUser, eventId: string) {
  return listSlots(user, eventId, { view: 'day' });
}

// ---------------------------------------------------------------------------
// Book / cancel (FR-30 to FR-33, NFR-1)
// ---------------------------------------------------------------------------

function assertWindow(event: { bookingOpensAt: Date; bookingClosesAt: Date }, now: Date, action: 'book' | 'cancel') {
  const open = action === 'book' ? event.bookingOpensAt <= now && now < event.bookingClosesAt : now < event.bookingClosesAt;
  if (!open) {
    throw new AppError('VALIDATION_ERROR', action === 'book' ? 'Booking is not open for this event.' : 'Bookings can no longer be cancelled.', {
      reason: 'OUTSIDE_BOOKING_WINDOW',
    });
  }
}

export async function book(user: AccessUser, slotId: string, input: BookingInput) {
  if (user.role !== 'PARENT') throw new AppError('FORBIDDEN', 'Only parents can book conference slots.');
  await assertCanViewStudent(user, input.studentId);
  const slot = await prisma.conferenceSlot.findUnique({ where: { id: slotId }, include: { event: true, teacher: nameSelect } });
  if (!slot) throw new AppError('NOT_FOUND', 'Resource not found');
  const [profile, teacherIds] = await Promise.all([
    prisma.studentProfile.findUnique({ where: { userId: input.studentId }, select: { gradeLevelId: true } }),
    teachersOfStudent(input.studentId),
  ]);
  if (!profile || !slot.event.gradeLevelIds.includes(profile.gradeLevelId) || !teacherIds.includes(slot.teacherId)) {
    throw new AppError('NOT_FOUND', 'Resource not found');
  }
  assertWindow(slot.event, new Date(), 'book');
  const tz = await schoolTz();

  try {
    await prisma.$transaction(async (tx) => {
      const mine = await tx.conferenceSlot.findMany({
        where: { bookedByParentId: user.id, id: { not: slotId }, startsAt: { lt: slot.endsAt }, endsAt: { gt: slot.startsAt } },
        include: { teacher: nameSelect },
        take: 1,
      });
      if (mine.length) {
        const clash = mine[0];
        throw new AppError('CONFLICT', `You already have a meeting with ${fullName(clash.teacher)} at ${formatInSchoolTz(clash.startsAt, 'HH:mm', tz)}`, {
          reason: 'OVERLAP',
        });
      }
      const claimed = await tx.conferenceSlot.updateMany({
        where: { id: slotId, bookedByParentId: null, blocked: false },
        data: { bookedByParentId: user.id, bookedForStudentId: input.studentId, parentNote: input.parentNote || null, bookedAt: new Date() },
      });
      if (claimed.count === 0) throw new AppError('CONFLICT', 'That slot was just taken', { reason: 'SLOT_TAKEN' });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError('CONFLICT', `You already have a meeting with ${fullName(slot.teacher)} for this child.`, { reason: 'ONE_PER_TEACHER' });
    }
    throw error;
  }

  const when = `${formatInSchoolTz(slot.startsAt, 'EEEE d MMM, HH:mm', tz)}`;
  await notify({
    type: 'conference.booked',
    userIds: [user.id, slot.teacherId],
    title: `Conference booked: ${slot.event.title}`,
    body: `${when} with ${fullName(slot.teacher)}. Add to calendar: /api/conference-slots/${slotId}/ics`,
    link: `/conferences/${slot.eventId}`,
    email: { template: 'generic-notification' },
  });
  const row = await prisma.conferenceSlot.findUniqueOrThrow({ where: { id: slotId }, include: slotInclude });
  return (await serializeSlots(user, [row]))[0];
}

export async function cancel(user: AccessUser, slotId: string) {
  const slot = await prisma.conferenceSlot.findUnique({ where: { id: slotId }, include: { event: true, teacher: nameSelect } });
  if (!slot) throw new AppError('NOT_FOUND', 'Resource not found');
  if (user.role !== 'ADMIN') {
    if (user.role === 'TEACHER' && slot.teacherId !== user.id) throw new AppError('NOT_FOUND', 'Resource not found');
    if (slot.bookedByParentId !== user.id) throw new AppError('FORBIDDEN', 'Only the parent who booked can cancel.', { reason: 'NOT_BOOKER' });
  }
  if (!slot.bookedByParentId) throw new AppError('CONFLICT', 'This slot is not booked.', { reason: 'SLOT_TAKEN' });
  assertWindow(slot.event, new Date(), 'cancel');
  const parentId = slot.bookedByParentId;
  const cleared = await prisma.conferenceSlot.updateMany({
    where: { id: slotId, bookedByParentId: parentId },
    data: { bookedByParentId: null, bookedForStudentId: null, parentNote: null, bookedAt: null },
  });
  if (cleared.count === 0) throw new AppError('CONFLICT', 'This booking has already changed.', { reason: 'SLOT_TAKEN' });

  const tz = await schoolTz();
  await notify({
    type: 'conference.cancelled',
    userIds: [parentId, slot.teacherId],
    title: `Conference cancelled: ${slot.event.title}`,
    body: `${formatInSchoolTz(slot.startsAt, 'EEEE d MMM, HH:mm', tz)} with ${fullName(slot.teacher)} was cancelled.`,
    link: `/conferences/${slot.eventId}`,
    email: { template: 'generic-notification' },
  });
  const row = await prisma.conferenceSlot.findUniqueOrThrow({ where: { id: slotId }, include: slotInclude });
  return (await serializeSlots(user, [row]))[0];
}

// ---------------------------------------------------------------------------
// My meetings + ics (FR-33, FR-35)
// ---------------------------------------------------------------------------

/** Booked slots where the caller is the booking parent or the teacher (optionally one child), in range. */
export async function listMyMeetings(user: AccessUser, range: { from: Date; to: Date }, opts: { studentId?: string } = {}) {
  const rows = await prisma.conferenceSlot.findMany({
    where: {
      bookedByParentId: { not: null },
      startsAt: { gte: range.from, lt: range.to },
      OR: [{ bookedByParentId: user.id }, { teacherId: user.id }],
      ...(opts.studentId ? { bookedForStudentId: opts.studentId } : {}),
    },
    include: { event: { select: { id: true, title: true } }, teacher: nameSelect, bookedForStudent: nameSelect },
    orderBy: { startsAt: 'asc' },
  });
  return rows.map((s) => ({
    id: s.id,
    eventId: s.event.id,
    title: `${s.event.title}: ${fullName(s.teacher)}${s.bookedForStudent ? ` (${s.bookedForStudent.firstName})` : ''}`,
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    location: s.location,
  }));
}

export async function slotIcs(user: AccessUser, slotId: string): Promise<string> {
  const slot = await prisma.conferenceSlot.findUnique({ where: { id: slotId }, include: { event: true, teacher: nameSelect, bookedForStudent: nameSelect } });
  if (!slot || !(user.role === 'ADMIN' || slot.teacherId === user.id || (slot.bookedByParentId && slot.bookedByParentId === user.id))) {
    throw new AppError('NOT_FOUND', 'Resource not found');
  }
  const tz = await schoolTz();
  const who = slot.bookedForStudent ? ` about ${fullName(slot.bookedForStudent)}` : '';
  return buildCalendar(
    [
      {
        uid: `slot-${slot.id}`,
        title: `${slot.event.title}: ${fullName(slot.teacher)}${who}`,
        location: slot.location,
        start: slot.startsAt,
        end: slot.endsAt,
        allDay: false,
      },
    ],
    tz,
    { from: slot.startsAt, to: slot.endsAt },
    { name: slot.event.title },
  );
}
