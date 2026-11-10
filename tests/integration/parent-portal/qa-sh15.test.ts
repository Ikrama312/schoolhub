// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DATABASE_URL ??= 'postgresql://unused@localhost/unused';
  process.env.APP_URL ??= 'http://localhost:3000';
  process.env.AUTH_SECRET ??= 'test-secret';
});

import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import { schoolToday, addDays } from '@/server/attendance/attendance-rules';
import { schoolMidnight } from '@/lib/dates';
import { book, cancel, createEvent, listMyMeetings, patchSlot, setAvailability, teacherDay } from '@/server/conferences/conferences-service';
import { trackingQuery } from '@/lib/validators/consent-forms';
import * as consent from '@/server/consent-forms/consent-forms-service';
import { getActionItems, getOverview, getUpcomingEvents } from '@/server/parent/overview-service';

/**
 * QA SH-15 gap coverage (not covered by Dev's tests):
 * consent forms FR-36..FR-40 + NFR-3 (IP in audit), conferences FR-29 (block),
 * FR-31 cross-teacher overlap message, FR-32 window, FR-33 notifications, FR-34 day view, FR-35 my meetings.
 */
const MARK = 'qa-sh15-pp';
const email = (n: string) => `${n}@${MARK}.test`;
const ids = {} as Record<string, string>;
const U = (k: string, role: 'ADMIN' | 'TEACHER' | 'PARENT') => ({ id: ids[k], role });
const page = { page: 1, pageSize: 50, skip: 0, take: 50 };
const req = () => new Request('http://localhost/x', { headers: { 'x-forwarded-for': '203.0.113.7' } });
let tz = 'UTC';

async function code(p: Promise<unknown>) {
  try {
    await p;
    return { code: 'OK' };
  } catch (e) {
    if (e instanceof AppError) return { code: e.code, reason: (e.details as { reason?: string } | undefined)?.reason, message: e.message };
    throw e;
  }
}
const notifs = (userId: string, type: string) => prisma.notification.findMany({ where: { userId, type } });

describe.skipIf(!process.env.TEST_DATABASE_URL)('SH-15 QA: consent forms + conference rules (integration)', () => {
  beforeAll(async () => {
    tz = (await prisma.schoolSettings.findUnique({ where: { id: 'singleton' } }))?.timezone ?? 'UTC';
    const mk = (n: string, role: 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT') =>
      prisma.user.create({ data: { email: email(n), firstName: 'QA', lastName: n, role, status: 'ACTIVE' } }).then((u) => u.id);
    for (const [n, r] of [['admin', 'ADMIN'], ['t1', 'TEACHER'], ['t2', 'TEACHER'], ['t3', 'TEACHER'], ['p1', 'PARENT'], ['p2', 'PARENT'], ['s1', 'STUDENT']] as const) ids[n] = await mk(n, r);
    const order = 9000 + Math.floor(Math.random() * 900);
    const year =
      (await prisma.academicYear.findFirst({ where: { isCurrent: true } })) ??
      (await prisma.academicYear.create({ data: { name: MARK, startDate: new Date('2026-01-01'), endDate: new Date('2027-12-31'), isCurrent: true } }));
    ids.grade = (await prisma.gradeLevel.create({ data: { name: MARK, shortName: MARK, order } })).id;
    ids.subject = (await prisma.subject.create({ data: { name: MARK, code: MARK.toUpperCase() } })).id;
    ids.section = (await prisma.section.create({ data: { name: MARK, academicYearId: year.id, gradeLevelId: ids.grade } })).id;
    for (const t of ['t1', 't2']) {
      ids[`c${t}`] = (await prisma.course.create({ data: { name: `${MARK}-${t}`, code: `${MARK}-${t}`, academicYearId: year.id, subjectId: ids.subject, sectionId: ids.section, teacherId: ids[t] } })).id;
      await prisma.enrollment.create({ data: { courseId: ids[`c${t}`], studentId: ids.s1 } });
    }
    await prisma.studentProfile.create({ data: { userId: ids.s1, admissionNumber: `${MARK}-1`, dateOfBirth: new Date('2014-01-01'), gradeLevelId: ids.grade, enrollmentDate: new Date('2026-08-17') } });
    await prisma.parentStudentLink.createMany({
      data: [
        { parentId: ids.p1, studentId: ids.s1, relationship: 'MOTHER' },
        { parentId: ids.p2, studentId: ids.s1, relationship: 'FATHER' },
      ],
    });
    const date = addDays(schoolToday(new Date(), tz), 7);
    ids.event = (
      await prisma.conferenceEvent.create({
        data: { title: MARK, date: new Date(`${date}T00:00:00Z`), bookingOpensAt: new Date(Date.now() - 3_600_000), bookingClosesAt: schoolMidnight(date, tz), slotMinutes: 10, gradeLevelIds: [ids.grade], createdById: ids.admin },
      })
    ).id;
  });

  afterAll(async () => {
    const users = ['admin', 't1', 't2', 't3', 'p1', 'p2', 's1'].map((k) => ids[k]).filter(Boolean);
    await prisma.consentForm.deleteMany({ where: { createdById: { in: users } } });
    await prisma.conferenceEvent.deleteMany({ where: { id: { in: [ids.event, ids.event2].filter(Boolean) } } });
    await prisma.course.deleteMany({ where: { id: { in: [ids.ct1, ids.ct2].filter(Boolean) } } });
    await prisma.section.deleteMany({ where: { id: ids.section } });
    await prisma.studentProfile.deleteMany({ where: { userId: { in: users } } });
    await prisma.subject.deleteMany({ where: { id: ids.subject } });
    await prisma.gradeLevel.deleteMany({ where: { id: ids.grade } });
    await prisma.academicYear.deleteMany({ where: { name: MARK } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: users } } });
    await prisma.emailOutbox.deleteMany({ where: { toEmail: { endsWith: `@${MARK}.test` } } });
    await prisma.notification.deleteMany({ where: { userId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });

  // ---------------- Consent forms ----------------

  it('FR-36: admin creates a grade-level form → both linked parents get consent.requested; teacher cannot target a grade', async () => {
    const dueAt = new Date(Date.now() + 10 * 86_400_000).toISOString();
    const form = await consent.create(U('admin', 'ADMIN'), { title: MARK, description: '**Trip**', dueAt, eventId: null, audiences: [{ type: 'GRADE_LEVEL', refId: ids.grade }] });
    ids.form = form.id;
    expect(form.notifiedParents).toBe(2);
    expect(await notifs(ids.p1, 'consent.requested')).toHaveLength(1);
    expect(await notifs(ids.p2, 'consent.requested')).toHaveLength(1);
    const t = await code(consent.create(U('t1', 'TEACHER'), { title: 'x', description: 'x', dueAt, eventId: null, audiences: [{ type: 'GRADE_LEVEL', refId: ids.grade }] }));
    expect(t.code).toBe('FORBIDDEN');
  });

  it('FR-16 + NFR-5: action items list the pending consent form and the open conference; unrelated teacher cannot load the overview', async () => {
    const items = await getActionItems(U('p1', 'PARENT'), ids.s1);
    expect(items.map((i) => `${i.type}:${i.id}`).sort()).toEqual([`conference:${ids.event}`, `consent:${ids.form}`].sort());
    expect((await code(getOverview(U('t3', 'TEACHER'), ids.s1, ['actions']))).code).not.toBe('OK');
  });

  it('FR-37: signature must match the parent name (case-insensitive)', async () => {
    const bad = await code(consent.respond(U('p1', 'PARENT'), ids.form, { studentId: ids.s1, value: 'GRANTED', signature: 'Someone Else' }));
    expect(bad).toMatchObject({ code: 'VALIDATION_ERROR', reason: 'SIGNATURE_MISMATCH' });
    const r = await consent.respond(U('p1', 'PARENT'), ids.form, { studentId: ids.s1, value: 'GRANTED', signature: 'qa P1' }, req());
    expect(r).toMatchObject({ value: 'GRANTED', changed: false });
  });

  it('FR-38 + NFR-3: one response per student; second parent changes it; both writes audited with IP', async () => {
    const r = await consent.respond(U('p2', 'PARENT'), ids.form, { studentId: ids.s1, value: 'DECLINED', signature: 'QA p2', comment: 'No' }, req());
    expect(r).toMatchObject({ value: 'DECLINED', changed: true });
    expect(await prisma.consentResponse.count({ where: { formId: ids.form } })).toBe(1);
    const logs = await prisma.auditLog.findMany({ where: { entityId: ids.form, action: { startsWith: 'consent_response.' } }, orderBy: { createdAt: 'asc' } });
    expect(logs.map((l) => l.action)).toEqual(['consent_response.create', 'consent_response.update']);
    expect(logs.every((l) => l.ip === '203.0.113.7')).toBe(true);
  });

  it('FR-39: tracking per student + CSV for owner/admin only', async () => {
    const t = (await consent.tracking(U('admin', 'ADMIN'), ids.form, trackingQuery.parse({}), page)) as { rows: { status: string }[]; meta: { counts: Record<string, number> } };
    expect(t.rows.map((r) => r.status)).toEqual(['DECLINED']);
    expect(t.meta.counts).toEqual({ granted: 0, declined: 1, noResponse: 0 });
    const csv = (await consent.tracking(U('admin', 'ADMIN'), ids.form, trackingQuery.parse({ format: 'csv' }), page)) as { csv: string };
    expect(csv.csv).toContain('Declined');
    expect((await code(consent.tracking(U('t3', 'TEACHER'), ids.form, trackingQuery.parse({}), page))).code).not.toBe('OK');
    expect((await code(consent.tracking(U('p1', 'PARENT'), ids.form, trackingQuery.parse({}), page))).code).toBe('FORBIDDEN');
  });

  it('FR-39: "Remind non-responders" throttled to once per 24h', async () => {
    expect((await code(consent.remind(U('admin', 'ADMIN'), ids.form))).code).toBe('OK');
    expect((await code(consent.remind(U('admin', 'ADMIN'), ids.form))).code).toBe('RATE_LIMITED');
  });

  it('FR-40: 48h-before-due reminder goes once to non-responding parents; FR-38: no change after dueAt', async () => {
    const soon = await consent.create(U('admin', 'ADMIN'), { title: `${MARK}-soon`, description: 'x', dueAt: new Date(Date.now() + 24 * 3_600_000).toISOString(), eventId: null, audiences: [{ type: 'GRADE_LEVEL', refId: ids.grade }] });
    await consent.sendConsentDueReminders(new Date());
    expect((await prisma.consentForm.findUniqueOrThrow({ where: { id: soon.id } })).dueReminderSentAt).not.toBeNull();
    expect(await notifs(ids.p1, 'consent.reminder')).toHaveLength(1);
    await consent.sendConsentDueReminders(new Date());
    expect(await notifs(ids.p1, 'consent.reminder')).toHaveLength(1);

    await prisma.consentForm.update({ where: { id: soon.id }, data: { dueAt: new Date(Date.now() - 1000) } });
    expect(await code(consent.respond(U('p1', 'PARENT'), soon.id, { studentId: ids.s1, value: 'GRANTED', signature: 'QA p1' }))).toMatchObject({ reason: 'PAST_DUE' });
  });

  // ---------------- Conferences ----------------

  it('FR-28: admin-created event notifies teachers of eligible grades (conference.slots_requested)', async () => {
    const d = addDays(schoolToday(new Date(), tz), 14);
    const ev = await createEvent(U('admin', 'ADMIN'), { title: `${MARK}-new`, date: d, bookingOpensAt: new Date().toISOString(), bookingClosesAt: schoolMidnight(d, tz).toISOString(), slotMinutes: 15, gradeLevelIds: [ids.grade] });
    ids.event2 = ev.id;
    expect(await notifs(ids.t1, 'conference.slots_requested')).toHaveLength(1);
    expect(await notifs(ids.t2, 'conference.slots_requested')).toHaveLength(1);
    expect(await notifs(ids.t3, 'conference.slots_requested')).toHaveLength(0);
  });

  it('FR-29: availability generates slots; teacher can block an unbooked slot and blocked slots cannot be booked', async () => {
    const a = await setAvailability(U('t1', 'TEACHER'), ids.event, { ranges: [{ start: '15:00', end: '15:30' }] });
    const b = await setAvailability(U('t2', 'TEACHER'), ids.event, { ranges: [{ start: '15:00', end: '15:30' }] });
    expect(a.slots).toHaveLength(3);
    ids.t1a = a.slots[0].id;
    [ids.t2a, ids.t2b, ids.t2c] = b.slots.map((s) => s.id);
    await patchSlot(U('t2', 'TEACHER'), ids.t2b, { blocked: true });
    expect(await code(book(U('p1', 'PARENT'), ids.t2b, { studentId: ids.s1 }))).toMatchObject({ code: 'CONFLICT' });
    expect((await code(patchSlot(U('t1', 'TEACHER'), ids.t2c, { blocked: true }))).reason).toBe('NOT_SLOT_TEACHER');
  });

  it('FR-31: overlapping booking with another teacher → "You already have a meeting with <teacher> at <time>"', async () => {
    await book(U('p1', 'PARENT'), ids.t1a, { studentId: ids.s1, parentNote: 'Maths worries' });
    const r = await code(book(U('p1', 'PARENT'), ids.t2a, { studentId: ids.s1 }));
    expect(r).toMatchObject({ code: 'CONFLICT', reason: 'OVERLAP' });
    expect(r.message).toBe('You already have a meeting with QA t1 at 15:00');
    expect((await code(book(U('p1', 'PARENT'), ids.t2c, { studentId: ids.s1 }))).code).toBe('OK');
  });

  it('FR-33: booking notifies parent and teacher with an .ics link', async () => {
    const [n] = await notifs(ids.t1, 'conference.booked');
    expect(n.body).toContain(`/api/conference-slots/${ids.t1a}/ics`);
    expect(await notifs(ids.p1, 'conference.booked')).toHaveLength(2);
  });

  it('FR-34 / FR-35: teacher day view shows booked slots with student + note; meetings list for both parties', async () => {
    const day = await teacherDay(U('t1', 'TEACHER'), ids.event);
    expect(day).toHaveLength(1);
    expect(day[0].booking).toMatchObject({ student: { id: ids.s1 }, parentNote: 'Maths worries' });
    const range = { from: new Date(Date.now()), to: new Date(Date.now() + 30 * 86_400_000) };
    expect(await listMyMeetings(U('p1', 'PARENT'), range)).toHaveLength(2);
    expect(await listMyMeetings(U('t1', 'TEACHER'), range)).toHaveLength(1);
    const upcoming = await getUpcomingEvents(U('p1', 'PARENT'), ids.s1);
    expect(upcoming.filter((e) => e.source === 'myMeetings')).toHaveLength(2);
    // NFR-2 proxy: all eight overview cards resolve server-side well under the 2 s page budget.
    const t0 = performance.now();
    const all = await getOverview(U('p1', 'PARENT'), ids.s1);
    expect(Object.keys(all)).toHaveLength(8);
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it('FR-32: cancel then re-book works in-window; after bookingClosesAt neither cancel nor book is allowed', async () => {
    await cancel(U('p1', 'PARENT'), ids.t2c);
    expect(await notifs(ids.t2, 'conference.cancelled')).toHaveLength(1);
    await book(U('p1', 'PARENT'), ids.t2c, { studentId: ids.s1 });
    await prisma.conferenceEvent.update({ where: { id: ids.event }, data: { bookingClosesAt: new Date(Date.now() - 1000) } });
    expect(await code(cancel(U('p1', 'PARENT'), ids.t2c))).toMatchObject({ reason: 'OUTSIDE_BOOKING_WINDOW' });
    expect(await code(book(U('p2', 'PARENT'), ids.t2a, { studentId: ids.s1 }))).toMatchObject({ reason: 'OUTSIDE_BOOKING_WINDOW' });
  });
});
