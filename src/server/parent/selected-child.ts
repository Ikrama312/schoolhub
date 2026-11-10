import { cache } from 'react';
import { cookies } from 'next/headers';
import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import type { AccessUser } from '@/server/auth/student-access';

/**
 * PRD-15 child context (FR-3 to FR-6, NFR-5). The sh_child cookie is untrusted:
 * it is only ever read here, and only honoured when it names a linked child.
 */

export const CHILD_COOKIE = 'sh_child';
const ONE_YEAR_S = 365 * 24 * 60 * 60;

export interface LinkedChild {
  studentId: string;
  firstName: string;
  lastName: string;
}

/** The parent's linked children, in a stable order (first = default). */
export const listLinkedChildren = cache(async (parentId: string): Promise<LinkedChild[]> => {
  const links = await prisma.parentStudentLink.findMany({
    where: { parentId },
    select: { student: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: [{ student: { firstName: 'asc' } }, { student: { lastName: 'asc' } }],
  });
  return links.map((l) => ({ studentId: l.student.id, firstName: l.student.firstName, lastName: l.student.lastName }));
});

type Params = URLSearchParams | Record<string, string | string[] | undefined> | undefined;

function param(searchParams: Params, key: string): string | undefined {
  if (!searchParams) return undefined;
  if (searchParams instanceof URLSearchParams) return searchParams.get(key) ?? undefined;
  const v = searchParams[key];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Linked ?studentId= ▸ linked sh_child cookie ▸ first linked child. Null for
 * non-parents and parents with no links. Never throws on a bad cookie.
 */
export async function getSelectedChild(user: AccessUser, searchParams?: Params): Promise<LinkedChild | null> {
  if (user.role !== 'PARENT') return null;
  const children = await listLinkedChildren(user.id);
  if (children.length === 0) return null;
  const pick = (id: string | undefined) => (id ? children.find((c) => c.studentId === id) : undefined);
  let cookie: string | undefined;
  try {
    cookie = cookies().get(CHILD_COOKIE)?.value;
  } catch {
    cookie = undefined; // outside a request scope (scripts/tests)
  }
  return pick(param(searchParams, 'studentId')) ?? pick(cookie) ?? children[0];
}

/** Validates the ParentStudentLink, then sets the cookie. Unlinked → 404 (existence never leaks). */
export async function setSelectedChildCookie(user: AccessUser, studentId: string): Promise<{ studentId: string }> {
  const link = await prisma.parentStudentLink.findFirst({ where: { parentId: user.id, studentId }, select: { id: true } });
  if (!link) throw new AppError('NOT_FOUND', 'Resource not found');
  cookies().set(CHILD_COOKIE, studentId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: ONE_YEAR_S,
    secure: process.env.NODE_ENV === 'production',
  });
  return { studentId };
}
