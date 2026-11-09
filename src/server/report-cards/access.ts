import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import { getAccessibleStudentIds, type AccessUser } from '@/server/auth/student-access';

/**
 * PRD-11 report card access (FR-32, FR-37, NFR-5, NFR-6). Anyone who may not see a card gets
 * NOT_FOUND, so a 7B student cannot tell that Sam's card exists (AC-7).
 */

export const reportCardNotFound = () => new AppError('NOT_FOUND', 'Report card not found');

/** ADMIN; teachers of the student or their homeroom teacher; the student / linked parent once PUBLISHED. */
export async function canViewReportCard(user: AccessUser, card: { studentId: string; status: 'DRAFT' | 'PUBLISHED' }): Promise<boolean> {
  if (user.role === 'ADMIN') return true;
  if ((user.role === 'STUDENT' || user.role === 'PARENT') && card.status !== 'PUBLISHED') return false;
  const ids = await getAccessibleStudentIds(user);
  return ids === 'ALL' || ids.includes(card.studentId);
}

export async function assertCanViewReportCard(user: AccessUser, card: { studentId: string; status: 'DRAFT' | 'PUBLISHED' }) {
  if (!(await canViewReportCard(user, card))) throw reportCardNotFound();
}

/** ADMIN, or the homeroom teacher of the student's section in the card's academic year. */
export async function canEditHomeroomComment(user: AccessUser, studentId: string, academicYearId: string): Promise<boolean> {
  if (user.role === 'ADMIN') return true;
  if (user.role !== 'TEACHER') return false;
  const m = await prisma.sectionMember.findFirst({
    where: { studentId, academicYearId, section: { homeroomTeacherId: user.id } },
    select: { id: true },
  });
  return !!m;
}
