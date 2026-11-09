// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DATABASE_URL ??= 'postgresql://unused@localhost/unused';
  process.env.APP_URL ??= 'http://localhost:3000';
  process.env.AUTH_SECRET ??= 'test-secret';
});

import { prisma } from '@/server/db';
import { formatInSchoolTz } from '@/lib/dates';
import { __resetRateLimits } from '@/server/rate-limit';
import { createConversationSchema } from '@/lib/validators/messaging';
import { createConversation } from '@/server/messaging/conversations';
import { processPendingMessageEmails } from '@/server/messaging/email';
import { getSchoolTimezone } from '@/server/assignments/assignments-service';

/** PRD-13 FR-20 integration: the deferred-email worker's read short-circuit, quiet-hours deferral and send path. */
const MARK = 'it-sh13-email';
const ids = {} as Record<'t' | 'p', string>;
const teacherEmail = `t@${MARK}.test`;
const past = () => new Date(Date.now() - 60_000);

async function pendingFor(): Promise<{ conversationId: string }> {
  __resetRateLimits();
  // Teacher → teacher keeps fixtures independent of courses (staff may always message staff).
  const { conversation } = await createConversation(
    { id: ids.p, role: 'TEACHER' },
    createConversationSchema.parse({ participantIds: [ids.t], body: 'hello', subject: MARK }),
  );
  await prisma.pendingMessageEmail.update({
    where: { userId_conversationId: { userId: ids.t, conversationId: conversation.id } },
    data: { dueAt: past(), createdAt: new Date(Date.now() - 11 * 60_000) },
  });
  return { conversationId: conversation.id };
}
const outbox = () => prisma.emailOutbox.count({ where: { toEmail: teacherEmail } });

describe.skipIf(!process.env.TEST_DATABASE_URL)('deferred message email (integration)', () => {
  beforeAll(async () => {
    const mk = (n: string) =>
      prisma.user.create({ data: { email: `${n}@${MARK}.test`, firstName: n, lastName: 'QA', role: 'TEACHER', status: 'ACTIVE' } }).then((u) => u.id);
    ids.t = await mk('t');
    ids.p = await mk('p');
  });

  beforeEach(async () => {
    await prisma.messagingSettings.deleteMany({ where: { userId: ids.t } });
    await prisma.emailOutbox.deleteMany({ where: { toEmail: teacherEmail } });
  });

  afterAll(async () => {
    await prisma.conversation.deleteMany({ where: { createdById: { in: Object.values(ids) } } });
    await prisma.emailOutbox.deleteMany({ where: { toEmail: { endsWith: `@${MARK}.test` } } });
    await prisma.notification.deleteMany({ where: { userId: { in: Object.values(ids) } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
    await prisma.$disconnect();
  });

  it('sends one email (no extra in-app row) when unread and outside quiet hours', async () => {
    const { conversationId } = await pendingFor();
    const inAppBefore = await prisma.notification.count({ where: { userId: ids.t } });
    const summary = await processPendingMessageEmails(new Date());
    expect(summary.sent).toBeGreaterThanOrEqual(1);
    expect(await outbox()).toBe(1);
    expect(await prisma.notification.count({ where: { userId: ids.t } })).toBe(inAppBefore);
    expect(await prisma.pendingMessageEmail.count({ where: { userId: ids.t, conversationId } })).toBe(0);
  });

  it('drops the email when the recipient read the conversation after it was queued', async () => {
    const { conversationId } = await pendingFor();
    await prisma.conversationParticipant.update({ where: { conversationId_userId: { conversationId, userId: ids.t } }, data: { lastReadAt: new Date() } });
    await processPendingMessageEmails(new Date());
    expect(await outbox()).toBe(0);
    expect(await prisma.pendingMessageEmail.count({ where: { userId: ids.t, conversationId } })).toBe(0);
  });

  it('drops the email for a muted recipient', async () => {
    const { conversationId } = await pendingFor();
    await prisma.conversationParticipant.update({ where: { conversationId_userId: { conversationId, userId: ids.t } }, data: { mutedAt: new Date() } });
    await processPendingMessageEmails(new Date());
    expect(await outbox()).toBe(0);
  });

  it('defers to the end of quiet hours (school timezone), keeping the original createdAt', async () => {
    const tz = await getSchoolTimezone();
    const now = new Date();
    const hhmm = (ms: number) => formatInSchoolTz(new Date(now.getTime() + ms), 'HH:mm', tz);
    await prisma.messagingSettings.create({ data: { userId: ids.t, quietStart: hhmm(-60 * 60_000), quietEnd: hhmm(60 * 60_000) } });
    const { conversationId } = await pendingFor();
    const before = await prisma.pendingMessageEmail.findUniqueOrThrow({ where: { userId_conversationId: { userId: ids.t, conversationId } } });

    await processPendingMessageEmails(now);
    expect(await outbox()).toBe(0);
    const after = await prisma.pendingMessageEmail.findUniqueOrThrow({ where: { userId_conversationId: { userId: ids.t, conversationId } } });
    expect(after.dueAt.getTime()).toBeGreaterThan(now.getTime());
    expect(after.dueAt.getTime() - now.getTime()).toBeLessThanOrEqual(61 * 60_000);
    expect(after.createdAt).toEqual(before.createdAt);
  });
});
