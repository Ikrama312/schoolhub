// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Point the shared Prisma client and env at the test DB before any app module loads.
vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DATABASE_URL ??= 'postgresql://unused@localhost/unused';
  process.env.APP_URL ??= 'http://localhost:3000';
  process.env.AUTH_SECRET ??= 'test-secret';
});

const sent: string[] = [];
vi.mock('@/server/email/transport', () => ({
  sendMail: vi.fn(async (message: { to: string }) => {
    // Small delay so the two dispatchers genuinely overlap.
    await new Promise((r) => setTimeout(r, 10));
    sent.push(message.to);
  }),
}));

import { prisma } from '@/server/db';
import { dispatchEmails } from '@/server/email/dispatch';

const MARK = '@dispatch-it.test';

describe.runIf(process.env.TEST_DATABASE_URL)('dispatchEmails (integration)', () => {
  const cleanup = () => prisma.emailOutbox.deleteMany({ where: { toEmail: { endsWith: MARK } } });

  beforeEach(async () => {
    sent.length = 0;
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('two concurrent dispatchers send each row exactly once (AC-4)', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      toEmail: `r${i}${MARK}`,
      subject: `Test ${i}`,
      html: '<p>x</p>',
      text: 'x',
      nextAttemptAt: new Date(Date.now() - 1000),
    }));
    await prisma.emailOutbox.createMany({ data: rows });

    await Promise.all([dispatchEmails({ batchSize: 50 }), dispatchEmails({ batchSize: 50 })]);

    const ours = sent.filter((to) => to.endsWith(MARK)).sort();
    expect(ours).toEqual(rows.map((r) => r.toEmail).sort());
    const statuses = await prisma.emailOutbox.findMany({ where: { toEmail: { endsWith: MARK } }, select: { status: true } });
    expect(statuses.every((s) => s.status === 'SENT')).toBe(true);
  });

  it('recovers a row stuck in SENDING for more than 10 minutes', async () => {
    const row = await prisma.emailOutbox.create({
      data: { toEmail: `stuck${MARK}`, subject: 'Stuck', html: '<p>x</p>', text: 'x', status: 'SENDING', attempts: 2 },
    });
    // @updatedAt can't be set through the client, so backdate it with raw SQL.
    await prisma.$executeRaw`UPDATE "EmailOutbox" SET "updatedAt" = (now() AT TIME ZONE 'UTC') - interval '11 minutes', "nextAttemptAt" = (now() AT TIME ZONE 'UTC') + interval '1 hour' WHERE id = ${row.id}`;

    await dispatchEmails();

    const after = await prisma.emailOutbox.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe('PENDING');
    expect(after.attempts).toBe(2);
    expect(sent).not.toContain(`stuck${MARK}`);
  });

  it('leaves a recently claimed SENDING row alone', async () => {
    const row = await prisma.emailOutbox.create({
      data: { toEmail: `fresh${MARK}`, subject: 'Fresh', html: '<p>x</p>', text: 'x', status: 'SENDING' },
    });
    await dispatchEmails();
    expect((await prisma.emailOutbox.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('SENDING');
  });
});
