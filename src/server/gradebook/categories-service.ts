import type { GradeCategory } from '@prisma/client';
import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import { audit } from '@/server/audit';
import { assertCanManageCourse, assertCanViewCourse } from '@/server/auth/course-access';
import type { AccessUser } from '@/server/auth/student-access';
import { dec, fixed2 } from '@/server/assignments/grading-math';
import { weightSum, type CategoriesPut } from '@/lib/validators/gradebook';

/** PRD-11 categories + course scale (FR-17, FR-40). */

export const toCategoryDto = (c: GradeCategory) => ({
  id: c.id,
  name: c.name,
  weightPercent: fixed2(c.weightPercent),
  dropLowest: c.dropLowest,
  order: c.order,
});

async function load(courseId: string) {
  const [course, categories, def] = await Promise.all([
    prisma.course.findUnique({ where: { id: courseId }, select: { gradingScaleId: true, gradingScale: { select: { id: true, name: true } } } }),
    prisma.gradeCategory.findMany({ where: { courseId }, orderBy: { order: 'asc' } }),
    prisma.gradingScale.findFirst({ where: { isDefault: true }, select: { id: true, name: true } }),
  ]);
  if (!course) throw new AppError('NOT_FOUND', 'Course not found');
  return { gradingScaleId: course.gradingScaleId, effectiveScale: course.gradingScale ?? def, categories: categories.map(toCategoryDto) };
}

export async function getCategories(user: AccessUser, courseId: string) {
  await assertCanViewCourse(user, courseId);
  return load(courseId);
}

/** PUT replaces the whole list in one transaction; a non-empty list must total exactly 100. */
export async function replaceCategories(user: AccessUser, courseId: string, input: CategoriesPut, request?: Request) {
  await assertCanManageCourse(user, courseId);
  const sum = weightSum(input.categories);
  if (input.categories.length && !dec(sum).eq(100)) {
    throw new AppError('VALIDATION_ERROR', `Weights total ${dec(sum).toString()} / 100`, { sum });
  }
  const before = await load(courseId);
  const knownIds = new Set(before.categories.map((c) => c.id));
  const foreign = input.categories.filter((c) => c.id && !knownIds.has(c.id));
  if (foreign.length) throw new AppError('VALIDATION_ERROR', 'Unknown category id.', { ids: foreign.map((c) => c.id) });
  if (input.gradingScaleId) {
    const exists = await prisma.gradingScale.findUnique({ where: { id: input.gradingScaleId }, select: { id: true } });
    if (!exists) throw new AppError('VALIDATION_ERROR', 'Unknown grading scale.', { fieldErrors: { gradingScaleId: ['Unknown scale'] } });
  }

  await prisma.$transaction(async (tx) => {
    const keep = input.categories.map((c) => c.id).filter((id): id is string => !!id);
    await tx.gradeCategory.deleteMany({ where: { courseId, id: { notIn: keep } } });
    for (const c of input.categories) {
      const data = { name: c.name, weightPercent: c.weightPercent, dropLowest: c.dropLowest, order: c.order };
      if (c.id) await tx.gradeCategory.update({ where: { id: c.id }, data });
      else await tx.gradeCategory.create({ data: { ...data, courseId } });
    }
    if (input.gradingScaleId !== undefined) await tx.course.update({ where: { id: courseId }, data: { gradingScaleId: input.gradingScaleId } });
  });
  const after = await load(courseId);
  await audit({ actorId: user.id, action: 'gradeCategories.replace', entityType: 'Course', entityId: courseId, metadata: { old: before, new: after }, request });
  return after;
}
