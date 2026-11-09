import type { Prisma } from '@prisma/client';
import { AppError } from '@/server/http';
import { audit } from '@/server/audit';

/**
 * Roster Enrollment Engine (PRD-05 FR-7..FR-12, NFR-3). Every function
 * takes the caller's transaction client first and never opens its own
 * transaction (ADR-1). Writes are batched (one createMany + one
 * updateMany per call), never per-row loops.
 *
 * Capacity is checked for every affected course BEFORE any write, so a
 * CONFLICT never leaves a half-applied enroll (and audit() — which writes
 * outside the tx — only runs after the writes succeeded).
 */

export type Tx = Prisma.TransactionClient;

export interface EnrollOptions {
  overrideCapacity?: boolean;
  actorId?: string | null;
}

export interface EnrollResult {
  enrolled: number;
  reactivated: number;
  alreadyActive: number;
}

export interface CapacityCheck {
  sectionId?: string;
  courseId?: string;
  addingCount: number;
  overrideCapacity?: boolean;
}

/** FR-11: the one shared capacity guard. Message pattern "Section 7A is full (30/30)." */
export async function checkCapacityOrThrow(tx: Tx, check: CapacityCheck): Promise<void> {
  if (check.overrideCapacity || check.addingCount <= 0) return;

  if (check.sectionId) {
    const section = await tx.section.findUnique({
      where: { id: check.sectionId },
      select: { name: true, capacity: true, _count: { select: { members: true } } },
    });
    if (!section) throw new AppError('NOT_FOUND', 'Section not found');
    const current = section._count.members;
    if (current + check.addingCount > section.capacity) {
      throw new AppError('CONFLICT', `Section ${section.name} is full (${current}/${section.capacity}).`);
    }
  }

  if (check.courseId) {
    const course = await tx.course.findUnique({
      where: { id: check.courseId },
      select: { code: true, capacity: true },
    });
    if (!course) throw new AppError('NOT_FOUND', 'Course not found');
    if (course.capacity === null) return;
    const current = await tx.enrollment.count({ where: { courseId: check.courseId, status: 'ACTIVE' } });
    if (current + check.addingCount > course.capacity) {
      throw new AppError('CONFLICT', `Course ${course.code} is full (${current}/${course.capacity}).`);
    }
  }
}

/**
 * Reactivate-or-create for (courseIds × studentIds): DROPPED rows flip back
 * to ACTIVE (droppedAt cleared), missing rows are created, ACTIVE rows are
 * counted and left alone. Shared by section core-course enrollment and
 * direct elective enrollment (courses-service).
 */
export async function enrollStudentsInCourses(
  tx: Tx,
  courseIds: string[],
  studentIds: string[],
  options: EnrollOptions = {},
): Promise<EnrollResult> {
  const result: EnrollResult = { enrolled: 0, reactivated: 0, alreadyActive: 0 };
  const students = [...new Set(studentIds)];
  if (courseIds.length === 0 || students.length === 0) return result;

  const existing = await tx.enrollment.findMany({
    where: { courseId: { in: courseIds }, studentId: { in: students } },
    select: { id: true, courseId: true, studentId: true, status: true },
  });
  const byPair = new Map(existing.map((row) => [`${row.courseId}:${row.studentId}`, row]));

  const toCreate: { courseId: string; studentId: string }[] = [];
  const toReactivate: string[] = [];
  const addingPerCourse = new Map<string, number>();

  for (const courseId of courseIds) {
    for (const studentId of students) {
      const row = byPair.get(`${courseId}:${studentId}`);
      if (row?.status === 'ACTIVE') {
        result.alreadyActive += 1;
        continue;
      }
      if (row) toReactivate.push(row.id);
      else toCreate.push({ courseId, studentId });
      addingPerCourse.set(courseId, (addingPerCourse.get(courseId) ?? 0) + 1);
    }
  }

  for (const [courseId, addingCount] of addingPerCourse) {
    await checkCapacityOrThrow(tx, { courseId, addingCount, overrideCapacity: options.overrideCapacity });
  }

  if (toCreate.length > 0) {
    const created = await tx.enrollment.createMany({ data: toCreate, skipDuplicates: true });
    result.enrolled = created.count;
  }
  if (toReactivate.length > 0) {
    const updated = await tx.enrollment.updateMany({
      where: { id: { in: toReactivate } },
      data: { status: 'ACTIVE', droppedAt: null },
    });
    result.reactivated = updated.count;
  }

  if (result.enrolled + result.reactivated > 0) {
    await audit({
      actorId: options.actorId,
      action: 'enrollment.enroll',
      entityType: 'Enrollment',
      metadata: { courseIds, studentIds: students, ...result },
    });
  }
  return result;
}

/** FR-7/FR-10: enroll students in every non-archived CORE course of a section. */
export async function enrollSectionCoreCourses(
  tx: Tx,
  sectionId: string,
  studentIds: string[],
  options: EnrollOptions = {},
): Promise<EnrollResult> {
  const courses = await tx.course.findMany({
    where: { sectionId, kind: 'CORE', archivedAt: null },
    select: { id: true },
  });
  return enrollStudentsInCourses(
    tx,
    courses.map((c) => c.id),
    studentIds,
    options,
  );
}

/** FR-8: ACTIVE -> DROPPED on this section's CORE courses only; electives untouched. */
export async function dropSectionCoreCourses(
  tx: Tx,
  sectionId: string,
  studentIds: string[],
  options: Pick<EnrollOptions, 'actorId'> = {},
): Promise<number> {
  if (studentIds.length === 0) return 0;
  const { count } = await tx.enrollment.updateMany({
    where: { studentId: { in: studentIds }, status: 'ACTIVE', course: { sectionId, kind: 'CORE' } },
    data: { status: 'DROPPED', droppedAt: new Date() },
  });
  if (count > 0) {
    await audit({
      actorId: options.actorId,
      action: 'enrollment.drop',
      entityType: 'Enrollment',
      metadata: { sectionId, studentIds, dropped: count },
    });
  }
  return count;
}

/** FR-9: drop source CORE enrollments, then enroll destination CORE — inside the caller's tx. */
export async function moveStudentSection(
  tx: Tx,
  studentId: string,
  fromSectionId: string,
  toSectionId: string,
  options: EnrollOptions = {},
): Promise<{ dropped: number; enrollments: EnrollResult }> {
  const dropped = await dropSectionCoreCourses(tx, fromSectionId, [studentId], options);
  const enrollments = await enrollSectionCoreCourses(tx, toSectionId, [studentId], options);
  return { dropped, enrollments };
}
