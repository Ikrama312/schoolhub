import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signInAs } from './helpers/auth';

/** PRD-16 FR-33/FR-35/FR-44: reports centre, attendance report CSV, axe. */

test.describe('admin reports', () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, 'admin@schoolhub.test');
  });

  test('index lists the six reports', async ({ page }) => {
    await page.goto('/admin/reports');
    for (const title of ['Enrollment', 'Attendance', 'Academic performance', 'Assignment completion', 'Engagement', 'Teacher workload']) {
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    }
  });

  test('attendance report renders, downloads CSV and passes axe', async ({ page }) => {
    await page.goto('/admin/reports/attendance');
    await expect(page.getByRole('heading', { level: 1, name: 'Attendance' })).toBeVisible();
    await expect(page.getByRole('grid')).toBeVisible();
    await expect(page.getByLabel('Academic year')).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download CSV' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^attendance-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = await (await download.createReadStream())!.toArray().then((chunks) => Buffer.concat(chunks).toString('utf8'));
    expect(csv.split('\r\n')[0]).toBe('Group,Present,Absent,Late,Excused,Total,Rate %');

    const axe = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  });

  test('unknown report key is a 404', async ({ page }) => {
    const res = await page.goto('/admin/reports/nope');
    expect(res?.status()).toBe(404);
    const api = await page.request.get('/api/reports/nope');
    expect(api.status()).toBe(404);
  });
});
