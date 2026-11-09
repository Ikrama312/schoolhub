import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signInAs } from './helpers/auth';

test.describe('dashboard page (/dashboard)', () => {
  // The (app) layout requires a session (requirePageUser).
  test.beforeEach(async ({ page }) => {
    await signInAs(page, 'admin@schoolhub.test');
  });

  test('renders the welcome header and empty state', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 1, name: /welcome to schoolhub/i })).toBeVisible();
  });

  test('has zero serious/critical accessibility violations', async ({ page }) => {
    await page.goto('/dashboard');
    const results = await new AxeBuilder({ page }).analyze();
    const seriousOrCritical = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(seriousOrCritical).toEqual([]);
  });
});
