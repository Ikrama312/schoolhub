import { cache } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppError } from '@/server/http';
import { auth } from '@/server/auth/auth';
import type { Role } from '@/config/navigation';

/**
 * Single chokepoint for server-side authorization (FR-28, FR-29, ADR-2).
 * Route handlers use requireUser/requireRole (throw AppError → 401/403 via
 * withHandler); server pages/layouts use requirePageUser/requirePageRole
 * (redirect to /login or /forbidden).
 */
export interface SessionUser {
  id: string;
  role: Role;
  firstName: string;
  lastName: string;
  email: string;
}

export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const user = (await auth())?.user;
  if (!user?.id) return null;
  return { id: user.id, role: user.role, firstName: user.firstName, lastName: user.lastName, email: user.email };
});

type Check = { user: SessionUser } | { error: 'UNAUTHENTICATED' | 'FORBIDDEN' };

async function resolve(roles: Role[]): Promise<Check> {
  const user = await getCurrentUser();
  if (!user) return { error: 'UNAUTHENTICATED' };
  if (roles.length && !roles.includes(user.role)) return { error: 'FORBIDDEN' };
  return { user };
}

export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const result = await resolve(roles);
  if ('user' in result) return result.user;
  throw result.error === 'UNAUTHENTICATED'
    ? new AppError('UNAUTHENTICATED', 'You must be signed in.')
    : new AppError('FORBIDDEN', 'You do not have permission to perform this action.');
}

export async function requireUser(): Promise<SessionUser> {
  return requireRole();
}

export async function requirePageRole(...roles: Role[]): Promise<SessionUser> {
  const result = await resolve(roles);
  if ('user' in result) return result.user;
  if (result.error === 'FORBIDDEN') redirect('/forbidden');
  const callbackUrl = headers().get('x-pathname') ?? '/dashboard';
  redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
}

export async function requirePageUser(): Promise<SessionUser> {
  return requirePageRole();
}
