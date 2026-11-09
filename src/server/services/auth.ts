import bcrypt from 'bcrypt';
import { prisma } from '@/server/db';
import { audit } from '@/server/audit';
import { AppError, getClientIp } from '@/server/http';
import { rateLimit } from '@/server/rate-limit';
import { consumeToken, createToken, verifyToken } from '@/server/auth/tokens';
import { assertPasswordAllowed } from '@/server/auth/password-policy';
import { authLink, sendAuthEmail } from '@/server/auth/email';

/**
 * Auth services (C9), Node only. Audit metadata is always explicit and never
 * carries passwords, hashes or raw tokens (FR-31).
 */

const BCRYPT_COST = 12;
const HOUR_MS = 60 * 60_000;
export const RESET_REQUESTED_MESSAGE = "If an account exists for that email, we've sent a reset link.";
const INVALID_LINK = 'This link is invalid or has expired.';

/** FR-16: set the first password from an invite and activate the account. */
export async function acceptInvite(input: { token: string; password: string }, request?: Request) {
  const verified = await verifyToken(input.token, 'INVITE');
  if (!verified) throw new AppError('INVALID_TOKEN', INVALID_LINK);
  const { token, user } = verified;
  assertPasswordAllowed(input.password, user.email);
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);

  await prisma.$transaction(async (tx) => {
    await consumeToken(token.id, tx);
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, status: 'ACTIVE', passwordChangedAt: new Date() },
    });
  });
  await audit({ actorId: user.id, action: 'auth.invite.accepted', entityType: 'User', entityId: user.id, request });
  return { email: user.email };
}

/** FR-19/FR-20: always the same response, whether or not the account exists. */
export async function requestPasswordReset(input: { email: string }, request?: Request) {
  const ip = request ? getClientIp(request) : null;
  if (!rateLimit(`forgot:ip:${ip ?? 'unknown'}`, 10, HOUR_MS).ok) {
    throw new AppError('RATE_LIMITED', 'Too many requests. Wait a few minutes and try again.');
  }
  const response = { message: RESET_REQUESTED_MESSAGE };
  if (!rateLimit(`forgot:email:${input.email}`, 3, HOUR_MS).ok) return response;

  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, email: true, firstName: true, status: true, archivedAt: true },
  });
  if (user && user.status === 'ACTIVE' && !user.archivedAt) {
    const raw = await createToken(user.id, 'PASSWORD_RESET', { minutes: 60 });
    await sendAuthEmail(user, 'password-reset', authLink('password-reset', raw));
    await audit({ actorId: user.id, action: 'auth.password.reset_requested', entityType: 'User', entityId: user.id, request });
  }
  return response;
}

/** FR-21: set a new password from a reset link; also clears any lockout. */
export async function resetPassword(input: { token: string; password: string }, request?: Request) {
  const verified = await verifyToken(input.token, 'PASSWORD_RESET');
  if (!verified) throw new AppError('INVALID_TOKEN', INVALID_LINK);
  const { token, user } = verified;
  assertPasswordAllowed(input.password, user.email);
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);

  await prisma.$transaction(async (tx) => {
    await consumeToken(token.id, tx);
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null },
    });
  });
  await audit({ actorId: user.id, action: 'auth.password.reset', entityType: 'User', entityId: user.id, request });
  return { ok: true as const };
}

/** FR-23: signed-in change; caller refreshes its own session's authTime afterwards. */
export async function changePassword(
  user: { id: string },
  input: { currentPassword: string; newPassword: string },
  request?: Request,
) {
  const existing = await prisma.user.findUnique({ where: { id: user.id }, select: { email: true, passwordHash: true } });
  if (!existing) throw new AppError('UNAUTHENTICATED', 'You must be signed in.');
  const currentOk = existing.passwordHash ? await bcrypt.compare(input.currentPassword, existing.passwordHash) : false;
  if (!currentOk) {
    throw new AppError('VALIDATION_ERROR', 'Current password is incorrect.', {
      fieldErrors: { currentPassword: ['Current password is incorrect.'] },
    });
  }
  assertPasswordAllowed(input.newPassword, existing.email);
  const passwordHash = await bcrypt.hash(input.newPassword, BCRYPT_COST);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash, passwordChangedAt: new Date() } });
  await audit({ actorId: user.id, action: 'auth.password.changed', entityType: 'User', entityId: user.id, request });
  return { ok: true as const };
}
