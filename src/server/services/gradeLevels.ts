import { prisma } from '@/server/db';

export interface GradeLevelInput {
  name: string;
  shortName: string;
  order: number;
}

export interface UpdateGradeLevelInput {
  name?: string;
  shortName?: string;
  order?: number;
  archived?: boolean;
}

export async function listGradeLevels(includeArchived = false) {
  return prisma.gradeLevel.findMany({
    where: includeArchived ? undefined : { archivedAt: null },
    orderBy: { order: 'asc' },
  });
}

export async function createGradeLevel(input: GradeLevelInput) {
  return prisma.gradeLevel.create({ data: input });
}

export async function updateGradeLevel(id: string, input: UpdateGradeLevelInput) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.gradeLevel.findUniqueOrThrow({ where: { id } });

    if (input.order !== undefined && input.order !== existing.order) {
      // Swap via a negative placeholder so the order-unique constraint never
      // collides with whichever record currently holds the target slot.
      const other = await tx.gradeLevel.findUnique({ where: { order: input.order } });
      if (other) {
        await tx.gradeLevel.update({ where: { id: other.id }, data: { order: -1 } });
        await tx.gradeLevel.update({ where: { id }, data: { order: input.order } });
        await tx.gradeLevel.update({ where: { id: other.id }, data: { order: existing.order } });
      } else {
        await tx.gradeLevel.update({ where: { id }, data: { order: input.order } });
      }
    }

    return tx.gradeLevel.update({
      where: { id },
      data: {
        name: input.name ?? existing.name,
        shortName: input.shortName ?? existing.shortName,
        archivedAt: input.archived === undefined ? existing.archivedAt : input.archived ? new Date() : null,
      },
    });
  });
}
