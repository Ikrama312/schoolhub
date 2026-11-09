import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import { authConfig } from '@/server/auth/auth.config';
import { isPublicPath } from '@/config/public-routes';

/**
 * Edge gate (FR-12, NFR-7). Edge-safe: authConfig only, no Prisma/bcrypt.
 * This is a convenience redirect; requireRole()/requirePageRole() remain
 * the real authorization check on every handler and page.
 */
const { auth } = NextAuth(authConfig);

// Auth.js's own endpoints (signin/signout/callback/csrf/session) carry their own CSRF token.
const AUTHJS_ENDPOINT = /^\/api\/auth\/(signin|signout|callback|csrf|session|providers)(\/|$)/;

function jsonError(code: 'FORBIDDEN' | 'UNAUTHENTICATED', message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export default auth((req) => {
  const { pathname, search, origin } = req.nextUrl;
  const isApi = pathname.startsWith('/api/');

  // NFR-8: cross-origin state-changing API calls are rejected.
  const requestOrigin = req.headers.get('origin');
  if (
    isApi &&
    !['GET', 'HEAD'].includes(req.method) &&
    requestOrigin &&
    requestOrigin !== origin &&
    !AUTHJS_ENDPOINT.test(pathname)
  ) {
    return jsonError('FORBIDDEN', 'Cross-origin request rejected.', 403);
  }

  if (isPublicPath(pathname)) return NextResponse.next();

  if (!req.auth?.user) {
    if (isApi) return jsonError('UNAUTHENTICATED', 'You must be signed in.', 401);
    const login = new URL('/login', origin);
    login.searchParams.set('callbackUrl', pathname + search);
    return NextResponse.redirect(login);
  }

  // requirePageUser() reads this to build the post-login callbackUrl.
  const headers = new Headers(req.headers);
  headers.set('x-pathname', pathname + search);
  return NextResponse.next({ request: { headers } });
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.[a-zA-Z0-9]+$).*)'],
};
