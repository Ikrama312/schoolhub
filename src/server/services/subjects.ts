import { prisma } from '@/server/db';
import { AppError } from '@/server/http';

export interface SubjectInput {
  name: string;
  code: string;
  description?: string | null;
  color: string;
}

export interface UpdateSubjectInput extends Partial<SubjectInput> {
  archived?: boolean;
}

/** Codes are always stored upper-case so "math" and "MATH" collide. */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

async function assertCodeAvailable(code: string, excludeId?: string) {
  const existing = await prisma.subject.findUnique({ where: { code } });
  if (existing && existing.id !== excludeId) {
    throw new AppError('CONFLICT', `Code already used by ${existing.name}.`);
  }
}

export async function listSubjects(q?: string) {
  return prisma.subject.findMany({
    where: q
      ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: normalizeCode(q) } }] }
      : undefined,
    orderBy: { name: 'asc' },
  });
}

export async function createSubject(input: SubjectInput) {
  const code = normalizeCode(input.code);
  await assertCodeAvailable(code);
  return prisma.subject.create({ data: { ...input, code } });
}

export async function updateSubject(id: string, input: UpdateSubjectInput) {
  const existing = await prisma.subject.findUniqueOrThrow({ where: { id } });
  const code = input.code ? normalizeCode(input.code) : existing.code;
  if (code !== existing.code) {
    await assertCodeAvailable(code, id);
  }
  return prisma.subject.update({
    where: { id },
    data: {
      name: input.name ?? existing.name,
      code,
      description: input.description === undefined ? existing.description : input.description,
      color: input.color ?? existing.color,
      archivedAt: input.archived === undefined ? existing.archivedAt : input.archived ? new Date() : null,
    },
  });
}
