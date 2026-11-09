import { describe, expect, it } from 'vitest';
import { isPublicPath } from '@/config/public-routes';

/** SH-1 QA: the middleware's public allow-list (FR-11, NFR-14). */
describe('isPublicPath', () => {
  it.each(['/', '/login', '/forgot-password', '/invite/abc', '/reset-password/abc', '/api/health', '/api/auth/csrf'])(
    '%s is public',
    (p) => expect(isPublicPath(p)).toBe(true),
  );

  it.each(['/dashboard', '/account/security', '/api/account/password', '/api/users', '/login/extra', '/signup', '/register'])(
    '%s requires a session',
    (p) => expect(isPublicPath(p)).toBe(false),
  );
});
