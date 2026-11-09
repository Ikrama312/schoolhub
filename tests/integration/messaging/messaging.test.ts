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
import { createConversation, getConversation, leave, markRead, setMuted, unreadCount } from '@/server/messaging/conversations';
import { deleteMessage, editMessage, listMessages, sendMessage } from '@/server/messaging/messages';
import { reportMessage } from '@/server/messaging/reports';
import { conversationLink } from '@/server/messaging/notifications';

/**
 * PRD-13 NFR-10 integration: notification collapse, mute, rate limit, 404 for non-/ex-participants,
 * edit revisions + 15-minute window, duplicate report 409, contact rules on create/send.
 * Real migrated Postgres; fixtures tagged with MARK. Skipped without TEST_DATABASE_URL.
 */
const MARK = 'it-sh13-msg';
type R = 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT';
const ids = {} as Record<'year' | 'subject' | 'course' | 'lead' | 't' | 't2' | 's1' | 's2' | 'p', string>;
const as = (k: keyof typeof ids, role: R) => ({ id: ids[k], role });
const T = () => as('t', 'TEACHER');
const P = () => as('p', 'PARENT');
const S1 = () => as('s1', 'STUDENT');
const S2 = () => as('s2', 'STUDENT');
const code = (p: Promise<unknown>) => p.then(() => 'OK', (e: { code?: string }) => e.code ?? String(e));
const reason = (p: Promise<unknown>) => p.then(() => 'OK', (e: { details?: { reason?: string } }) => e.details?.reason ?? 'none');
const create = (user: { id: string; role: R }, participantIds: string[], body = 'hello') =>
  createConversation(user, createConversationSchema.parse({ participantIds, body, subject: MARK }));

describe.skipIf(!process.env.TEST_DATABASE_URL)('messaging (integration)', () => {
  beforeAll(async () => {
    const mk = (n: string, role: R, extra = {}) =>
      prisma.user.create({ data: { email: `${n}@${MARK}.test`, firstName: n, lastName: 'QA', role, status: 'ACTIVE', ...extra } }).then((u) => u.id);
    Object.assign(ids, {
      lead: await mk('lead', 'ADMIN', { isSafeguardingLead: true }),
      t: await mk('t', 'TEACHER'),
      t2: await mk('t2', 'TEACHER'),
      s1: await mk('s1', 'STUDENT'),
      s2: await mk('s2', 'STUDENT'),
      p: await mk('p', 'PARENT'),
    });
    await prisma.parentStudentLink.create({ data: { parentId: ids.p, studentId: ids.s1, relationship: 'MOTHER', isPrimary: true } });
    ids.year = (await prisma.academicYear.create({ data: { name: MARK, startDate: new Date('2026-08-01'), endDate: new Date('2027-07-01') } })).id;
    ids.subject = (await prisma.subject.create({ data: { name: MARK, code: MARK.toUpperCase() } })).id;
    ids.course = (await prisma.course.create({ data: { name: MARK, code: MARK, academicYearId: ids.year, subjectId: ids.subject, teacherId: ids.t } })).id;
    await prisma.enrollment.createMany({ data: [ids.s1, ids.s2].map((studentId) => ({ courseId: ids.course, studentId })) });
  });

  beforeEach(() => __resetRateLimits());

  afterAll(async () => {
    const users = Object.entries(ids).filter(([k]) => !['year', 'subject', 'course'].includes(k)).map(([, v]) => v);
    await prisma.conversation.deleteMany({ where: { createdById: { in: users } } });
    await prisma.course.deleteMany({ where: { code: MARK } });
    await prisma.notification.deleteMany({ where: { userId: { in: users } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.subject.deleteMany({ where: { code: MARK.toUpperCase() } });
    await prisma.academicYear.deleteMany({ where: { name: MARK } });
    await prisma.$disconnect();
  });

  it('FR-19/FR-20: three sends leave one unread notification and one pending email (first message starts the clock)', async () => {
    const { conversation } = await create(P(), [ids.t], 'first');
    const pending1 = await prisma.pendingMessageEmail.findUniqueOrThrow({ where: { userId_conversationId: { userId: ids.t, conversationId: conversation.id } } });
    await sendMessage(P(), conversation.id, { body: 'second' });
    await sendMessage(P(), conversation.id, { body: 'third' });
    const unread = await prisma.notification.findMany({ where: { userId: ids.t, type: 'message.received', readAt: null, link: conversationLink(conversation.id) } });
    expect(unread).toHaveLength(1);
    expect(unread[0].body).toBe('third');
    const pending = await prisma.pendingMessageEmail.findMany({ where: { userId: ids.t, conversationId: conversation.id } });
    expect(pending).toHaveLength(1);
    expect(pending[0].dueAt).toEqual(pending1.dueAt);
    // The sender gets nothing and has read their own message.
    expect(await prisma.notification.count({ where: { userId: ids.p, link: conversationLink(conversation.id) } })).toBe(0);
    expect(await unreadCount(ids.t)).toBeGreaterThanOrEqual(1);

    await markRead(T(), conversation.id);
    expect(await prisma.notification.count({ where: { userId: ids.t, readAt: null, link: conversationLink(conversation.id) } })).toBe(0);
    expect(await prisma.pendingMessageEmail.count({ where: { userId: ids.t, conversationId: conversation.id } })).toBe(0);
  });

  it('FR-19: muted participants get no notification and no pending email', async () => {
    const { conversation } = await create(P(), [ids.t]);
    await markRead(T(), conversation.id);
    await setMuted(T(), conversation.id, true);
    await sendMessage(P(), conversation.id, { body: 'while muted' });
    expect(await prisma.notification.count({ where: { userId: ids.t, readAt: null, link: conversationLink(conversation.id) } })).toBe(0);
    expect(await prisma.pendingMessageEmail.count({ where: { userId: ids.t, conversationId: conversation.id } })).toBe(0);
  });

  it('NFR-4: the 31st message in a minute is 429 RATE_LIMITED with retryAfterMs', async () => {
    const { conversation } = await create(T(), [ids.t2]); // 1 (create counts)
    for (let i = 0; i < 29; i++) await sendMessage(T(), conversation.id, { body: `m${i}` });
    const err = await sendMessage(T(), conversation.id, { body: 'one too many' }).catch((e) => e);
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.details.retryAfterMs).toBeGreaterThan(0);
  });

  it('NFR-1/A7: non-participants and participants who left get 404', async () => {
    const { conversation } = await create(T(), [ids.s1, ids.s2]);
    expect(await code(getConversation(as('t2', 'TEACHER'), conversation.id))).toBe('NOT_FOUND');
    expect(await code(listMessages(as('t2', 'TEACHER'), conversation.id, { limit: 30 }))).toBe('NOT_FOUND');
    expect(await code(sendMessage(as('lead', 'ADMIN'), conversation.id, { body: 'x' }))).toBe('NOT_FOUND');

    expect(await reason(leave(T(), conversation.id))).toBe('CREATOR_OF_STUDENT_GROUP');
    await leave(S2(), conversation.id);
    expect(await code(getConversation(S2(), conversation.id))).toBe('NOT_FOUND');
    expect(await code(listMessages(S2(), conversation.id, { limit: 30 }))).toBe('NOT_FOUND');

    const oneToOne = await create(P(), [ids.t]);
    expect(await reason(leave(P(), oneToOne.conversation.id))).toBe('ONE_TO_ONE');
  });

  it('FR-3/FR-15: edit stores a revision; 15-minute window; soft delete is redacted for users only', async () => {
    const { conversation, message } = await create(T(), [ids.t2], 'original');
    await editMessage(T(), message.id, 'changed');
    const revisions = await prisma.messageRevision.findMany({ where: { messageId: message.id } });
    expect(revisions.map((r) => r.body)).toEqual(['original']);
    expect(await reason(editMessage(as('t2', 'TEACHER'), message.id, 'nope'))).toBe('NOT_SENDER');
    const late = new Date(Date.parse(message.createdAt) + 16 * 60_000);
    expect(await reason(editMessage(T(), message.id, 'too late', late))).toBe('EDIT_WINDOW_EXPIRED');
    expect(await reason(deleteMessage(T(), message.id, late))).toBe('EDIT_WINDOW_EXPIRED');

    await deleteMessage(T(), message.id);
    expect(await reason(editMessage(T(), message.id, 'again'))).toBe('ALREADY_DELETED');
    const seen = await listMessages(as('t2', 'TEACHER'), conversation.id, { limit: 30 });
    expect(seen.messages[0]).toMatchObject({ deleted: true, body: null, attachments: [] });
    expect((await prisma.message.findUniqueOrThrow({ where: { id: message.id } })).body).toBe('changed'); // never hard-deleted
  });

  it('FR-13/A9: the after+since poll returns new messages and edits since the given time', async () => {
    const { conversation, message } = await create(T(), [ids.t2], 'a');
    const since = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 5));
    await editMessage(T(), message.id, 'a2');
    const b = await sendMessage(as('t2', 'TEACHER'), conversation.id, { body: 'b' });
    const poll = await listMessages(T(), conversation.id, { after: message.id, since, limit: 30 });
    expect(poll.messages.map((m) => m.id)).toEqual([b.id]);
    expect(poll.changed.map((m) => m.body)).toEqual(['a2']);
    const idle = await listMessages(T(), conversation.id, { after: b.id, since: new Date().toISOString(), limit: 30 });
    expect(idle).toMatchObject({ messages: [], changed: [] });
  });

  it('A12/FR-26: duplicate OPEN report is 409; own message 403; leads are notified', async () => {
    const { message } = await create(P(), [ids.t], 'report me');
    await reportMessage(T(), message.id, 'concerning');
    expect(await code(reportMessage(T(), message.id, 'again'))).toBe('CONFLICT');
    expect(await code(reportMessage(P(), message.id, 'mine'))).toBe('FORBIDDEN');
    expect(await code(reportMessage(as('t2', 'TEACHER'), message.id, 'outsider'))).toBe('NOT_FOUND');
    const n = await prisma.notification.findFirst({ where: { userId: ids.lead, type: 'message.reported' }, orderBy: { createdAt: 'desc' } });
    expect(n?.link).toMatch(/^\/admin\/safeguarding\?report=/);
    expect(n?.body).not.toContain('report me'); // never the message text
  });

  it('FR-6/FR-7: student↔student is 403 on create; a dropped student cannot send but the teacher still can', async () => {
    expect(await code(create(S1(), [ids.s2]))).toBe('FORBIDDEN');
    expect(await code(create(P(), [ids.s1]))).toBe('FORBIDDEN');
    const { conversation } = await create(S1(), [ids.t]);
    await prisma.enrollment.updateMany({ where: { courseId: ids.course, studentId: ids.s1 }, data: { status: 'DROPPED' } });
    try {
      expect(await reason(sendMessage(S1(), conversation.id, { body: 'still there?' }))).toBe('RELATIONSHIP_ENDED');
      expect((await getConversation(S1(), conversation.id)).canSend).toBe(false);
      expect(await code(sendMessage(T(), conversation.id, { body: 'staff can still send' }))).toBe('OK');
    } finally {
      await prisma.enrollment.updateMany({ where: { courseId: ids.course, studentId: ids.s1 }, data: { status: 'ACTIVE' } });
    }
  });

  it('FR-30/A11: involvesStudent is computed; a new message unarchives for recipients', async () => {
    const { conversation } = await create(T(), [ids.s1]);
    expect(conversation.involvesStudent).toBe(true);
    await prisma.conversationParticipant.update({ where: { conversationId_userId: { conversationId: conversation.id, userId: ids.s1 } }, data: { archivedAt: new Date() } });
    await sendMessage(T(), conversation.id, { body: 'ping' });
    expect((await getConversation(S1(), conversation.id)).me.archived).toBe(false);
  });
});
