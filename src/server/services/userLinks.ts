import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import type { GuardianRelationship, Prisma } from '@prisma/client';

const MAX_PARENTS_PER_STUDENT = 4;

export interface LinkParentToStudentInput {
  studentId: string;
  parentId: string;
  relationship: GuardianRelationship;
  isPrimary: boolean;
}

type TxClient = Prisma.TransactionClient;

/**
 * The invariant logic (FR-15/FR-16), operating on a caller-supplied
 * transaction client. Callers that already hold an open transaction (e.g.
 * users.ts's createUser, which writes the User + profile + links
 * atomically) call this directly with their own `tx`; standalone callers
 * use `linkParentToStudent` below, which opens its own transaction.
 * - a student may have at most 4 linked parents
 * - at most one link per student is isPrimary (setting one clears the rest)
 */
export async function linkParentToStudentTx(tx: TxClient, input: LinkParentToStudentInput) {
  const existingCount = await tx.parentStudentLink.count({ where: { studentId: input.studentId } });
  if (existingCount >= MAX_PARENTS_PER_STUDENT) {
    throw new AppError('VALIDATION_ERROR', `A student can have at most ${MAX_PARENTS_PER_STUDENT} linked parents.`);
  }

  if (input.isPrimary) {
    await tx.parentStudentLink.updateMany({
      where: { studentId: input.studentId },
      data: { isPrimary: false },
    });
  }

  return tx.parentStudentLink.create({
    data: {
      studentId: input.studentId,
      parentId: input.parentId,
      relationship: input.relationship,
      isPrimary: input.isPrimary,
    },
  });
}

/** Standalone entry point (student form / parent form / Family card, FR-15). */
export async function linkParentToStudent(input: LinkParentToStudentInput) {
  return prisma.$transaction((tx) => linkParentToStudentTx(tx, input));
}

export async function unlinkParentFromStudent(studentId: string, parentId: string) {
  return prisma.parentStudentLink.deleteMany({ where: { studentId, parentId } });
}

export async function listLinksForStudent(studentId: string) {
  return prisma.parentStudentLink.findMany({
    where: { studentId },
    include: { parent: { select: { id: true, firstName: true, lastName: true } } },
  });
}

export async function listLinksForParent(parentId: string) {
  return prisma.parentStudentLink.findMany({
    where: { parentId },
    include: { student: { select: { id: true, firstName: true, lastName: true } } },
  });
}
