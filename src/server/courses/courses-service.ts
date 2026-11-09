import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import { audit } from '@/server/audit';
import { getCurrentAcademicYear } from '@/server/services/academicYears';
import { listLinksForParent } from '@/server/services/userLinks';
import type { AccessUser } from '@/server/auth/student-access';
import type { Role } from '@/config/navigation';
import { personName } from '@/server/sections/sections-service';
import {
  checkCapacityOrThrow,
  enrollStudentsInCourses,
  type EnrollResult,
  type Tx,
} from '@/server/enrollment/roster-engine';
import { defaultCourseCode, defaultCourseName } from '@/lib/validators/courses';
import type {
  CourseInput,
  CoursesListQuery,
  CourseUpdateInput,
  EnrollmentStatusInput,
  RosterQuery,
} from '@/lib/validators/courses';
import type { CoreCoursesInput, EnrollStudentsInput } from '@/lib/validators/sections';

/** Courses CRUD, rosters and enrollment (PRD-05 FR-5, FR-10..FR-21, FR-24, NFR-4). */

const personSelect = { id: true, firstName: true, lastName: true } as const;
const person = (u: { id: string; firstName: string; lastName: string }) => ({ id: u.id, name: personName(u) });

const courseInclude = {
  subject: { select: { id: true, name: true, code: true, color: true } },
  section: { select: { id: true, name: true, room: { select: { id: true, name: true } } } },
  teacher: { select: personSelect },
  _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
} satisfies Prisma.CourseInclude;

type CourseRow = Prisma.CourseGetPayload<{ include: typeof courseInclude }>;

/** coTeacherIds is a plain String[] (FR-1), so names come from one batched lookup. */
async function toCourses(rows: CourseRow[]) {
  const ids = [...new Set(rows.flatMap((r) => r.coTeacherIds))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: personSelect }) : [];
  const byId = new Map(users.map((u) => [u.id, person(u)]));
  return rows.map(({ _count, teacher, ...rest }) => ({
    ...rest,
    teacher: person(teacher),
    coTeachers: rest.coTeacherIds.map((id) => byId.get(id)).filter((u): u is { id: string; name: string } => !!u),
    enrolledCount: _count.enrollments,
  }));
}
export type CourseDto = Awaited<ReturnType<typeof toCourses>>[number];

const teachesWhere = (userId: string): Prisma.CourseWhereInput => ({
  OR: [{ teacherId: userId }, { coTeacherIds: { has: userId } }],
});

function codeConflict(error: unknown, code?: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new AppError('CONFLICT', code ? `Course code ${code} already exists this year.` : 'A course code already exists this year.');
  }
  throw error;
}

async function assertTeachers(tx: Tx, ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const count = await tx.user.count({ where: { id: { in: unique }, role: 'TEACHER' } });
  if (count !== unique.length) throw new AppError('VALIDATION_ERROR', 'Teachers and co-teachers must be teachers.');
}

async function assertStudents(tx: Tx, ids: string[]) {
  const count = await tx.user.count({ where: { id: { in: ids }, role: 'STUDENT' } });
  if (count !== ids.length) throw new AppError('VALIDATION_ERROR', 'Every selected user must be a student.');
}

async function resolveYearId(academicYearId?: string) {
  if (academicYearId) return academicYearId;
  return (await getCurrentAcademicYear())?.id ?? null;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** FR-13 list, scoped per role here rather than by client filter. */
export async function listCourses(
  user: AccessUser,
  query: Partial<CoursesListQuery>,
  page: { skip: number; take: number },
) {
  const academicYearId = await resolveYearId(query.academicYearId);
  if (!academicYearId) return { rows: [] as CourseDto[], total: 0 };

  const and: Prisma.CourseWhereInput[] = [{ academicYearId }];
  if (query.gradeLevelId) and.push({ section: { gradeLevelId: query.gradeLevelId } });
  if (query.subjectId) and.push({ subjectId: query.subjectId });
  if (query.teacherId) and.push(teachesWhere(query.teacherId));
  if (query.kind) and.push({ kind: query.kind });
  if (query.sectionId) and.push({ sectionId: query.sectionId });
  if (!(query.includeArchived && user.role === 'ADMIN')) and.push({ archivedAt: null });
  if (query.q) {
    and.push({
      OR: [{ name: { contains: query.q, mode: 'insensitive' } }, { code: { contains: query.q, mode: 'insensitive' } }],
    });
  }
  if (user.role === 'TEACHER') and.push(teachesWhere(user.id));
  if (user.role === 'STUDENT') and.push({ enrollments: { some: { studentId: user.id, status: 'ACTIVE' } } });
  if (user.role === 'PARENT') {
    and.push({ enrollments: { some: { status: 'ACTIVE', student: { studentLinks: { some: { parentId: user.id } } } } } });
  }

  const order = query.order ?? 'asc';
  // ponytail: enrolledCount sort counts all enrollment rows (Prisma can't order by a filtered _count); fine while DROPPED rows are rare.
  const orderBy: Prisma.CourseOrderByWithRelationInput =
    query.sort === 'name' ? { name: order } : query.sort === 'enrolledCount' ? { enrollments: { _count: order } } : { code: order };

  const where: Prisma.CourseWhereInput = { AND: and };
  const [rows, total] = await Promise.all([
    prisma.course.findMany({ where, include: courseInclude, orderBy, skip: page.skip, take: page.take }),
    prisma.course.count({ where }),
  ]);
  return { rows: await toCourses(rows), total };
}

export async function getCourse(id: string) {
  const row = await prisma.course.findUnique({ where: { id }, include: courseInclude });
  if (!row) throw new AppError('NOT_FOUND', 'Course not found');
  const [course] = await toCourses([row]);
  return course;
}

export interface RosterEntry {
  enrollmentId: string;
  status: 'ACTIVE' | 'DROPPED';
  enrolledAt: Date;
  droppedAt: Date | null;
  student: { id: string; name: string; avatarUrl: string | null; admissionNumber: string | null; profileUrl: string };
}

/**
 * NFR-4: the single roster implementation behind the Roster tab and
 * GET /api/courses/:id/roster. STUDENT gets names only, ACTIVE only;
 * PARENT is refused. Callers must have passed assertCanViewCourse first.
 */
export async function getCourseRoster(
  courseId: string,
  viewerRole: Role,
  query: Partial<RosterQuery> = {},
  page?: { skip: number; take: number },
): Promise<{ rows: RosterEntry[] | { name: string }[]; total: number }> {
  if (viewerRole === 'PARENT') throw new AppError('FORBIDDEN', 'Parents cannot view course rosters.');
  const fullView = viewerRole === 'ADMIN' || viewerRole === 'TEACHER';
  const status = fullView ? (query.status ?? 'ACTIVE') : 'ACTIVE';

  const where: Prisma.EnrollmentWhereInput = {
    courseId,
    ...(status === 'ALL' ? {} : { status }),
    ...(query.q
      ? {
          student: {
            OR: [
              { firstName: { contains: query.q, mode: 'insensitive' } },
              { lastName: { contains: query.q, mode: 'insensitive' } },
            ],
          },
        }
      : {}),
  };
  const orderBy: Prisma.EnrollmentOrderByWithRelationInput[] = [
    { student: { lastName: 'asc' } },
    { student: { firstName: 'asc' } },
  ];

  if (!fullView) {
    const [rows, total] = await Promise.all([
      prisma.enrollment.findMany({
        where,
        orderBy,
        select: { student: { select: { firstName: true, lastName: true } } },
        ...page,
      }),
      prisma.enrollment.count({ where }),
    ]);
    return { rows: rows.map((r) => ({ name: personName(r.student) })), total };
  }

  const [rows, total] = await Promise.all([
    prisma.enrollment.findMany({
      where,
      orderBy,
      include: { student: { select: { ...personSelect, studentProfile: { select: { admissionNumber: true } } } } },
      ...page,
    }),
    prisma.enrollment.count({ where }),
  ]);
  return {
    rows: rows.map((r) => ({
      enrollmentId: r.id,
      status: r.status,
      enrolledAt: r.enrolledAt,
      droppedAt: r.droppedAt,
      student: {
        id: r.student.id,
        name: personName(r.student),
        avatarUrl: null,
        admissionNumber: r.student.studentProfile?.admissionNumber ?? null,
        profileUrl: `/students/${r.student.id}`,
      },
    })),
    total,
  };
}

/** FR-19 / GET /api/me/courses: current year, non-archived. ADMIN gets an empty list. */
export async function listMyCourses(user: AccessUser) {
  const year = await getCurrentAcademicYear();
  if (!year || user.role === 'ADMIN') return [];
  const base: Prisma.CourseWhereInput = { academicYearId: year.id, archivedAt: null };

  if (user.role === 'TEACHER') {
    const rows = await prisma.course.findMany({
      where: { ...base, ...teachesWhere(user.id) },
      include: courseInclude,
      orderBy: { code: 'asc' },
    });
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      code: c.code,
      subjectColor: c.subject.color,
      section: c.section ? { id: c.section.id, name: c.section.name } : null,
      enrolledCount: c._count.enrollments,
    }));
  }

  const studentCourses = (studentIds: string[]) =>
    prisma.course.findMany({
      where: { ...base, enrollments: { some: { studentId: { in: studentIds }, status: 'ACTIVE' } } },
      include: {
        subject: { select: { color: true } },
        teacher: { select: personSelect },
        enrollments: { where: { studentId: { in: studentIds }, status: 'ACTIVE' }, select: { studentId: true } },
      },
      orderBy: { code: 'asc' },
    });
  type StudentCourseRow = Awaited<ReturnType<typeof studentCourses>>[number];
  const card = (c: StudentCourseRow) => ({
    id: c.id,
    name: c.name,
    code: c.code,
    subjectColor: c.subject.color,
    teacher: person(c.teacher),
  });

  if (user.role === 'STUDENT') return (await studentCourses([user.id])).map(card);

  // PARENT: one query over all linked children, grouped by child.
  const links = await listLinksForParent(user.id);
  const childIds = links.map((l) => l.studentId);
  const courses = childIds.length ? await studentCourses(childIds) : [];
  return links.map((link) => ({
    child: { id: link.studentId, name: personName(link.student) },
    courses: courses.filter((c) => c.enrollments.some((e) => e.studentId === link.studentId)).map(card),
  }));
}

/** FR-21: this year's section + courses for a student (caller gates with assertCanViewStudent). */
export async function getStudentCourses(studentId: string) {
  const year = await getCurrentAcademicYear();
  if (!year) return { academicYear: null, section: null, courses: [] };

  const [membership, enrollments] = await Promise.all([
    prisma.sectionMember.findUnique({
      where: { studentId_academicYearId: { studentId, academicYearId: year.id } },
      include: { section: { select: { id: true, name: true, homeroomTeacher: { select: personSelect } } } },
    }),
    prisma.enrollment.findMany({
      where: { studentId, course: { academicYearId: year.id } },
      include: {
        course: {
          select: {
            id: true,
            name: true,
            code: true,
            kind: true,
            subject: { select: { color: true } },
            teacher: { select: personSelect },
          },
        },
      },
      orderBy: [{ status: 'asc' }, { course: { code: 'asc' } }],
    }),
  ]);

  return {
    academicYear: { id: year.id, name: year.name },
    section: membership
      ? {
          id: membership.section.id,
          name: membership.section.name,
          homeroomTeacher: membership.section.homeroomTeacher ? person(membership.section.homeroomTeacher) : null,
        }
      : null,
    courses: enrollments.map((e) => ({
      enrollmentId: e.id,
      courseId: e.course.id,
      name: e.course.name,
      code: e.course.code,
      kind: e.course.kind,
      subjectColor: e.course.subject.color,
      teacher: person(e.course.teacher),
      status: e.status,
      droppedAt: e.droppedAt,
    })),
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** FR-14 + FR-10: a new CORE course enrolls the section's current members in the same tx. */
export async function createCourse(input: CourseInput, actorId?: string | null) {
  const { course, enrollments } = await prisma
    .$transaction(async (tx) => {
      await assertTeachers(tx, [input.teacherId, ...input.coTeacherIds]);
      const subject = await tx.subject.findUnique({ where: { id: input.subjectId }, select: { archivedAt: true } });
      if (!subject || subject.archivedAt) throw new AppError('VALIDATION_ERROR', 'Subject must be an active subject.');
      if (input.sectionId) {
        const section = await tx.section.findUnique({ where: { id: input.sectionId }, select: { academicYearId: true } });
        if (!section) throw new AppError('NOT_FOUND', 'Section not found');
        if (section.academicYearId !== input.academicYearId) {
          throw new AppError('VALIDATION_ERROR', 'Section belongs to a different academic year.');
        }
      }

      const course = await tx.course.create({
        data: {
          academicYearId: input.academicYearId,
          subjectId: input.subjectId,
          sectionId: input.sectionId ?? null,
          teacherId: input.teacherId,
          coTeacherIds: input.coTeacherIds,
          name: input.name,
          code: input.code,
          kind: input.kind,
          capacity: input.capacity ?? null,
          description: input.description ?? null,
        },
        include: courseInclude,
      });

      let enrollments: EnrollResult | null = null;
      if (course.kind === 'CORE' && course.sectionId) {
        const members = await tx.sectionMember.findMany({ where: { sectionId: course.sectionId }, select: { studentId: true } });
        enrollments = await enrollStudentsInCourses(
          tx,
          [course.id],
          members.map((m) => m.studentId),
          { actorId },
        );
      }
      return { course, enrollments };
    })
    .catch((error) => codeConflict(error, input.code));

  await audit({ actorId, action: 'course.create', entityType: 'Course', entityId: course.id, metadata: { enrollments } });
  return (await toCourses([course]))[0];
}

/** FR-5: one CORE course per item, default name/code, every current member enrolled — one tx. */
export async function createCoreCourses(sectionId: string, input: CoreCoursesInput, actorId?: string | null) {
  const result = await prisma
    .$transaction(async (tx) => {
      const section = await tx.section.findUnique({
        where: { id: sectionId },
        include: { members: { select: { studentId: true } } },
      });
      if (!section) throw new AppError('NOT_FOUND', 'Section not found');

      const subjectIds = input.items.map((i) => i.subjectId);
      const subjects = await tx.subject.findMany({ where: { id: { in: subjectIds }, archivedAt: null } });
      if (subjects.length !== subjectIds.length) {
        throw new AppError('VALIDATION_ERROR', 'Every subject must be an active subject.');
      }
      await assertTeachers(
        tx,
        input.items.map((i) => i.teacherId),
      );
      const subjectById = new Map(subjects.map((s) => [s.id, s]));

      const created = await tx.course.createManyAndReturn({
        data: input.items.map((item) => {
          const subject = subjectById.get(item.subjectId)!;
          return {
            academicYearId: section.academicYearId,
            subjectId: subject.id,
            sectionId: section.id,
            teacherId: item.teacherId,
            name: defaultCourseName(subject.name, section.name),
            code: defaultCourseCode(subject.code, section.name),
            kind: 'CORE' as const,
          };
        }),
        select: { id: true },
      });
      const courseIds = created.map((c) => c.id);
      const enrollments = await enrollStudentsInCourses(
        tx,
        courseIds,
        section.members.map((m) => m.studentId),
        { actorId },
      );
      const rows = await tx.course.findMany({ where: { id: { in: courseIds } }, include: courseInclude, orderBy: { code: 'asc' } });
      return { rows, enrollmentsCreated: enrollments.enrolled + enrollments.reactivated };
    })
    .catch((error) => codeConflict(error));

  await audit({
    actorId,
    action: 'course.create',
    entityType: 'Course',
    metadata: { sectionId, courseIds: result.rows.map((r) => r.id), enrollmentsCreated: result.enrollmentsCreated },
  });
  return { courses: await toCourses(result.rows), enrollmentsCreated: result.enrollmentsCreated };
}

export async function updateCourse(id: string, input: CourseUpdateInput, actorId?: string | null) {
  const { archived, ...fields } = input;
  const course = await prisma
    .$transaction(async (tx) => {
      const existing = await tx.course.findUnique({ where: { id }, include: courseInclude });
      if (!existing) throw new AppError('NOT_FOUND', 'Course not found');
      await assertTeachers(tx, [...(fields.teacherId ? [fields.teacherId] : []), ...(fields.coTeacherIds ?? [])]);
      if (fields.capacity != null && fields.capacity < existing._count.enrollments) {
        throw new AppError(
          'VALIDATION_ERROR',
          `Capacity cannot be lower than the current enrolled count (${existing._count.enrollments}).`,
        );
      }
      return tx.course.update({
        where: { id },
        data: {
          subjectId: fields.subjectId,
          teacherId: fields.teacherId,
          coTeacherIds: fields.coTeacherIds,
          name: fields.name,
          code: fields.code,
          capacity: fields.capacity,
          description: fields.description,
          ...(archived === undefined ? {} : { archivedAt: archived ? (existing.archivedAt ?? new Date()) : null }),
        },
        include: courseInclude,
      });
    })
    .catch((error) => codeConflict(error, fields.code));

  const action = archived === true ? 'course.archive' : archived === false ? 'course.unarchive' : 'course.update';
  await audit({ actorId, action, entityType: 'Course', entityId: id, metadata: { fields: Object.keys(input) } });
  return (await toCourses([course]))[0];
}

/** FR-15: direct (elective) enrollment; CORE membership is owned by the section. */
export async function enrollStudentsInCourse(courseId: string, input: EnrollStudentsInput, actorId?: string | null) {
  const studentIds = [...new Set(input.studentIds)];
  return prisma.$transaction(async (tx) => {
    const course = await tx.course.findUnique({ where: { id: courseId }, include: { section: { select: { name: true } } } });
    if (!course) throw new AppError('NOT_FOUND', 'Course not found');
    if (course.kind === 'CORE') {
      throw new AppError('CONFLICT', `Core course enrollment is managed via section ${course.section?.name ?? '(none)'}.`);
    }
    await assertStudents(tx, studentIds);
    return enrollStudentsInCourses(tx, [courseId], studentIds, { overrideCapacity: input.overrideCapacity, actorId });
  });
}

/** FR-12/FR-15: drop keeps the row (history); reactivate re-checks capacity. */
export async function setEnrollmentStatus(id: string, input: EnrollmentStatusInput, actorId?: string | null) {
  const enrollment = await prisma.$transaction(async (tx) => {
    const existing = await tx.enrollment.findUnique({ where: { id } });
    if (!existing) throw new AppError('NOT_FOUND', 'Enrollment not found');
    if (existing.status === input.status) return null;
    if (input.status === 'ACTIVE') {
      await checkCapacityOrThrow(tx, { courseId: existing.courseId, addingCount: 1, overrideCapacity: input.overrideCapacity });
    }
    return tx.enrollment.update({
      where: { id },
      data: { status: input.status, droppedAt: input.status === 'DROPPED' ? new Date() : null },
    });
  });

  if (enrollment) {
    await audit({
      actorId,
      action: input.status === 'DROPPED' ? 'enrollment.drop' : 'enrollment.reactivate',
      entityType: 'Enrollment',
      entityId: id,
    });
  }
  const row = await prisma.enrollment.findUniqueOrThrow({
    where: { id },
    include: { student: { select: { ...personSelect, studentProfile: { select: { admissionNumber: true } } } } },
  });
  return {
    id: row.id,
    courseId: row.courseId,
    studentId: row.studentId,
    student: {
      id: row.student.id,
      name: personName(row.student),
      avatarUrl: null,
      admissionNumber: row.student.studentProfile?.admissionNumber ?? null,
    },
    status: row.status,
    enrolledAt: row.enrolledAt,
    droppedAt: row.droppedAt,
  };
}
