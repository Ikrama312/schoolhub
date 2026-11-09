import { expect, type Page } from '@playwright/test';

/** Signs in through next-auth's credentials callback; cookies land on `page`'s context. */
export async function signInAs(page: Page, email: string, password = 'SchoolHub123!') {
  const { csrfToken } = await (await page.request.get('/api/auth/csrf')).json();
  const res = await page.request.post('/api/auth/callback/credentials', {
    form: { email, password, csrfToken, callbackUrl: '/dashboard' },
  });
  expect(res.ok()).toBeTruthy();
  const session = await (await page.request.get('/api/auth/session')).json();
  expect(session?.user?.email).toBe(email);
}
