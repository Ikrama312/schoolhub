import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';

/**
 * SH-1 QA: invite acceptance, /account/security, no sign-up route, and
 * focus-on-first-invalid-field (NFR-5). Uses throwaway users, removed afterwards.
 */
const prisma = new PrismaClient();
const MARK = '@qa-e2e.test';
const OLD = 'Qa-old-pass-2026';
const NEW = 'Qa-new-pass-2026';

test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  const users = await prisma.user.findMany({ where: { email: { endsWith: MARK } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { entityId: { in: ids } }] } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

async function inviteLink(email: string) {
  const user = await prisma.user.create({
    data: { email, firstName: 'Ivy', lastName: 'Invitee', role: 'TEACHER', status: 'INVITED' },
  });
  const raw = randomBytes(32).toString('base64url');
  await prisma.authToken.create({
    data: {
      userId: user.id,
      type: 'INVITE',
      tokenHash: createHash('sha256').update(raw).digest('hex'),
      expiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
    },
  });
  return `/invite/${raw}`;
}

test('a bogus invite token shows the invalid-invitation copy (FR-13)', async ({ page }) => {
  await page.goto('/invite/not-a-real-token');
  await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveText(
    'This invitation link is invalid or has expired. Ask the school office to send a new one.',
  );
  await expect(page.getByLabel(/^New password/)).toHaveCount(0);
});

test('invite accept -> signed in on /dashboard; the link cannot be reused (FR-13, FR-14)', async ({ page }) => {
  const email = `ivy${MARK}`;
  const link = await inviteLink(email);
  await page.goto(link);
  await expect(page.getByLabel('Name')).toHaveValue('Ivy Invitee');
  await expect(page.getByLabel('Email')).toHaveValue(email);
  await page.getByLabel(/^New password/).fill(NEW);
  await page.getByLabel(/^Confirm password/).fill(NEW);
  await page.getByRole('button', { name: 'Activate account' }).click();
  // accept-invite + signIn = two bcrypt(12) rounds plus a navigation.
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });

  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  expect(user.status).toBe('ACTIVE');
  expect(user.passwordChangedAt).not.toBeNull();

  await page.goto(link);
  await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toContainText('This invitation link is invalid or has expired.');
});

test('/account/security: menu link, wrong current password, then success keeps this session (FR-20, FR-21)', async ({
  page,
}) => {
  const email = `sec${MARK}`;
  await prisma.user.create({
    data: {
      email,
      firstName: 'Sec',
      lastName: 'User',
      role: 'STUDENT',
      status: 'ACTIVE',
      passwordHash: await bcrypt.hash(OLD, 10),
    },
  });
  await page.goto('/login');
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel(/^Password/).fill(OLD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.getByRole('button', { name: 'User menu' }).click();
  await expect(page.getByRole('menu').getByText('STUDENT', { exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Account security' }).click();
  await expect(page).toHaveURL(/\/account\/security$/);

  await page.getByLabel(/^Current password/).fill('Not-the-current-1');
  await page.getByLabel(/^New password/).fill(NEW);
  await page.getByLabel(/^Confirm new password/).fill(NEW);
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page.getByText('Current password is incorrect.')).toBeVisible();

  await page.getByLabel(/^Current password/).fill(OLD);
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page.getByText('Password updated')).toBeVisible();

  // The current session was re-issued, so a reload stays signed in.
  await page.reload();
  await expect(page).toHaveURL(/\/account\/security$/);
});

test('there is no public sign-up route (NFR-14)', async ({ page }) => {
  for (const path of ['/signup', '/sign-up', '/register']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login\?callbackUrl=/);
  }
});

test('submitting an invalid form focuses the first invalid field (NFR-5)', async ({ page }) => {
  await page.goto('/forgot-password');
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByLabel(/^Email/)).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel(/^Email/)).toBeFocused();
});
