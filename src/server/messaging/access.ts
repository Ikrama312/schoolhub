import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import type { SessionUser } from '@/server/auth/requireRole';

/**
 * PRD-13 access helpers (NFR-1, A7). A participant who has left is a non-participant (404);
 * a conversation cuid is never authorisation. The safeguarding flag is always read from the DB.
 */

const notFound = () => new AppError('NOT_FOUND', 'Conversation not found');

export async function getParticipation(userId: string, conversationId: string) {
  const row = await prisma.conversationParticipant.findUnique({ where: { conversationId_userId: { conversationId, userId } } });
  if (!row || row.leftAt) throw notFound();
  return row;
}

export async function isSafeguardingLead(user: { id: string; role: string }): Promise<boolean> {
  if (user.role !== 'ADMIN') return false;
  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { isSafeguardingLead: true, status: true } });
  return !!row?.isSafeguardingLead && row.status === 'ACTIVE';
}

/** Service-level guard: 403 unless an ACTIVE ADMIN with isSafeguardingLead (fresh DB read). */
export async function assertSafeguardingLead(user: { id: string; role: string }): Promise<void> {
  if (!(await isSafeguardingLead(user))) {
    throw new AppError('FORBIDDEN', 'Only safeguarding leads can access this area.');
  }
}

// The guards below import auth lazily so services (and their integration tests) never load next-auth.

/** Route guard: 401 when signed out, 403 for anyone but a safeguarding lead. */
export async function requireSafeguardingLead(): Promise<SessionUser> {
  const { requireRole } = await import('@/server/auth/requireRole');
  const user = await requireRole('ADMIN');
  await assertSafeguardingLead(user);
  return user;
}

/** Page guard: redirects to /login or /forbidden. */
export async function requirePageSafeguardingLead(): Promise<SessionUser> {
  const [{ requirePageRole }, { redirect }] = await Promise.all([import('@/server/auth/requireRole'), import('next/navigation')]);
  const user = await requirePageRole('ADMIN');
  if (!(await isSafeguardingLead(user))) redirect('/forbidden');
  return user;
}
