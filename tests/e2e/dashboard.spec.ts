import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signInAs } from './helpers/auth';

/** PRD-16 FR-1/FR-3/NFR-2: one dashboard per role, parents redirected; axe on each. Uses the default seed. */

async function seriousAxe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  return results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
}

const greeting = /^Good (morning|afternoon|evening), /;

test.describe('role dashboards (/dashboard)', () => {
  test('admin: greeting, KPIs, charts, refresh; no serious axe violations', async ({ page }) => {
    await signInAs(page, 'admin@schoolhub.test');
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 1, name: greeting })).toContainText('Alice');
    await expect(page.getByText('Active students')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Attendance trend' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'At-risk students' })).toBeVisible();
    await expect(page.getByText(/High: \d+/)).toBeVisible();
    await page.getByRole('button', { name: 'Refresh' }).click();
    await expect(page.getByText(/Dashboard refreshed/)).toBeVisible();
    expect(await seriousAxe(page)).toEqual([]);
  });

  test('teacher: today, to grade, at-risk top 5 from the seeded cohort; no serious axe violations', async ({ page }) => {
    await signInAs(page, 'teacher@schoolhub.test');
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 1, name: greeting })).toContainText('Tom');
    await expect(page.getByRole('heading', { name: "Today's classes" })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'To grade' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Harper Hale' })).toBeVisible();
    await expect(page.getByText('Announcements not available yet')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh' })).toHaveCount(0);
    expect(await seriousAxe(page)).toEqual([]);
  });

  test('student: today, due soon, courses, attendance; no serious axe violations', async ({ page }) => {
    await signInAs(page, 'student@schoolhub.test');
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 1, name: greeting })).toContainText('Sam');
    for (const title of ['Today', 'Due soon', 'Term attendance', 'My courses', 'Recent grades']) {
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    }
    expect(await seriousAxe(page)).toEqual([]);
  });

  test('parent is redirected to /my-children (PRD-15 FR-8)', async ({ page }) => {
    await signInAs(page, 'parent@schoolhub.test');
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/my-children/);
  });
});
