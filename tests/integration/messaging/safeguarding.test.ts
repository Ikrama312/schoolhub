// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DATABASE_URL ??= 'postgresql://unused@localhost/unused';
  process.env.APP_URL ??= 'http://localhost:3000';
  process.env.AUTH_SECRET ??= 'test-secret';
});

import { prisma } from '@/server/db';
import { __resetRateLimits } from '@/server/rate-limit';
import { createConversationSchema } from '@/lib/validators/messaging';
import { createConversation } from '@/server/messaging/conversations';
import { deleteMessage, editMessage } from '@/server/messaging/messages';
import { reportMessage } from '@/server/messaging/reports';
import { getConversationForSafeguarding, getReport, listReports, reviewReport, searchConversations } from '@/server/messaging/safeguarding';
import { updateUser } from '@/server/services/users';

/** PRD-13 FR-23..FR-25, NFR-1, NFR-3, NFR-11, FR-2 integration: lead-only access, audit on every view, retained content. */
const MARK = 'it-sh13-sg';
type R = 'ADMIN' | 'TEACHER' | 'STUDENT';
const ids = {} as Record<'year' | 'subject' | 'course' | 'lead' | 'admin' | 't' | 't2' | 's', string>;
const as = (k: keyof typeof ids, role: R) => ({ id: ids[k], role });
const LEAD = () => as('lead', 'ADMIN');
const page = { skip: 0, take: 100 };
const code = (p: Promise<unknown>) => p.then(() => 'OK', (e: { code?: string }) => e.code ?? String(e));
const views = (conversationId: string) =>
  prisma.auditLog.count({ where: { actorId: ids.lead, action: 'safeguarding.conversation.view', entityType: 'Conversation', entityId: conversationId } });

describe.skipIf(!process.env.TEST_DATABASE_URL)('safeguarding (integration)', () => {
  let studentConv = '';
  let staffConv = '';
  let reportedId = '';

  beforeAll(async () => {
    const mk = (n: string, role: R, extra = {}) =>
      prisma.user.create({ data: { email: `${n}@${MARK}.test`, firstName: n, lastName: 'QA', role, status: 'ACTIVE', ...extra } }).then((u) => u.id);
    Object.assign(ids, {
      lead: await mk('lead', 'ADMIN', { isSafeguardingLead: true }),
      admin: await mk('admin', 'ADMIN'),
      t: await mk('t', 'TEACHER'),
      t2: await mk('t2', 'TEACHER'),
      s: await mk('s', 'STUDENT'),
    });
    ids.year = (await prisma.academicYear.create({ data: { name: MARK, startDate: new Date('2026-08-01'), endDate: new Date('2027-07-01') } })).id;
    ids.subject = (await prisma.subject.create({ data: { name: MARK, code: MARK.toUpperCase() } })).id;
    ids.course = (await prisma.course.create({ data: { name: MARK, code: MARK, academicYearId: ids.year, subjectId: ids.subject, teacherId: ids.t } })).id;
    await prisma.enrollment.create({ data: { courseId: ids.course, studentId: ids.s } });

    const a = await createConversation(as('s', 'STUDENT'), createConversationSchema.parse({ participantIds: [ids.t], body: 'original text', subject: MARK }));
    studentConv = a.conversation.id;
    await editMessage(as('s', 'STUDENT'), a.message.id, 'edited text');
    await deleteMessage(as('s', 'STUDENT'), a.message.id);
    reportedId = a.message.id;
    staffConv = (await createConversation(as('t', 'TEACHER'), createConversationSchema.parse({ participantIds: [ids.t2], body: 'staff only', subject: MARK }))).conversation.id;
  });

  beforeEach(() => __resetRateLimits());

  afterAll(async () => {
    const users = [ids.lead, ids.admin, ids.t, ids.t2, ids.s];
    await prisma.conversation.deleteMany({ where: { createdById: { in: users } } });
    await prisma.course.deleteMany({ where: { code: MARK } });
    await prisma.notification.deleteMany({ where: { userId: { in: users } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: users } }, { entityId: { in: users } }] } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.subject.deleteMany({ where: { code: MARK.toUpperCase() } });
    await prisma.academicYear.deleteMany({ where: { name: MARK } });
    await prisma.$disconnect();
  });

  it('NFR-1/FR-23: non-lead admins and teachers get 403 everywhere', async () => {
    for (const user of [as('admin', 'ADMIN'), as('t', 'TEACHER')]) {
      expect(await code(listReports(user, page))).toBe('FORBIDDEN');
      expect(await code(searchConversations(user, page))).toBe('FORBIDDEN');
      expect(await code(getConversationForSafeguarding(user, studentConv))).toBe('FORBIDDEN');
    }
  });

  it('FR-24/FR-25/NFR-3: student conversations only; deleted body and revisions visible; every view audited', async () => {
    const found = await searchConversations(LEAD(), { ...page, participantId: ids.s });
    expect(found.data.map((c) => c.id)).toEqual([studentConv]);
    expect(await code(getConversationForSafeguarding(LEAD(), staffConv))).toBe('NOT_FOUND');

    const before = await views(studentConv);
    const view = await getConversationForSafeguarding(LEAD(), studentConv);
    await getConversationForSafeguarding(LEAD(), studentConv);
    expect(await views(studentConv)).toBe(before + 2);
    expect(view.messages[0]).toMatchObject({ body: 'edited text', deleted: true, revisions: [{ body: 'original text' }] });
  });

  it('FR-23/NFR-11: report detail is audited; review needs a note; a handled report is 409', async () => {
    const msg = await prisma.message.create({ data: { conversationId: studentConv, senderId: ids.s, body: 'please look' } });
    const { reportId } = await reportMessage(as('t', 'TEACHER'), msg.id, 'worried');

    const list = await listReports(LEAD(), page);
    expect(list.data[0].status).toBe('OPEN');
    const before = await views(studentConv);
    const detail = await getReport(LEAD(), reportId);
    expect(await views(studentConv)).toBe(before + 1);
    expect(detail.before.map((m) => m.id)).toContain(reportedId); // deleted context is included

    expect(await code(reviewReport(LEAD(), reportId, { action: 'review' }))).toBe('VALIDATION_ERROR');
    const reviewed = await reviewReport(LEAD(), reportId, { action: 'review', note: 'Spoke to the student.' });
    expect(reviewed.report).toMatchObject({ status: 'REVIEWED', reviewNote: 'Spoke to the student.' });
    expect(await code(reviewReport(LEAD(), reportId, { action: 'dismiss' }))).toBe('CONFLICT');
    expect(await prisma.auditLog.count({ where: { actorId: ids.lead, action: 'safeguarding.report.review', entityId: reportId } })).toBe(1);
  });

  it('FR-2: isSafeguardingLead can only be set on an ADMIN, and the change is audited', async () => {
    const err = await updateUser(ids.t, { isSafeguardingLead: true }).catch((e) => e);
    expect(err).toMatchObject({ code: 'VALIDATION_ERROR', details: { reason: 'SAFEGUARDING_LEAD_REQUIRES_ADMIN' } });
    const updated = await updateUser(ids.admin, { isSafeguardingLead: true }, { actorId: ids.lead });
    expect(updated.isSafeguardingLead).toBe(true);
    const row = await prisma.auditLog.findFirst({ where: { action: 'user.update', entityId: ids.admin } });
    expect(row?.metadata).toMatchObject({ isSafeguardingLead: { old: false, new: true } });
  });
});
