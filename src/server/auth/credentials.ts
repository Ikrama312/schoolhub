import bcrypt from 'bcrypt';
import { CredentialsSignin } from 'next-auth';
import type { Role } from '@prisma/client';
import { prisma } from '@/server/db';
import { audit } from '@/server/audit';
import { getClientIp } from '@/server/http';
import { rateLimit } from '@/server/rate-limit';
import { signInSchema } from '@/lib/validators/auth';

/** Error code surfaces to the login form via signIn(..., {redirect:false}).code (FR-5, FR-7). */
export class AuthError extends CredentialsSignin {
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MS = 15 * 60_000;
const LOGIN_RATE_LIMIT = 10;
const LOGIN_RATE_WINDOW_MS = 5 * 60_000;

// Compared against when the user is missing / has no hash, so every path costs one bcrypt compare (NFR-3).
const DUMMY_HASH = bcrypt.hashSync('schoolhub-dummy-password-never-matches', 12);

/** FR-6: given the failure count after this attempt, the values to persist. */
export function computeLockout(count: number, now: Date): { failedLoginCount: number; lockedUntil: Date | null } {
  if (count >= MAX_FAILED_LOGINS) return { failedLoginCount: 0, lockedUntil: new Date(now.getTime() + LOCKOUT_MS) };
  return { failedLoginCount: count, lockedUntil: null };
}

export interface AuthorizedUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
}

export async function authorizeCredentials(input: unknown, request: Request): Promise<AuthorizedUser> {
  const ip = getClientIp(request);
  const fail = async (reason: string, email: string | null, actorId: string | null = null): Promise<never> => {
    await audit({ actorId, action: 'auth.login.failure', entityType: 'User', entityId: actorId ?? undefined, metadata: { email, reason }, request });
    throw new AuthError(reason);
  };

  if (!rateLimit(`login:ip:${ip ?? 'unknown'}`, LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW_MS).ok) {
    return fail('rate_limited', null);
  }

  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) return fail('invalid', null);
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  const now = new Date();

  if (!user) return fail('invalid', email);
  if (user.status === 'DISABLED') return fail('disabled', email, user.id);
  if (user.status !== 'ACTIVE' || user.archivedAt) return fail('invalid', email, user.id);
  if (user.lockedUntil && user.lockedUntil > now) {
    return fail(`locked:${Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60_000)}`, email, user.id);
  }

  if (!passwordOk || !user.passwordHash) {
    // ponytail: concurrent failures can overshoot the count by one before the lock lands; harmless.
    const { failedLoginCount } = await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    const lock = computeLockout(failedLoginCount, now);
    if (lock.lockedUntil) {
      await prisma.user.update({ where: { id: user.id }, data: lock });
      await audit({ actorId: user.id, action: 'auth.lockout', entityType: 'User', entityId: user.id, metadata: { email }, request });
      return fail(`locked:${LOCKOUT_MS / 60_000}`, email, user.id);
    }
    return fail('invalid', email, user.id);
  }

  await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now } });
  await audit({ actorId: user.id, action: 'auth.login.success', entityType: 'User', entityId: user.id, request });
  return { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role };
}
