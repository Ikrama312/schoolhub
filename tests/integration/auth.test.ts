// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Point the shared Prisma client and env at the test DB before any app module loads.
vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DATABASE_URL ??= 'postgresql://unused@localhost/unused';
  process.env.APP_URL ??= 'http://localhost:3000';
  process.env.AUTH_SECRET ??= 'test-secret';
});

// next-auth's root entry pulls in next/server, which doesn't resolve under vitest.
vi.mock('next-auth', () => ({
  CredentialsSignin: class CredentialsSignin extends Error {
    code = 'credentials';
  },
}));

import bcrypt from 'bcrypt';
import { prisma } from '@/server/db';
import { __resetRateLimits } from '@/server/rate-limit';
import { authorizeCredentials } from '@/server/auth/credentials';
import { createToken, hashToken } from '@/server/auth/tokens';
import { acceptInvite, changePassword, requestPasswordReset, resetPassword } from '@/server/services/auth';

const MARK = '@auth-it.test';
const PASSWORD = 'Correct-horse-42';
const NEW_PASSWORD = 'Brand-new-pass-77';
const secrets: string[] = [PASSWORD, NEW_PASSWORD];

let ipSeq = 0;
/** A fresh IP per call keeps the per-IP limiter out of tests that aren't about it. */
const req = (ip = `10.0.0.${++ipSeq}`) => new Request('http://localhost/api', { headers: { 'x-forwarded-for': ip } });

async function makeUser(
  local: string,
  data: Partial<{ status: 'ACTIVE' | 'INVITED' | 'DISABLED'; archivedAt: Date; lockedUntil: Date; passwordHash: string | null }> = {},
) {
  return prisma.user.create({
    data: {
      email: `${local}${MARK}`,
      firstName: 'Auth',
      lastName: 'Test',
      role: 'STUDENT',
      status: 'ACTIVE',
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      ...data,
    },
  });
}

/** Resolves to the thrown error's code, or 'ok'. */
async function loginCode(email: string, password: string, request = req()): Promise<string> {
  try {
    await authorizeCredentials({ email, password }, request);
    return 'ok';
  } catch (error) {
    return (error as { code: string }).code;
  }
}

describe.runIf(process.env.TEST_DATABASE_URL)('auth services (integration)', () => {
  const cleanup = async () => {
    const users = await prisma.user.findMany({ where: { email: { endsWith: MARK } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { entityId: { in: ids } }] } });
    await prisma.authToken.deleteMany({ where: { userId: { in: ids } } });
    await prisma.emailOutbox.deleteMany({ where: { toEmail: { endsWith: MARK } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  };

  beforeEach(async () => {
    __resetRateLimits();
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  describe('authorizeCredentials', () => {
    it('rejects unknown email and wrong password with the same code', async () => {
      await makeUser('known');
      expect(await loginCode(`nobody${MARK}`, PASSWORD)).toBe('invalid');
      expect(await loginCode(`known${MARK}`, 'Wrong-pass-123')).toBe('invalid');
    });

    it('rejects DISABLED, archived and locked accounts', async () => {
      await makeUser('disabled', { status: 'DISABLED' });
      await makeUser('archived', { archivedAt: new Date() });
      await makeUser('locked', { lockedUntil: new Date(Date.now() + 10 * 60_000) });
      expect(await loginCode(`disabled${MARK}`, PASSWORD)).toBe('disabled');
      expect(await loginCode(`archived${MARK}`, PASSWORD)).toBe('invalid');
      expect(await loginCode(`locked${MARK}`, PASSWORD)).toMatch(/^locked:(9|10)$/);
    });

    it('locks on the 5th failure and audits auth.lockout', async () => {
      const user = await makeUser('lockme');
      for (let i = 0; i < 4; i++) expect(await loginCode(user.email, 'Wrong-pass-123')).toBe('invalid');
      expect(await loginCode(user.email, 'Wrong-pass-123')).toBe('locked:15');
      const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
      expect(await prisma.auditLog.count({ where: { action: 'auth.lockout', entityId: user.id } })).toBe(1);
      // Even the right password is refused while locked.
      expect(await loginCode(user.email, PASSWORD)).toMatch(/^locked:/);
    });

    it('rate limits after 10 attempts per IP', async () => {
      await makeUser('ratelimit');
      const ip = '10.9.9.9';
      for (let i = 0; i < 10; i++) await loginCode(`nobody${MARK}`, 'x', req(ip));
      expect(await loginCode(`ratelimit${MARK}`, PASSWORD, req(ip))).toBe('rate_limited');
    });

    it('success resets failedLoginCount, sets lastLoginAt and audits auth.login.success', async () => {
      const user = await makeUser('success');
      await loginCode(user.email, 'Wrong-pass-123');
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).failedLoginCount).toBe(1);

      expect(await loginCode(user.email, PASSWORD)).toBe('ok');
      const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.failedLoginCount).toBe(0);
      expect(row.lastLoginAt).not.toBeNull();
      expect(await prisma.auditLog.count({ where: { action: 'auth.login.success', entityId: user.id } })).toBe(1);
    });
  });

  describe('acceptInvite', () => {
    it('activates the account, sets passwordChangedAt and consumes the token', async () => {
      const user = await makeUser('invitee', { status: 'INVITED', passwordHash: null });
      const raw = await createToken(user.id, 'INVITE', { days: 7 });
      secrets.push(raw);

      await acceptInvite({ token: raw, password: NEW_PASSWORD }, req());
      const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.status).toBe('ACTIVE');
      expect(row.passwordChangedAt).not.toBeNull();
      expect(await bcrypt.compare(NEW_PASSWORD, row.passwordHash!)).toBe(true);
      const token = await prisma.authToken.findUniqueOrThrow({ where: { tokenHash: hashToken(raw) } });
      expect(token.usedAt).not.toBeNull();

      await expect(acceptInvite({ token: raw, password: NEW_PASSWORD }, req())).rejects.toMatchObject({
        code: 'INVALID_TOKEN',
      });
    });
  });

  describe('password reset', () => {
    it('a known email gets a token and an outbox row; an unknown email gets neither', async () => {
      const user = await makeUser('forgetful');
      const known = await requestPasswordReset({ email: user.email }, req());
      const unknown = await requestPasswordReset({ email: `ghost${MARK}` }, req());
      expect(unknown).toEqual(known);

      expect(await prisma.authToken.count({ where: { userId: user.id, type: 'PASSWORD_RESET' } })).toBe(1);
      expect(await prisma.emailOutbox.count({ where: { toEmail: user.email } })).toBe(1);
      expect(await prisma.emailOutbox.count({ where: { toEmail: `ghost${MARK}` } })).toBe(0);
    });

    it('resetPassword clears lockout fields and the token cannot be reused', async () => {
      const user = await makeUser('resetme', { lockedUntil: new Date(Date.now() + 10 * 60_000) });
      await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 3 } });
      const raw = await createToken(user.id, 'PASSWORD_RESET', { minutes: 60 });
      secrets.push(raw);

      await resetPassword({ token: raw, password: NEW_PASSWORD }, req());
      const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.failedLoginCount).toBe(0);
      expect(row.lockedUntil).toBeNull();
      expect(row.passwordChangedAt).not.toBeNull();
      expect(await loginCode(user.email, NEW_PASSWORD)).toBe('ok');

      await expect(resetPassword({ token: raw, password: 'Another-pass-99' }, req())).rejects.toMatchObject({
        code: 'INVALID_TOKEN',
      });
    });
  });

  describe('changePassword', () => {
    it('a wrong current password is a currentPassword field error', async () => {
      const user = await makeUser('changer-bad');
      await expect(
        changePassword(user, { currentPassword: 'Wrong-pass-123', newPassword: NEW_PASSWORD }, req()),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: { fieldErrors: { currentPassword: ['Current password is incorrect.'] } },
      });
    });

    it('success bumps passwordChangedAt', async () => {
      const user = await makeUser('changer-ok');
      await changePassword(user, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, req());
      const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.passwordChangedAt).not.toBeNull();
      expect(await bcrypt.compare(NEW_PASSWORD, row.passwordHash!)).toBe(true);
    });
  });

  it('no audit metadata carries password or token keys or values (NFR-8)', async () => {
    // Generate a spread of audited events in one go.
    const user = await makeUser('auditee');
    await loginCode(user.email, 'Wrong-pass-123');
    await loginCode(user.email, PASSWORD);
    await requestPasswordReset({ email: user.email }, req());
    await changePassword(user, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, req());

    const rows = await prisma.auditLog.findMany({ where: { OR: [{ actorId: user.id }, { entityId: user.id }] } });
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const { metadata } of rows) {
      const json = JSON.stringify(metadata ?? {});
      expect(json).not.toMatch(/"(password|passwordHash|newPassword|currentPassword|token|rawToken)"\s*:/);
      for (const secret of secrets) expect(json).not.toContain(secret);
    }
  });
});
