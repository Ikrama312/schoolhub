import { addDays, differenceInCalendarDays, format } from 'date-fns';
import { Prisma, type AcademicYear, type Term } from '@prisma/client';
import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import { rangesOverlap } from './dateRange';

export interface TermInput {
  name: string;
  startDate: Date;
  endDate: Date;
}

export type GeneratePattern = 'SEMESTERS' | 'TRIMESTERS' | 'QUARTERS';

const PATTERN_CONFIG: Record<GeneratePattern, { count: number; label: string }> = {
  SEMESTERS: { count: 2, label: 'Semester' },
  TRIMESTERS: { count: 3, label: 'Trimester' },
  QUARTERS: { count: 4, label: 'Quarter' },
};

function assertValidRange(startDate: Date, endDate: Date) {
  if (endDate <= startDate) {
    throw new AppError('VALIDATION_ERROR', 'End date must be after start date.');
  }
}

function assertInsideYear(year: Pick<AcademicYear, 'startDate' | 'endDate'>, startDate: Date, endDate: Date) {
  if (startDate < year.startDate) {
    throw new AppError('VALIDATION_ERROR', `Term must start on or after ${format(year.startDate, 'yyyy-MM-dd')}.`);
  }
  if (endDate > year.endDate) {
    throw new AppError('VALIDATION_ERROR', `Term must end on or before ${format(year.endDate, 'yyyy-MM-dd')}.`);
  }
}

function assertNoSiblingOverlap(
  siblings: Pick<Term, 'name' | 'startDate' | 'endDate'>[],
  startDate: Date,
  endDate: Date,
) {
  const conflict = siblings.find((term) => rangesOverlap({ startDate, endDate }, term));
  if (conflict) {
    throw new AppError('VALIDATION_ERROR', `Dates overlap with ${conflict.name}.`);
  }
}

export async function createTerm(academicYearId: string, input: TermInput) {
  assertValidRange(input.startDate, input.endDate);
  return prisma.$transaction(
    async (tx) => {
      const year = await tx.academicYear.findUniqueOrThrow({ where: { id: academicYearId } });
      assertInsideYear(year, input.startDate, input.endDate);
      const siblings = await tx.term.findMany({ where: { academicYearId } });
      assertNoSiblingOverlap(siblings, input.startDate, input.endDate);
      const maxOrder = siblings.reduce((max, term) => Math.max(max, term.order), 0);
      return tx.term.create({
        data: { academicYearId, name: input.name, startDate: input.startDate, endDate: input.endDate, order: maxOrder + 1 },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function updateTerm(id: string, input: Partial<TermInput> & { order?: number }) {
  return prisma.$transaction(
    async (tx) => {
      const existing = await tx.term.findUniqueOrThrow({ where: { id } });
      const year = await tx.academicYear.findUniqueOrThrow({ where: { id: existing.academicYearId } });
      const startDate = input.startDate ?? existing.startDate;
      const endDate = input.endDate ?? existing.endDate;
      assertValidRange(startDate, endDate);
      assertInsideYear(year, startDate, endDate);
      const siblings = await tx.term.findMany({
        where: { academicYearId: existing.academicYearId, id: { not: id } },
      });
      assertNoSiblingOverlap(siblings, startDate, endDate);
      return tx.term.update({
        where: { id },
        data: { name: input.name ?? existing.name, startDate, endDate, order: input.order ?? existing.order },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function deleteTerm(id: string) {
  await prisma.term.delete({ where: { id } });
}

/**
 * Persists a new term order for one academic year. Writes negative
 * placeholder orders first so the @@unique([academicYearId, order])
 * constraint never collides with an order value still held by another
 * term mid-swap.
 */
export async function reorderTerms(academicYearId: string, termIds: string[]) {
  return prisma.$transaction(async (tx) => {
    for (const [index, id] of termIds.entries()) {
      await tx.term.updateMany({ where: { id, academicYearId }, data: { order: -(index + 1) } });
    }
    for (const [index, id] of termIds.entries()) {
      await tx.term.updateMany({ where: { id, academicYearId }, data: { order: index + 1 } });
    }
    return tx.term.findMany({ where: { academicYearId }, orderBy: { order: 'asc' } });
  });
}

/**
 * Splits the year's date range into `count` contiguous, equal-length terms,
 * named "<Label> 1", "<Label> 2"... Earlier terms absorb the remainder day
 * when the range doesn't divide evenly, so every day of the year is covered
 * with no gap or overlap. Only allowed when the year has zero terms.
 */
export async function generateTerms(academicYearId: string, pattern: GeneratePattern) {
  return prisma.$transaction(async (tx) => {
    const year = await tx.academicYear.findUniqueOrThrow({ where: { id: academicYearId } });
    const existingCount = await tx.term.count({ where: { academicYearId } });
    if (existingCount > 0) {
      throw new AppError('CONFLICT', 'Generate terms is only available when the year has no terms.');
    }

    const { count, label } = PATTERN_CONFIG[pattern];
    const totalDays = differenceInCalendarDays(year.endDate, year.startDate) + 1;
    const base = Math.floor(totalDays / count);
    const remainder = totalDays % count;

    let cursor = year.startDate;
    const termsData: { academicYearId: string; name: string; startDate: Date; endDate: Date; order: number }[] = [];
    for (let i = 0; i < count; i++) {
      const length = base + (i < remainder ? 1 : 0);
      const startDate = cursor;
      const endDate = addDays(startDate, length - 1);
      termsData.push({ academicYearId, name: `${label} ${i + 1}`, startDate, endDate, order: i + 1 });
      cursor = addDays(endDate, 1);
    }

    await tx.term.createMany({ data: termsData });
    return tx.term.findMany({ where: { academicYearId }, orderBy: { order: 'asc' } });
  });
}
