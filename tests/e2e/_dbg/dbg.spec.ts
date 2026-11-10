import { test } from '@playwright/test';
import { signInAs } from '../helpers/auth';
test('dbg', async ({ page }) => {
  await signInAs(page, 'admin@schoolhub.test');
  for (const url of ['/dashboard', '/admin/reports/attendance', '/insights/at-risk']) {
    const res = await page.goto(url);
    await page.waitForTimeout(3000);
    console.log('URL', url, res?.status(), (await page.locator('main').innerText().catch(() => 'NO MAIN')).slice(0, 600));
  }
});
