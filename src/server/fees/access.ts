// PRD-17 permission matrix (FR-41, FR-45, NFR-4, D-14). The only place fee access is decided.
// Out-of-scope or missing ids are 404 (no existence oracle). Hidden buttons are cosmetic only.
import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import type { SessionUser } from '@/server/auth/requireRole';
import { getAccessibleStudentIds, type AccessUser } from '@/server/auth/student-access';

const notFound = () => new AppError('NOT_FOUND', 'Resource not found');

// Lazy: requireRole pulls in the Auth.js session (React cache), which the seed and scripts that use
// fees-service with an explicit actor must not load.
const requireRole = async (...roles: SessionUser['role'][]) => (await import('@/server/auth/requireRole')).requireRole(...roles);

/** ADMIN and PARENT read; TEACHER and STUDENT get 403. */
export const requireFeeReader = () => requireRole('ADMIN', 'PARENT');
/** Setup lists, dashboard, aging, exports, family lookups. */
export const requireFeeAdmin = () => requireRole('ADMIN');

/** Pages: whether to show write controls. Same DB read as requireBursar. */
export async function isBursar(user: AccessUser): Promise<boolean> {
  if (user.role !== 'ADMIN') return false;
  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { isBursar: true } });
  return row?.isBursar === true;
}

/** Every fee write: ADMIN + isBursar read from the DB per request, so revoking takes effect at once. */
export async function requireBursar(): Promise<SessionUser> {
  const user = await requireRole('ADMIN');
  if (!(await isBursar(user))) throw new AppError('FORBIDDEN', 'Only a bursar can change fee records.');
  return user;
}

/** 'ALL' for ADMIN, linked children for PARENT; anyone else is forbidden. */
export async function feeStudentScope(user: AccessUser): Promise<'ALL' | string[]> {
  if (user.role !== 'ADMIN' && user.role !== 'PARENT') throw new AppError('FORBIDDEN', 'You do not have access to fees.');
  return getAccessibleStudentIds(user);
}

export async function parentStudentIds(user: AccessUser): Promise<string[]> {
  const scope = await feeStudentScope(user);
  return scope === 'ALL' ? [] : scope;
}

/** PARENT: linked child, never a DRAFT. ADMIN: any existing invoice. */
export async function assertCanSeeInvoice(user: AccessUser, invoiceId: string) {
  const scope = await feeStudentScope(user);
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { id: true, studentId: true, status: true } });
  if (!inv) throw notFound();
  if (scope !== 'ALL' && (!scope.includes(inv.studentId) || inv.status === 'DRAFT')) throw notFound();
  return inv;
}

/** PARENT: at least one allocation to a linked child's invoice. */
export async function assertCanSeePayment(user: AccessUser, paymentId: string) {
  const scope = await feeStudentScope(user);
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { id: true, allocations: { select: { invoice: { select: { studentId: true } } } } },
  });
  if (!payment) throw notFound();
  if (scope !== 'ALL' && !payment.allocations.some((a) => scope.includes(a.invoice.studentId))) throw notFound();
  return payment;
}

export async function assertCanSeeStudent(user: AccessUser, studentId: string) {
  const scope = await feeStudentScope(user);
  if (scope !== 'ALL') {
    if (!scope.includes(studentId)) throw notFound();
    return;
  }
  const exists = await prisma.user.count({ where: { id: studentId, role: 'STUDENT' } });
  if (!exists) throw notFound();
}

/** FR-26: the id is an existing PARENT user. */
export async function assertParent(parentId: string) {
  const parent = await prisma.user.findFirst({
    where: { id: parentId, role: 'PARENT' },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!parent) throw notFound();
  return parent;
}
