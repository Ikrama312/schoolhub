import type { GradingScale, Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import { audit } from '@/server/audit';
import type { AccessUser } from '@/server/auth/student-access';
import type { ScaleInput, ScalePatch } from '@/lib/validators/gradebook';

/**
 * PRD-11 grading scales (FR-16). Exactly one default: setting a default clears the others in the
 * same transaction; the partial unique index grading_scale_one_default is the backstop (ADR-3).
 */

const toDto = (s: GradingScale) => ({
  id: s.id,
  name: s.name,
  isDefault: s.isDefault,
  bands: s.bands as unknown as ScaleInput['bands'],
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
});
export type GradingScaleDto = ReturnType<typeof toDto>;

const adminOnly = (user: AccessUser) => {
  if (user.role !== 'ADMIN') throw new AppError('FORBIDDEN', 'Only administrators can manage grading scales.');
};
const notFound = () => new AppError('NOT_FOUND', 'Grading scale not found');

export async function listScales() {
  const rows = await prisma.gradingScale.findMany({ orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] });
  return rows.map(toDto);
}

export async function createScale(user: AccessUser, input: ScaleInput, request?: Request) {
  adminOnly(user);
  const scale = await prisma.$transaction(async (tx) => {
    const isDefault = input.isDefault || (await tx.gradingScale.count()) === 0;
    if (isDefault) await tx.gradingScale.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    return tx.gradingScale.create({ data: { name: input.name, isDefault, bands: input.bands as unknown as Prisma.InputJsonValue } });
  });
  await audit({ actorId: user.id, action: 'gradingScale.create', entityType: 'GradingScale', entityId: scale.id, metadata: { name: scale.name, isDefault: scale.isDefault }, request });
  return toDto(scale);
}

export async function updateScale(user: AccessUser, id: string, patch: ScalePatch, request?: Request) {
  adminOnly(user);
  const old = await prisma.gradingScale.findUnique({ where: { id } });
  if (!old) throw notFound();
  if (patch.isDefault === false && old.isDefault) {
    throw new AppError('VALIDATION_ERROR', 'Make another scale the default instead.', { fieldErrors: { isDefault: ['A default scale is required'] } });
  }
  const scale = await prisma.$transaction(async (tx) => {
    if (patch.isDefault && !old.isDefault) await tx.gradingScale.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    return tx.gradingScale.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.isDefault !== undefined ? { isDefault: patch.isDefault } : {}),
        ...(patch.bands !== undefined ? { bands: patch.bands as unknown as Prisma.InputJsonValue } : {}),
      },
    });
  });
  await audit({ actorId: user.id, action: 'gradingScale.update', entityType: 'GradingScale', entityId: id, metadata: { old: toDto(old), new: toDto(scale) }, request });
  return toDto(scale);
}

/** A11: the default or a scale any course uses can't be deleted. */
export async function deleteScale(user: AccessUser, id: string, request?: Request) {
  adminOnly(user);
  const scale = await prisma.gradingScale.findUnique({ where: { id }, include: { _count: { select: { courses: true } } } });
  if (!scale) throw notFound();
  if (scale.isDefault) throw new AppError('CONFLICT', 'The default scale cannot be deleted.', { courseCount: scale._count.courses });
  if (scale._count.courses > 0) {
    throw new AppError('CONFLICT', `This scale is used by ${scale._count.courses} course(s).`, { courseCount: scale._count.courses });
  }
  await prisma.gradingScale.delete({ where: { id } });
  await audit({ actorId: user.id, action: 'gradingScale.delete', entityType: 'GradingScale', entityId: id, metadata: { old: toDto(scale) }, request });
  return { id };
}
