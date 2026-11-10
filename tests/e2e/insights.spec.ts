import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signInAs } from './helpers/auth';

/** PRD-16 FR-29–FR-31: at-risk list filters + CSV, and the student Insights tab. Uses the seeded 7R cohort. */

test.describe('at-risk insights', () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, 'teacher@schoolhub.test');
  });

  test('list shows the cohort, the level filter narrows it, and the CSV matches the filter', async ({ page }) => {
    await page.goto('/insights/at-risk');
    await expect(page.getByRole('heading', { level: 1, name: 'At-risk students' })).toBeVisible();
    const grid = page.getByRole('grid');
    await expect(grid.getByRole('link', { name: 'Harper Hale' })).toBeVisible();
    await expect(grid.getByRole('link', { name: 'Mia Marsh' })).toBeVisible();

    await page.getByLabel('Level').click();
    await page.getByRole('option', { name: 'High' }).click();
    await expect(page).toHaveURL(/level=HIGH/);
    await expect(grid.getByRole('link', { name: 'Mia Marsh' })).toHaveCount(0);
    await expect(grid.getByRole('link', { name: 'Harper Hale' })).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download CSV' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^at-risk-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = await (await download.createReadStream())!.toArray().then((chunks) => Buffer.concat(chunks).toString('utf8'));
    expect(csv.split('\r\n')[0]).toBe('Student,Section,Grade level,Level,Reasons,Trend,Computed at');
    expect(csv).toContain('Harper Hale');
    expect(csv).not.toContain('Mia Marsh');

    const axe = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  });

  test('student Insights tab shows signals, level and history', async ({ page }) => {
    await page.goto('/insights/at-risk?level=HIGH');
    await page.getByRole('grid').getByRole('link', { name: 'Harper Hale' }).click();
    await expect(page).toHaveURL(/\/students\/[^/]+\/insights$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Insights' })).toBeVisible();
    await expect(page.getByText('High risk').first()).toBeVisible();
    await expect(page.getByText('Missing work (30 days)')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
  });
});
