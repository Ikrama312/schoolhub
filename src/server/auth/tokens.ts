import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AuthToken, AuthTokenType, Prisma, User } from '@prisma/client';
import { prisma } from '@/server/db';
import { AppError } from '@/server/http';

/**
 * The only code that touches AuthToken (FR-13, NFR-1). Raw tokens are
 * returned to the caller once and never stored; only sha256(raw) hex is.
 */

type Tx = Prisma.TransactionClient;

/** Invite token lifetime; the invite email's expiry date reads this too (PRD-04 FR-15). */
export const INVITE_TTL = { days: 7 } as const;

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Invalidates the user's older unused tokens of `type`, then issues a new one. Returns the raw token. */
export async function createToken(
  userId: string,
  type: AuthTokenType,
  ttl: { minutes?: number; days?: number },
  tx?: Tx,
): Promise<string> {
  const raw = randomBytes(32).toString('base64url');
  const now = new Date();
  const ttlMs = ((ttl.days ?? 0) * 24 * 60 + (ttl.minutes ?? 0)) * 60_000;

  const run = async (client: Tx) => {
    await client.authToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: now } });
    await client.authToken.create({
      data: { userId, type, tokenHash: hashToken(raw), expiresAt: new Date(now.getTime() + ttlMs) },
    });
  };
  if (tx) await run(tx);
  else await prisma.$transaction(run);
  return raw;
}

export type VerifiedToken = {
  token: AuthToken;
  user: Pick<User, 'id' | 'email' | 'firstName' | 'lastName' | 'status'>;
};

/** Returns the token + user, or null if missing, wrong type, used or expired. */
export async function verifyToken(raw: string, type: AuthTokenType): Promise<VerifiedToken | null> {
  if (!raw) return null;
  const hash = hashToken(raw);
  const token = await prisma.authToken.findUnique({
    where: { tokenHash: hash },
    include: { user: { select: { id: true, email: true, firstName: true, lastName: true, status: true } } },
  });
  if (!token) return null;
  if (!timingSafeEqual(Buffer.from(token.tokenHash, 'hex'), Buffer.from(hash, 'hex'))) return null;
  if (token.type !== type || token.usedAt || token.expiresAt <= new Date()) return null;
  const { user, ...rest } = token;
  return { token: rest, user };
}

/** Marks the token used; throws INVALID_TOKEN if it was already consumed (double submit). */
export async function consumeToken(tokenId: string, tx?: Tx): Promise<void> {
  const { count } = await (tx ?? prisma).authToken.updateMany({
    where: { id: tokenId, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (count === 0) throw new AppError('INVALID_TOKEN', 'This link is invalid or has expired.');
}
