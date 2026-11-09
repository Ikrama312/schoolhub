import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

/**
 * PRD-01 C9: sign-in/out, wrong password, callbackUrl redirect, forgot -> reset,
 * and an axe scan of the public auth pages. Uses seeded users (prisma/seed.ts).
 */
const prisma = new PrismaClient();
const SEED_PASSWORD = 'SchoolHub123!';
const ADMIN = 'admin@schoolhub.test';
const STUDENT2 = 'student2@schoolhub.test';
const RESET_PASSWORD = 'E2e-Reset!2026-pass';

test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  // Put student2 back to the seed password so other runs and specs can sign in.
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);
  await prisma.user.update({
    where: { email: STUDENT2 },
    data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
  });
  await prisma.$disconnect();
});

async function signInViaUi(page: Page, email: string, password: string) {
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('admin signs in, sees name and role in the user menu, and signs out', async ({ page }) => {
  await page.goto('/login');
  await signInViaUi(page, ADMIN, SEED_PASSWORD);
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.getByRole('button', { name: 'User menu' }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByText('Alice Admin')).toBeVisible();
  await expect(menu.getByText('ADMIN', { exact: true })).toBeVisible();

  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
});

test('a wrong password shows the generic error', async ({ page }) => {
  await page.goto('/login');
  await signInViaUi(page, ADMIN, 'Definitely-wrong-1');
  await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveText('Email or password is incorrect.');
  await expect(page).toHaveURL(/\/login/);
});

test('an unauthenticated visit to /dashboard redirects to login with a callbackUrl', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fdashboard$/);
});

test('forgot password -> reset link -> sign in with the new password', async ({ page }) => {
  const startedAt = new Date();
  await page.goto('/forgot-password');
  await page.getByLabel(/^Email/).fill(STUDENT2);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toContainText("If an account exists for that email, we've sent a reset link.");

  // Read the reset link straight from the outbox (no test-only app route).
  let link = '';
  await expect
    .poll(async () => {
      const row = await prisma.emailOutbox.findFirst({
        where: { toEmail: STUDENT2, createdAt: { gte: startedAt } },
        orderBy: { createdAt: 'desc' },
      });
      link = row?.text.match(/\/reset-password\/[^\s"'<>]+/)?.[0] ?? '';
      return link;
    })
    .not.toBe('');

  await page.goto(link);
  await page.getByLabel(/^New password/).fill(RESET_PASSWORD);
  await page.getByLabel(/^Confirm password/).fill(RESET_PASSWORD);
  await page.getByRole('button', { name: 'Set new password' }).click();

  await expect(page).toHaveURL(/\/login\?reset=1/);
  await expect(page.getByText('Password updated. Sign in with your new password.')).toBeVisible();

  await signInViaUi(page, STUDENT2, RESET_PASSWORD);
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('/login and /forgot-password have zero serious or critical axe violations', async ({ page }) => {
  for (const path of ['/login', '/forgot-password']) {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).analyze();
    const seriousOrCritical = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(seriousOrCritical, path).toEqual([]);
  }
});
