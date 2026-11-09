import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import type { Role } from '@/config/navigation';

export interface AccessUser {
  id: string;
  role: Role;
}

export type AccessibleStudentIds = 'ALL' | string[];

/**
 * FR-17: resolves which student ids `user` may see.
 * - ADMIN: "ALL" (every student)
 * - STUDENT: only themselves
 * - PARENT: students linked via ParentStudentLink (component 6)
 * - TEACHER (PRD-05 FR-22): students ACTIVE in courses they teach or
 *   co-teach, plus members of sections they are homeroom teacher of.
 */
export async function getAccessibleStudentIds(user: AccessUser): Promise<AccessibleStudentIds> {
  switch (user.role) {
    case 'ADMIN':
      return 'ALL';
    case 'STUDENT':
      return [user.id];
    case 'PARENT': {
      const links = await prisma.parentStudentLink.findMany({
        where: { parentId: user.id },
        select: { studentId: true },
      });
      return links.map((link) => link.studentId);
    }
    case 'TEACHER': {
      const [enrolled, members] = await Promise.all([
        prisma.enrollment.findMany({
          where: {
            status: 'ACTIVE',
            course: { OR: [{ teacherId: user.id }, { coTeacherIds: { has: user.id } }] },
          },
          select: { studentId: true },
          distinct: ['studentId'],
        }),
        prisma.sectionMember.findMany({
          where: { section: { homeroomTeacherId: user.id } },
          select: { studentId: true },
        }),
      ]);
      return [...new Set([...enrolled, ...members].map((row) => row.studentId))];
    }
    default:
      return [];
  }
}

/**
 * FR-17/FR-25: throws FORBIDDEN for a role that can never see student
 * records (none today), or NOT_FOUND for STUDENT/PARENT callers who are
 * not allowed to see this particular studentId -- NOT_FOUND rather than
 * FORBIDDEN so existence of another family's student is never revealed.
 * ADMIN/TEACHER get a plain FORBIDDEN if ever denied (never applicable to
 * ADMIN; TEACHER is denied students outside their courses/homeroom).
 */
export async function assertCanViewStudent(user: AccessUser, studentId: string): Promise<void> {
  const accessible = await getAccessibleStudentIds(user);

  if (accessible === 'ALL') return;

  if (accessible.includes(studentId)) return;

  if (user.role === 'STUDENT' || user.role === 'PARENT') {
    throw new AppError('NOT_FOUND', 'Resource not found');
  }

  throw new AppError('FORBIDDEN', 'You do not have permission to view this student.');
}
