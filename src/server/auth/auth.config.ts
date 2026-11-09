import type { NextAuthConfig } from 'next-auth';
import { safeCallbackUrl } from '@/lib/validators/auth';

/**
 * Edge-safe Auth.js config (ADR-1): no Prisma, no bcrypt. src/middleware.ts
 * uses this alone; src/server/auth/auth.ts adds the Credentials provider
 * and the revocation-checking jwt callback on Node.
 * Cookies: Auth.js defaults (HttpOnly, SameSite=Lax, __Secure- in prod).
 */
export const authConfig = {
  trustHost: true,
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60, updateAge: 15 * 60 },
  pages: { signIn: '/login' },
  providers: [],
  callbacks: {
    session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      session.user.firstName = token.firstName;
      session.user.lastName = token.lastName;
      session.user.email = token.email ?? '';
      return session;
    },
    redirect({ url, baseUrl }) {
      // Auth.js hands us absolute URLs; reduce same-origin ones to a path, then sanitise.
      const path = url.startsWith(baseUrl) ? url.slice(baseUrl.length) || '/' : url;
      return baseUrl + safeCallbackUrl(path);
    },
  },
} satisfies NextAuthConfig;
