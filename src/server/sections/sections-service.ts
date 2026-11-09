import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import { audit } from '@/server/audit';
import { getCurrentAcademicYear } from '@/server/services/academicYears';
import {
  checkCapacityOrThrow,
  dropSectionCoreCourses,
  enrollSectionCoreCourses,
  moveStudentSection,
  type EnrollResult,
  type Tx,
} from '@/server/enrollment/roster-engine';
import type {
  CopyToYearInput,
  EnrollStudentsInput,
  MoveSectionInput,
  SectionInput,
  SectionsListQuery,
  SectionUpdateInput,
} from '@/lib/validators/sections';

/** Sections CRUD + membership (PRD-05 FR-2..FR-9, FR-12, FR-24, NFR-2, NFR-6). */

export function personName(user: { firstName: string; lastName: string }): string {
  return `${user.firstName} ${user.lastName}`;
}

const personSelect = { id: true, firstName: true, lastName: true } as const;

const sectionInclude = {
  gradeLevel: { select: { id: true, name: true, order: true } },
  homeroomTeacher: { select: personSelect },
  room: { select: { id: true, name: true } },
  _count: { select: { members: true, courses: true } },
} satisfies Prisma.SectionInclude;

type SectionRow = Prisma.SectionGetPayload<{ include: typeof sectionInclude }>;

function toSection(row: SectionRow) {
  const { _count, homeroomTeacher, ...rest } = row;
  return {
    ...rest,
    homeroomTeacher: homeroomTeacher ? { id: homeroomTeacher.id, name: personName(homeroomTeacher) } : null,
    memberCount: _count.members,
    courseCount: _count.courses,
  };
}
export type SectionDto = ReturnType<typeof toSection>;

async function resolveYearId(academicYearId?: string): Promise<string | null> {
  if (academicYearId) return academicYearId;
  const current = await getCurrentAcademicYear();
  return current?.id ?? null;
}

export async function listSections(query: Partial<SectionsListQuery>, page: { skip: number; take: number }) {
  const academicYearId = await resolveYearId(query.academicYearId);
  if (!academicYearId) return { rows: [] as SectionDto[], total: 0, academicYearId: null };

  const where: Prisma.SectionWhereInput = {
    academicYearId,
    ...(query.gradeLevelId ? { gradeLevelId: query.gradeLevelId } : {}),
    ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
  };
  const order = query.order ?? 'asc';
  const orderBy: Prisma.SectionOrderByWithRelationInput[] =
    query.sort === 'name'
      ? [{ name: order }]
      : query.sort === 'memberCount'
        ? [{ members: { _count: order } }, { name: 'asc' }]
        : [{ gradeLevel: { order } }, { name: 'asc' }];

  const [rows, total] = await Promise.all([
    prisma.section.findMany({ where, include: sectionInclude, orderBy, skip: page.skip, take: page.take }),
    prisma.section.count({ where }),
  ]);
  return { rows: rows.map(toSection), total, academicYearId };
}

export async function getSection(id: string) {
  const row = await prisma.section.findUnique({
    where: { id },
    include: {
      ...sectionInclude,
      academicYear: { select: { id: true, name: true } },
      members: {
        include: {
          student: { select: { ...personSelect, email: true, studentProfile: { select: { admissionNumber: true } } } },
        },
        orderBy: [{ student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }],
      },
      courses: {
        include: { subject: { select: { id: true, name: true, code: true, color: true } }, teacher: { select: personSelect } },
        orderBy: { code: 'asc' },
      },
    },
  });
  if (!row) throw new AppError('NOT_FOUND', 'Section not found');
  const { members, courses, academicYear, ...rest } = row;
  return {
    ...toSection(rest as SectionRow),
    academicYear,
    members: members.map((m) => ({
      id: m.student.id,
      name: personName(m.student),
      email: m.student.email,
      admissionNumber: m.student.studentProfile?.admissionNumber ?? null,
      joinedAt: m.joinedAt,
    })),
    courses: courses.map((c) => ({
      id: c.id,
      name: c.name,
      code: c.code,
      kind: c.kind,
      archivedAt: c.archivedAt,
      subject: c.subject,
      teacher: { id: c.teacher.id, name: personName(c.teacher) },
    })),
  };
}

async function assertTeacher(tx: Tx, teacherId: string) {
  const teacher = await tx.user.findUnique({ where: { id: teacherId }, select: { role: true } });
  if (!teacher || teacher.role !== 'TEACHER') {
    throw new AppError('VALIDATION_ERROR', 'Homeroom teacher must be a teacher.');
  }
}

/** Decision 3: one homeroom section per teacher per year, checked inside the write tx. */
async function assertHomeroomAvailable(tx: Tx, academicYearId: string, teacherId: string, excludeId?: string) {
  const clash = await tx.section.findFirst({
    where: { academicYearId, homeroomTeacherId: teacherId, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { name: true },
  });
  if (clash) {
    throw new AppError('CONFLICT', `This teacher is already homeroom teacher of section ${clash.name} this year.`);
  }
}

export async function createSection(input: SectionInput, actorId?: string | null) {
  const section = await prisma.$transaction(async (tx) => {
    if (input.homeroomTeacherId) {
      await assertTeacher(tx, input.homeroomTeacherId);
      await assertHomeroomAvailable(tx, input.academicYearId, input.homeroomTeacherId);
    }
    return tx.section.create({
      data: {
        academicYearId: input.academicYearId,
        gradeLevelId: input.gradeLevelId,
        name: input.name,
        homeroomTeacherId: input.homeroomTeacherId ?? null,
        roomId: input.roomId ?? null,
        capacity: input.capacity,
      },
      include: sectionInclude,
    });
  });
  await audit({ actorId, action: 'section.create', entityType: 'Section', entityId: section.id });
  return toSection(section);
}

export async function updateSection(id: string, input: SectionUpdateInput, actorId?: string | null) {
  const section = await prisma.$transaction(async (tx) => {
    const existing = await tx.section.findUnique({ where: { id }, include: { _count: { select: { members: true } } } });
    if (!existing) throw new AppError('NOT_FOUND', 'Section not found');
    if (input.homeroomTeacherId && input.homeroomTeacherId !== existing.homeroomTeacherId) {
      await assertTeacher(tx, input.homeroomTeacherId);
      await assertHomeroomAvailable(tx, existing.academicYearId, input.homeroomTeacherId, id);
    }
    if (input.capacity !== undefined && input.capacity < existing._count.members) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Capacity cannot be lower than the current member count (${existing._count.members}).`,
      );
    }
    return tx.section.update({
      where: { id },
      data: {
        gradeLevelId: input.gradeLevelId,
        name: input.name,
        homeroomTeacherId: input.homeroomTeacherId,
        roomId: input.roomId,
        capacity: input.capacity,
      },
      include: sectionInclude,
    });
  });
  await audit({
    actorId,
    action: 'section.update',
    entityType: 'Section',
    entityId: id,
    metadata: { fields: Object.keys(input) },
  });
  return toSection(section);
}

export async function deleteSection(id: string, actorId?: string | null) {
  await prisma.$transaction(async (tx) => {
    const section = await tx.section.findUnique({
      where: { id },
      include: { _count: { select: { members: true, courses: true } } },
    });
    if (!section) throw new AppError('NOT_FOUND', 'Section not found');
    if (section._count.members > 0 || section._count.courses > 0) {
      throw new AppError('CONFLICT', `Section ${section.name} still has members or courses.`);
    }
    await tx.section.delete({ where: { id } });
  });
  await audit({ actorId, action: 'section.delete', entityType: 'Section', entityId: id });
  return { id };
}

/** FR-4 picker: STUDENTs of the section's grade level with no section this year. */
export async function listEligibleStudents(sectionId: string) {
  const section = await prisma.section.findUnique({
    where: { id: sectionId },
    select: { gradeLevelId: true, academicYearId: true },
  });
  if (!section) throw new AppError('NOT_FOUND', 'Section not found');
  const students = await prisma.user.findMany({
    where: {
      role: 'STUDENT',
      archivedAt: null,
      studentProfile: { gradeLevelId: section.gradeLevelId },
      sectionMemberships: { none: { academicYearId: section.academicYearId } },
    },
    select: { ...personSelect, email: true, studentProfile: { select: { admissionNumber: true } } },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });
  return students.map((s) => ({
    id: s.id,
    name: personName(s),
    email: s.email,
    admissionNumber: s.studentProfile?.admissionNumber ?? null,
  }));
}

async function loadSectionWithYear(tx: Tx, sectionId: string) {
  const section = await tx.section.findUnique({
    where: { id: sectionId },
    include: { academicYear: { select: { name: true } } },
  });
  if (!section) throw new AppError('NOT_FOUND', 'Section not found');
  return section;
}

async function alreadyInSectionError(tx: Tx, studentIds: string[], academicYearId: string, yearName: string) {
  const clash = await tx.sectionMember.findFirst({
    where: { studentId: { in: studentIds }, academicYearId },
    include: { student: { select: personSelect }, section: { select: { name: true } } },
  });
  if (!clash) return null;
  return new AppError(
    'CONFLICT',
    `${personName(clash.student)} is already in section ${clash.section.name} for ${yearName}.`,
  );
}

export async function addMembers(sectionId: string, input: EnrollStudentsInput, actorId?: string | null) {
  const studentIds = [...new Set(input.studentIds)];
  const result = await prisma.$transaction(async (tx) => {
    const section = await loadSectionWithYear(tx, sectionId);

    const students = await tx.user.findMany({
      where: { id: { in: studentIds }, role: 'STUDENT' },
      select: { id: true, studentProfile: { select: { gradeLevelId: true } } },
    });
    if (students.length !== studentIds.length) {
      throw new AppError('VALIDATION_ERROR', 'Every selected user must be a student.');
    }
    if (students.some((s) => s.studentProfile?.gradeLevelId !== section.gradeLevelId)) {
      throw new AppError('VALIDATION_ERROR', "Every student must be in the section's grade level.");
    }

    const clash = await alreadyInSectionError(tx, studentIds, section.academicYearId, section.academicYear.name);
    if (clash) throw clash;

    await checkCapacityOrThrow(tx, { sectionId, addingCount: studentIds.length, overrideCapacity: input.overrideCapacity });

    try {
      await tx.sectionMember.createMany({
        data: studentIds.map((studentId) => ({ sectionId, studentId, academicYearId: section.academicYearId })),
      });
    } catch (error) {
      // NFR-2: the DB unique constraint is the real guard if a concurrent add won the race.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError('CONFLICT', `A selected student is already in a section for ${section.academicYear.name}.`);
      }
      throw error;
    }

    const enrollments = await enrollSectionCoreCourses(tx, sectionId, studentIds, {
      overrideCapacity: input.overrideCapacity,
      actorId,
    });
    return { added: studentIds.length, enrollments };
  });
  await audit({
    actorId,
    action: 'section.member.add',
    entityType: 'Section',
    entityId: sectionId,
    metadata: { studentIds },
  });
  return result;
}

export async function removeMember(sectionId: string, studentId: string, actorId?: string | null) {
  const droppedEnrollments = await prisma.$transaction(async (tx) => {
    const { count } = await tx.sectionMember.deleteMany({ where: { sectionId, studentId } });
    if (count === 0) throw new AppError('NOT_FOUND', 'Student is not a member of this section');
    return dropSectionCoreCourses(tx, sectionId, [studentId], { actorId });
  });
  await audit({
    actorId,
    action: 'section.member.remove',
    entityType: 'Section',
    entityId: sectionId,
    metadata: { studentId },
  });
  return { removed: true as const, droppedEnrollments };
}

/** FR-9: one transaction — membership switch + drop source CORE + enroll destination CORE. */
export async function moveStudent(studentId: string, input: MoveSectionInput, actorId?: string | null) {
  const result = await prisma.$transaction(async (tx) => {
    const to = await loadSectionWithYear(tx, input.toSectionId);
    const membership = await tx.sectionMember.findUnique({
      where: { studentId_academicYearId: { studentId, academicYearId: to.academicYearId } },
    });
    if (!membership) {
      throw new AppError('NOT_FOUND', `Student has no section in ${to.academicYear.name}.`);
    }
    if (membership.sectionId === to.id) {
      throw new AppError('VALIDATION_ERROR', `Student is already in section ${to.name}.`);
    }
    await checkCapacityOrThrow(tx, { sectionId: to.id, addingCount: 1, overrideCapacity: input.overrideCapacity });

    await tx.sectionMember.update({ where: { id: membership.id }, data: { sectionId: to.id, joinedAt: new Date() } });
    const moved = await moveStudentSection(tx, studentId, membership.sectionId, to.id, {
      overrideCapacity: input.overrideCapacity,
      actorId,
    });
    return { fromSectionId: membership.sectionId, toSectionId: to.id, ...moved };
  });
  await audit({
    actorId,
    action: 'section.member.move',
    entityType: 'User',
    entityId: studentId,
    metadata: { fromSectionId: result.fromSectionId, toSectionId: result.toSectionId },
  });
  return result as { fromSectionId: string; toSectionId: string; dropped: number; enrollments: EnrollResult };
}

/** A future (starts after today), non-current year that sections can be copied into. */
export function isCopyTargetYear(year: { isCurrent: boolean; startDate: Date }, now = new Date()): boolean {
  return !year.isCurrent && year.startDate > now;
}

/** FR-6 / NFR-6: structural copy only — no members, teachers or courses. */
export async function copySectionsToYear(input: CopyToYearInput, actorId?: string | null) {
  const [fromYear, toYear] = await Promise.all([
    prisma.academicYear.findUnique({ where: { id: input.fromYearId } }),
    prisma.academicYear.findUnique({ where: { id: input.toYearId } }),
  ]);
  if (!fromYear || !toYear) throw new AppError('NOT_FOUND', 'Academic year not found');
  if (!isCopyTargetYear(toYear)) {
    throw new AppError('VALIDATION_ERROR', 'Sections can only be copied into a future, non-current academic year.');
  }

  const [sections, gradeLevels, existing] = await Promise.all([
    prisma.section.findMany({ where: { academicYearId: fromYear.id }, include: { gradeLevel: true } }),
    prisma.gradeLevel.findMany({ where: { archivedAt: null }, orderBy: { order: 'asc' } }),
    prisma.section.findMany({ where: { academicYearId: toYear.id }, select: { name: true } }),
  ]);
  const takenNames = new Set(existing.map((s) => s.name));

  const skipped: { name: string; reason: string }[] = [];
  const data: Prisma.SectionCreateManyInput[] = [];
  for (const section of sections) {
    const next = gradeLevels.find((g) => g.order > section.gradeLevel.order);
    if (!next) {
      skipped.push({ name: section.name, reason: 'no next grade level' });
    } else if (takenNames.has(section.name)) {
      skipped.push({ name: section.name, reason: 'name already exists in target year' });
    } else {
      takenNames.add(section.name);
      data.push({
        academicYearId: toYear.id,
        gradeLevelId: next.id,
        name: section.name,
        roomId: section.roomId,
        capacity: section.capacity,
      });
    }
  }

  const { count } = data.length ? await prisma.section.createMany({ data }) : { count: 0 };
  if (count > 0) {
    await audit({
      actorId,
      action: 'section.create',
      entityType: 'Section',
      metadata: { copiedFrom: fromYear.id, toYearId: toYear.id, names: data.map((d) => d.name) },
    });
  }
  return { created: count, skipped };
}
