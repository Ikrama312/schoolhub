import { cache } from 'react';
import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import { rangesOverlap } from './dateRange';
import { getSchoolSettings } from './settings';
import { formatInSchoolTz } from '@/lib/dates';

export interface AcademicYearInput {
  name: string;
  startDate: Date;
  endDate: Date;
}

function assertValidRange(startDate: Date, endDate: Date) {
  if (endDate <= startDate) {
    throw new AppError('VALIDATION_ERROR', 'End date must be after start date.');
  }
}

async function assertNoOverlap(
  tx: Prisma.TransactionClient,
  range: { startDate: Date; endDate: Date },
  excludeId?: string,
) {
  const others = await tx.academicYear.findMany({
    where: excludeId ? { id: { not: excludeId } } : undefined,
  });
  const conflict = others.find((year) => rangesOverlap(range, year));
  if (conflict) {
    throw new AppError('VALIDATION_ERROR', `Dates overlap with ${conflict.name}.`);
  }
}

export async function listAcademicYears() {
  return prisma.academicYear.findMany({
    orderBy: { startDate: 'asc' },
    include: { terms: { orderBy: { order: 'asc' } } },
  });
}

export async function createAcademicYear(input: AcademicYearInput) {
  assertValidRange(input.startDate, input.endDate);
  return prisma.$transaction(
    async (tx) => {
      await assertNoOverlap(tx, input);
      return tx.academicYear.create({ data: input });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function updateAcademicYear(id: string, input: Partial<AcademicYearInput>) {
  return prisma.$transaction(
    async (tx) => {
      const existing = await tx.academicYear.findUniqueOrThrow({ where: { id } });
      const startDate = input.startDate ?? existing.startDate;
      const endDate = input.endDate ?? existing.endDate;
      assertValidRange(startDate, endDate);
      await assertNoOverlap(tx, { startDate, endDate }, id);
      return tx.academicYear.update({
        where: { id },
        data: { name: input.name ?? existing.name, startDate, endDate },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

/** Sets isCurrent = true on `id` and false on every other year, atomically. */
export async function setCurrentAcademicYear(id: string) {
  const [, updated] = await prisma.$transaction([
    prisma.academicYear.updateMany({ where: { id: { not: id } }, data: { isCurrent: false } }),
    prisma.academicYear.update({ where: { id }, data: { isCurrent: true } }),
  ]);
  return updated;
}

export async function deleteAcademicYear(id: string) {
  const termCount = await prisma.term.count({ where: { academicYearId: id } });
  if (termCount > 0) {
    throw new AppError('CONFLICT', 'In use — cannot delete.');
  }
  await prisma.academicYear.delete({ where: { id } });
}

/** The one place the rest of the app reads "the current academic year" from. */
export const getCurrentAcademicYear = cache(async () => {
  return prisma.academicYear.findFirst({
    where: { isCurrent: true },
    include: { terms: { orderBy: { order: 'asc' } } },
  });
});

/** Returns the term whose range contains `date` (school-timezone calendar day), or null. */
export async function getCurrentTerm(date: Date = new Date()) {
  const settings = await getSchoolSettings();
  const dayKey = formatInSchoolTz(date, 'yyyy-MM-dd', settings.timezone);
  const asOf = new Date(`${dayKey}T00:00:00.000Z`);
  return prisma.term.findFirst({
    where: { startDate: { lte: asOf }, endDate: { gte: asOf } },
  });
}
