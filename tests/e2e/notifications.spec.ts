import { test, expect, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { signInAs } from './helpers/auth';

/**
 * PRD-04 NFR-16. Creates its own ACTIVE admin so its notification state is
 * isolated, then signs in with the shared signInAs helper.
 */
const prisma = new PrismaClient();
const ADMIN = { email: 'e2e-notifications-admin@schoolhub.test', password: 'E2e-Notif!2026-pass' };

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const passwordHash = await bcrypt.hash(ADMIN.password, 10);
  const admin = await prisma.user.upsert({
    where: { email: ADMIN.email },
    update: { passwordHash, status: 'ACTIVE', archivedAt: null, failedLoginCount: 0, lockedUntil: null, role: 'ADMIN' },
    create: { email: ADMIN.email, passwordHash, firstName: 'E2E', lastName: 'Admin', role: 'ADMIN', status: 'ACTIVE' },
  });
  // Start from defaults even if an earlier run died before afterAll.
  await prisma.notificationPreference.deleteMany({ where: { userId: admin.id } });
  await prisma.notification.deleteMany({ where: { userId: admin.id } });
});

test.afterAll(async () => {
  // Cascades remove the admin's notifications and preferences; outbox rows have no FK.
  await prisma.user.deleteMany({ where: { email: ADMIN.email } });
  await prisma.emailOutbox.deleteMany({ where: { toEmail: ADMIN.email } });
  await prisma.$disconnect();
});

const bell = (page: Page) => page.getByRole('button', { name: /^Notifications/ });

test('admin test notification bumps the bell, mark all read clears it', async ({ page }) => {
  await signInAs(page, ADMIN.email, ADMIN.password);
  await page.request.post('/api/notifications/read-all');

  await page.goto('/admin/email-log');
  await expect(bell(page)).toHaveAccessibleName('Notifications');

  await page.getByRole('button', { name: 'Send test notification to me' }).click();
  await expect(page.getByText('Test notification sent to you')).toBeVisible();

  // The bell polls every 30 s; a reload fetches immediately.
  await page.reload();
  await expect(bell(page)).toHaveAccessibleName('Notifications, 1 unread');

  await bell(page).click();
  await expect(page.getByRole('button', { name: /Test notification/ })).toBeVisible();
  await page.getByRole('button', { name: 'Mark all as read' }).click();
  await expect(bell(page)).toHaveAccessibleName('Notifications');

  const { data } = await (await page.request.get('/api/notifications/unread-count')).json();
  expect(data.count).toBe(0);
});

test('a preference toggle persists across reload', async ({ page }) => {
  await signInAs(page, ADMIN.email, ADMIN.password);
  await page.goto('/account/notifications');

  const email = page.getByRole('switch', { name: 'Test notification email' });
  await expect(email).toBeChecked();

  const saved = page.waitForResponse((r) => r.url().endsWith('/api/me/notification-preferences') && r.request().method() === 'PUT');
  await email.click();
  expect((await saved).ok()).toBeTruthy();

  await page.reload();
  await expect(page.getByRole('switch', { name: 'Test notification email' })).not.toBeChecked();
});
