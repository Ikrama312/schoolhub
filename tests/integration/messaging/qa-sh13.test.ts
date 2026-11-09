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
import {
  createConversation,
  getConversation,
  leave,
  listConversations,
  markRead,
  setArchived,
  setMuted,
  unreadCount,
} from '@/server/messaging/conversations';
import { listMessages, sendMessage } from '@/server/messaging/messages';
import { listContacts } from '@/server/messaging/contacts';
import { getSettings, putSettings } from '@/server/messaging/quiet-hours';
import { conversationLink } from '@/server/messaging/notifications';
import { messageResolver } from '@/server/files/contexts';

/**
 * SH-13 QA: gaps not covered by the dev integration suite — contacts (FR-8), co-teachers (FR-32),
 * list/search/tabs/preview/unread (FR-9), read/mute/archive/leave (FR-14), unread-count (FR-18),
 * lastMessageAt (FR-31), quiet-hours settings (FR-21), 'message' file access (FR-27),
 * empty poll (NFR-2). Real Postgres; skipped without TEST_DATABASE_URL.
 */
const MARK = 'qa-sh13';
type R = 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT';
type K = 'lead' | 'a2' | 't' | 'co' | 't3' | 's1' | 's2' | 's3' | 'p' | 'p2';
const ids = {} as Record<K | 'year' | 'subject' | 'course', string>;
const as = (k: K, role: R) => ({ id: ids[k], role });
const T = () => as('t', 'TEACHER');
const CO = () => as('co', 'TEACHER');
const S1 = () => as('s1', 'STUDENT');
const S2 = () => as('s2', 'STUDENT');
const P = () => as('p', 'PARENT');
const code = (p: Promise<unknown>) => p.then(() => 'OK', (e: { code?: string }) => e.code ?? String(e));
const reason = (p: Promise<unknown>) => p.then(() => 'OK', (e: { details?: { reason?: string } }) => e.details?.reason ?? 'none');
const create = (user: { id: string; role: R }, participantIds: string[], body = 'hello', subject = MARK) =>
  createConversation(user, createConversationSchema.parse({ participantIds, body, subject }));
const flat = (g: { groups: { label: string; contacts: { id: string }[] }[] }) => new Set(g.groups.flatMap((x) => x.contacts.map((c) => c.id)));

describe.skipIf(!process.env.TEST_DATABASE_URL)('SH-13 QA (integration)', () => {
  beforeAll(async () => {
    const mk = (n: string, role: R, extra = {}) =>
      prisma.user.create({ data: { email: `${n}@${MARK}.test`, firstName: `Qa${n}`, lastName: 'Zz', role, status: 'ACTIVE', ...extra } }).then((u) => u.id);
    Object.assign(ids, {
      lead: await mk('lead', 'ADMIN', { isSafeguardingLead: true }),
      a2: await mk('a2', 'ADMIN'),
      t: await mk('t', 'TEACHER'),
      co: await mk('co', 'TEACHER'),
      t3: await mk('t3', 'TEACHER'),
      s1: await mk('s1', 'STUDENT'),
      s2: await mk('s2', 'STUDENT'),
      s3: await mk('s3', 'STUDENT'),
      p: await mk('p', 'PARENT'),
      p2: await mk('p2', 'PARENT'),
    });
    await prisma.parentStudentLink.create({ data: { parentId: ids.p, studentId: ids.s1, relationship: 'MOTHER', isPrimary: true } });
    await prisma.parentStudentLink.create({ data: { parentId: ids.p2, studentId: ids.s3, relationship: 'FATHER', isPrimary: true } });
    ids.year = (await prisma.academicYear.create({ data: { name: MARK, startDate: new Date('2026-08-01'), endDate: new Date('2027-07-01') } })).id;
    ids.subject = (await prisma.subject.create({ data: { name: MARK, code: MARK.toUpperCase() } })).id;
    ids.course = (
      await prisma.course.create({
        data: { name: MARK, code: MARK, academicYearId: ids.year, subjectId: ids.subject, teacherId: ids.t, coTeacherIds: [ids.co] },
      })
    ).id;
    await prisma.enrollment.createMany({
      data: [
        { courseId: ids.course, studentId: ids.s1 },
        { courseId: ids.course, studentId: ids.s2 },
        { courseId: ids.course, studentId: ids.s3, status: 'DROPPED' },
      ],
    });
  });

  beforeEach(() => __resetRateLimits());

  afterAll(async () => {
    const users = Object.entries(ids).filter(([k]) => !['year', 'subject', 'course'].includes(k)).map(([, v]) => v);
    await prisma.conversation.deleteMany({ where: { createdById: { in: users } } });
    await prisma.fileObject.deleteMany({ where: { ownerId: { in: users } } });
    await prisma.course.deleteMany({ where: { code: MARK } });
    await prisma.notification.deleteMany({ where: { userId: { in: users } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.subject.deleteMany({ where: { code: MARK.toUpperCase() } });
    await prisma.academicYear.deleteMany({ where: { name: MARK } });
    await prisma.$disconnect();
  });

  it('FR-8: contacts are grouped, labelled and limited to messageable users per role', async () => {
    const student = await listContacts(S1());
    const studentLabels = student.groups.map((g) => g.label);
    expect(studentLabels).toContain('My teachers');
    expect(studentLabels).toContain('School office');
    const sIds = flat(student);
    expect(sIds.has(ids.t) && sIds.has(ids.co)).toBe(true);
    expect(sIds.has(ids.t3) || sIds.has(ids.s2) || sIds.has(ids.p)).toBe(false); // no unrelated teacher, student or parent

    const parent = await listContacts(P());
    expect(parent.groups.map((g) => g.label)).toContain("My child's teachers (Qas1)");
    expect(flat(parent).has(ids.t3)).toBe(false);

    const teacher = await listContacts(T());
    const byLabel = Object.fromEntries(teacher.groups.map((g) => [g.label, g.contacts.map((c) => c.id)]));
    expect(byLabel[`Students in ${MARK}`]).toEqual(expect.arrayContaining([ids.s1, ids.s2]));
    expect(byLabel[`Students in ${MARK}`]).not.toContain(ids.s3); // DROPPED enrollment
    expect(byLabel[`Parents of students in ${MARK}`]).toContain(ids.p);
    expect(byLabel[`Parents of students in ${MARK}`] ?? []).not.toContain(ids.p2); // parent of a dropped student

    // ?q= narrows by name
    const q = await listContacts(T(), 'Qas2');
    expect([...flat(q)]).toEqual([ids.s2]);
  });

  it('FR-32: a co-teacher (Course.coTeacherIds) manages the course for contact rules', async () => {
    const { conversation } = await create(CO(), [ids.s1, ids.p]);
    expect(conversation.involvesStudent).toBe(true);
    expect(await code(create(as('t3', 'TEACHER'), [ids.s1]))).toBe('FORBIDDEN');
  });

  it('FR-6: parent→parent and student→parent are refused and nothing is created', async () => {
    const before = await prisma.conversation.count({ where: { subject: MARK } });
    expect(await code(create(P(), [ids.p2]))).toBe('FORBIDDEN');
    expect(await code(create(S1(), [ids.p]))).toBe('FORBIDDEN');
    expect(await code(create(P(), [ids.t3]))).toBe('FORBIDDEN'); // teacher of no child
    expect(await prisma.conversation.count({ where: { subject: MARK } })).toBe(before);
  });

  it('FR-6: more than 25 participants is rejected by the validator', () => {
    const many = Array.from({ length: 25 }, (_, i) => `u${i}`);
    expect(createConversationSchema.safeParse({ participantIds: many, body: 'x' }).success).toBe(false);
    expect(createConversationSchema.safeParse({ participantIds: many.slice(0, 24), body: 'x' }).success).toBe(true);
  });

  it('FR-31/FR-9: send bumps lastMessageAt; list is sorted, previews "sender: text", counts unread, searches', async () => {
    const a = await create(T(), [ids.s1], 'first', `${MARK} alpha`);
    const b = await create(T(), [ids.s2], 'second', `${MARK} beta`);
    const before = (await prisma.conversation.findUniqueOrThrow({ where: { id: a.conversation.id } })).lastMessageAt;
    await new Promise((r) => setTimeout(r, 5));
    await sendMessage(T(), a.conversation.id, { body: 'newest text' });
    const after = (await prisma.conversation.findUniqueOrThrow({ where: { id: a.conversation.id } })).lastMessageAt;
    expect(after.getTime()).toBeGreaterThan(before.getTime());

    const list = await listConversations(S1(), { skip: 0, take: 50 });
    const row = list.data.find((c) => c.id === a.conversation.id)!;
    expect(row.preview).toBe('Qat: newest text');
    expect(row.unreadCount).toBe(2);
    const sorted = [...list.data].sort((x, y) => y.lastMessageAt.localeCompare(x.lastMessageAt));
    expect(list.data.map((c) => c.id)).toEqual(sorted.map((c) => c.id));

    const bySubject = await listConversations(T(), { q: 'beta', skip: 0, take: 50 });
    expect(bySubject.data.map((c) => c.id)).toEqual([b.conversation.id]);
    const byName = await listConversations(T(), { q: 'Qas2', skip: 0, take: 50 });
    expect(byName.data.map((c) => c.id)).toContain(b.conversation.id);
    expect(byName.data.map((c) => c.id)).not.toContain(a.conversation.id);
  });

  it('FR-14/FR-18: read clears unread + notification + pending email; archive moves tabs; mute is per user', async () => {
    const { conversation } = await create(T(), [ids.s2], 'ping');
    const id = conversation.id;
    const countBefore = await unreadCount(ids.s2);
    expect(countBefore).toBeGreaterThanOrEqual(1);
    expect(await prisma.pendingMessageEmail.count({ where: { userId: ids.s2, conversationId: id } })).toBe(1);

    await markRead(S2(), id);
    expect(await unreadCount(ids.s2)).toBe(countBefore - 1);
    expect(await prisma.notification.count({ where: { userId: ids.s2, link: conversationLink(id), readAt: null } })).toBe(0);
    expect(await prisma.pendingMessageEmail.count({ where: { userId: ids.s2, conversationId: id } })).toBe(0);

    await setArchived(S2(), id, true);
    expect((await listConversations(S2(), { skip: 0, take: 50 })).data.map((c) => c.id)).not.toContain(id);
    expect((await listConversations(S2(), { archived: true, skip: 0, take: 50 })).data.map((c) => c.id)).toContain(id);
    // archive is per user: the teacher still sees it in the inbox
    expect((await listConversations(T(), { skip: 0, take: 50 })).data.map((c) => c.id)).toContain(id);

    await setMuted(S2(), id, true);
    expect((await getConversation(S2(), id)).me.muted).toBe(true);
    expect((await getConversation(T(), id)).me.muted).toBe(false);
  });

  it('FR-14: leave rules — not from a 1:1, never the creator of a student group; others can leave', async () => {
    const oneToOne = await create(T(), [ids.co]);
    expect(await reason(leave(T(), oneToOne.conversation.id))).toBe('ONE_TO_ONE');

    const group = await create(T(), [ids.s1, ids.s2, ids.co]);
    const gid = group.conversation.id;
    expect((await getConversation(T(), gid)).canLeave).toBe(false);
    expect(await reason(leave(T(), gid))).toBe('CREATOR_OF_STUDENT_GROUP');
    expect(await code(leave(CO(), gid))).toBe('OK');
    // after leaving, the co-teacher is a non-participant (404) everywhere
    expect(await code(getConversation(CO(), gid))).toBe('NOT_FOUND');
    expect(await code(sendMessage(CO(), gid, { body: 'x' }))).toBe('NOT_FOUND');

    const staff = await create(T(), [ids.co, ids.t3]);
    expect(await code(leave(T(), staff.conversation.id))).toBe('OK'); // creator of a staff-only group may leave
  });

  it('FR-6: students in a staff-created group can reply', async () => {
    const group = await create(T(), [ids.s1, ids.s2]);
    expect(await code(sendMessage(S2(), group.conversation.id, { body: 'reply from s2' }))).toBe('OK');
  });

  it('NFR-2: an "after" poll with nothing new returns empty arrays, quickly', async () => {
    const { conversation, message } = await create(T(), [ids.s1], 'poll me');
    const q = { after: message.id, since: new Date().toISOString(), limit: 30 };
    await listMessages(S1(), conversation.id, q); // warm up
    const t0 = performance.now();
    const res = await listMessages(S1(), conversation.id, q);
    const ms = performance.now() - t0;
    expect(res.messages).toEqual([]);
    expect(res.changed).toEqual([]);
    expect(ms).toBeLessThan(100);
  });

  it('FR-10: older pages load 30 at a time with hasMore', async () => {
    const { conversation } = await create(T(), [ids.co], 'm0');
    for (let i = 1; i <= 31; i++) {
      __resetRateLimits();
      await sendMessage(T(), conversation.id, { body: `m${i}` });
    }
    const page1 = await listMessages(CO(), conversation.id, { limit: 30 });
    expect(page1.messages).toHaveLength(30);
    expect(page1.hasMore).toBe(true);
    expect(page1.messages.at(-1)!.body).toBe('m31');
    const page2 = await listMessages(CO(), conversation.id, { before: page1.messages[0].id, limit: 30 });
    expect(page2.messages.map((m) => m.body)).toEqual(['m0', 'm1']);
    expect(page2.hasMore).toBe(false);
  });

  it('FR-21: quiet-hours settings round trip, may wrap midnight, and must be both-or-neither', async () => {
    expect(await getSettings(ids.t)).toEqual({ quietStart: null, quietEnd: null });
    expect(await putSettings(ids.t, { quietStart: '22:00', quietEnd: '07:00' })).toEqual({ quietStart: '22:00', quietEnd: '07:00' });
    expect(await getSettings(ids.t)).toEqual({ quietStart: '22:00', quietEnd: '07:00' });
    expect(await code(putSettings(ids.t, { quietStart: '22:00', quietEnd: null }))).toBe('VALIDATION_ERROR');
    expect(await putSettings(ids.t, { quietStart: null, quietEnd: null })).toEqual({ quietStart: null, quietEnd: null });
  });

  it('FR-27: message attachments are readable by participants and safeguarding leads only', async () => {
    const file = await prisma.fileObject.create({
      data: { ownerId: ids.t, originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 10, storageKey: `${MARK}-${Date.now()}`, sha256: 'x', context: 'message' },
    });
    const { conversation, message } = await createConversation(T(), createConversationSchema.parse({ participantIds: [ids.s1], body: 'see file', fileIds: [file.id] }));
    expect(message.attachments.map((a) => a.fileId)).toEqual([file.id]);
    const f = await prisma.fileObject.findUniqueOrThrow({ where: { id: file.id }, select: { id: true, ownerId: true, context: true, contextId: true } });
    expect(f.contextId).toBe(message.id);

    expect(await messageResolver({ id: ids.s1, role: 'STUDENT' }, f)).toBe(true);
    expect(await messageResolver({ id: ids.t, role: 'TEACHER' }, f)).toBe(true);
    expect(await messageResolver({ id: ids.lead, role: 'ADMIN' }, f)).toBe(true);
    expect(await messageResolver({ id: ids.a2, role: 'ADMIN' }, f)).toBe(false);
    expect(await messageResolver({ id: ids.s2, role: 'STUDENT' }, f)).toBe(false);
    expect(await messageResolver(null, f)).toBe(false);
    // reusing an already-attached file is refused
    expect(await code(sendMessage(T(), conversation.id, { body: 'again', fileIds: [file.id] }))).toBe('VALIDATION_ERROR');
  });
});
