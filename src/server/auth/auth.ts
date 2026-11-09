import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { prisma } from '@/server/db';
import { authConfig } from '@/server/auth/auth.config';
import { authorizeCredentials } from '@/server/auth/credentials';

const RECHECK_MS = 5 * 60_000;

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: (credentials, request) => authorizeCredentials(credentials, request),
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user, trigger, session }) {
      const now = Date.now();

      if (trigger === 'signIn' && user) {
        return {
          ...token,
          id: user.id as string,
          role: user.role,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          authTime: now,
          checkedAt: now,
        };
      }

      // FR-23: the session that just changed its password stays valid.
      if (trigger === 'update' && (session as { reauth?: boolean } | undefined)?.reauth) {
        return { ...token, authTime: now, checkedAt: now };
      }

      // FR-11: revoke within 5 min of disable/archive/password change elsewhere.
      if (now - (token.checkedAt ?? 0) > RECHECK_MS) {
        const fresh = await prisma.user.findUnique({
          where: { id: token.id },
          select: { passwordChangedAt: true, status: true, archivedAt: true, role: true, firstName: true, lastName: true },
        });
        if (!fresh || fresh.status !== 'ACTIVE' || fresh.archivedAt) return null;
        if (fresh.passwordChangedAt && fresh.passwordChangedAt.getTime() > token.authTime) return null;
        return { ...token, role: fresh.role, firstName: fresh.firstName, lastName: fresh.lastName, checkedAt: now };
      }

      return token;
    },
  },
});
