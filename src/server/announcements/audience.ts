import type { AudienceType, Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import { assertCanManageCourse } from '@/server/auth/course-access';
import type { AccessUser } from '@/server/auth/student-access';

/**
 * Audience resolver (PRD-12 FR-2 semantics), introduced by PRD-14 at the path PRD-12
 * names so PRD-12 adopts it unchanged (ADR-9). One rule set, two directions:
 * - resolveAudienceUserIds: audience → user ids (notifications)
 * - audienceWhereForUser / isUserInAudience: user → "which audiences include me"
 * Both are built from the same membership definitions; the parity integration test
 * checks they agree for every seed user (R4).
 *
 * | type        | students                     | parents           | teachers                                        |
 * | SCHOOL      | every active user                                                                     |
 * | STAFF       | ADMIN + TEACHER                                                                       |
 * | ROLE        | users with role = refId                                                               |
 * | GRADE_LEVEL | StudentProfile.gradeLevelId  | their parents     | teachers of current-year courses in that grade  |
 * | SECTION     | current-year SectionMembers  | their parents     | homeroom + teachers of courses in the section   |
 * | COURSE      | ACTIVE enrollments           | their parents     | teacherId + coTeacherIds                        |
 */

export interface AudienceRow {
  type: AudienceType;
  refId: string | null;
  includeStudents: boolean;
  includeParents: boolean;
  includeTeachers: boolean;
}

type Flag = 'includeStudents' | 'includeParents' | 'includeTeachers';
type Clause = { type: AudienceType; refIds?: string[]; flag?: Flag };

const activeUser = { status: 'ACTIVE', archivedAt: null } satisfies Prisma.UserWhereInput;
const currentYear = { academicYear: { isCurrent: true } };
const teachesCourse = (userId: string): Prisma.CourseWhereInput => ({ OR: [{ teacherId: userId }, { coTeacherIds: { has: userId } }] });

/** Group keys of the given students: grade levels, current-year sections, ACTIVE-enrolled courses. */
async function studentKeys(studentIds: string[]) {
  if (studentIds.length === 0) return { grades: [], sections: [], courses: [] };
  const [profiles, members, enrollments] = await Promise.all([
    prisma.studentProfile.findMany({ where: { userId: { in: studentIds } }, select: { gradeLevelId: true } }),
    prisma.sectionMember.findMany({ where: { studentId: { in: studentIds }, section: currentYear }, select: { sectionId: true } }),
    prisma.enrollment.findMany({ where: { studentId: { in: studentIds }, status: 'ACTIVE' }, select: { courseId: true } }),
  ]);
  const uniq = (xs: string[]) => [...new Set(xs)];
  return {
    grades: uniq(profiles.map((p) => p.gradeLevelId)),
    sections: uniq(members.map((m) => m.sectionId)),
    courses: uniq(enrollments.map((e) => e.courseId)),
  };
}

/**
 * The audience clauses that include `user`, computed once per request (NFR-4).
 * opts.studentIds narrows a PARENT to some linked children (the calendar child filter).
 */
export async function audienceClausesForUser(user: AccessUser, opts: { studentIds?: string[] } = {}): Promise<Clause[]> {
  const clauses: Clause[] = [{ type: 'SCHOOL' }, { type: 'ROLE', refIds: [user.role] }];
  const groups = (k: { grades: string[]; sections: string[]; courses: string[] }, flag: Flag) => {
    if (k.grades.length) clauses.push({ type: 'GRADE_LEVEL', refIds: k.grades, flag });
    if (k.sections.length) clauses.push({ type: 'SECTION', refIds: k.sections, flag });
    if (k.courses.length) clauses.push({ type: 'COURSE', refIds: k.courses, flag });
  };

  switch (user.role) {
    case 'ADMIN':
      clauses.push({ type: 'STAFF' });
      break;
    case 'TEACHER': {
      clauses.push({ type: 'STAFF' });
      const [courses, homerooms] = await Promise.all([
        prisma.course.findMany({
          where: { ...teachesCourse(user.id), archivedAt: null },
          select: { id: true, sectionId: true, academicYear: { select: { isCurrent: true } }, section: { select: { gradeLevelId: true } } },
        }),
        prisma.section.findMany({ where: { homeroomTeacherId: user.id }, select: { id: true } }),
      ]);
      const current = courses.filter((c) => c.academicYear.isCurrent);
      groups(
        {
          courses: courses.map((c) => c.id),
          sections: [...new Set([...homerooms.map((s) => s.id), ...courses.flatMap((c) => (c.sectionId ? [c.sectionId] : []))])],
          grades: [...new Set(current.flatMap((c) => (c.section ? [c.section.gradeLevelId] : [])))],
        },
        'includeTeachers',
      );
      break;
    }
    case 'STUDENT':
      groups(await studentKeys([user.id]), 'includeStudents');
      break;
    case 'PARENT': {
      const links = await prisma.parentStudentLink.findMany({ where: { parentId: user.id }, select: { studentId: true } });
      const children = links.map((l) => l.studentId).filter((id) => !opts.studentIds || opts.studentIds.includes(id));
      groups(await studentKeys(children), 'includeParents');
      break;
    }
  }
  return clauses;
}

function clauseWhere(c: Clause): Prisma.EventAudienceWhereInput {
  return {
    type: c.type,
    ...(c.refIds ? { refId: { in: c.refIds } } : {}),
    ...(c.flag ? { [c.flag]: true } : {}),
  };
}

/** Prisma EventAudience filter matching every audience that includes `user` (filtering in SQL, NFR-4). */
export async function audienceWhereForUser(user: AccessUser, opts: { studentIds?: string[] } = {}): Promise<Prisma.EventAudienceWhereInput> {
  return { OR: (await audienceClausesForUser(user, opts)).map(clauseWhere) };
}

export function audienceMatchesClauses(audience: AudienceRow, clauses: Clause[]): boolean {
  return clauses.some(
    (c) =>
      c.type === audience.type &&
      (!c.refIds || (audience.refId !== null && c.refIds.includes(audience.refId))) &&
      (!c.flag || audience[c.flag]),
  );
}

export async function isUserInAudience(user: AccessUser, audiences: AudienceRow[]): Promise<boolean> {
  if (audiences.length === 0) return false;
  const clauses = await audienceClausesForUser(user);
  return audiences.some((a) => audienceMatchesClauses(a, clauses));
}

async function parentsOf(studentIds: string[]): Promise<string[]> {
  if (!studentIds.length) return [];
  const links = await prisma.parentStudentLink.findMany({ where: { studentId: { in: studentIds } }, select: { parentId: true } });
  return links.map((l) => l.parentId);
}

async function resolveOne(a: AudienceRow): Promise<string[]> {
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
  switch (a.type) {
    case 'SCHOOL':
      return ids(await prisma.user.findMany({ where: activeUser, select: { id: true } }));
    case 'STAFF':
      return ids(await prisma.user.findMany({ where: { ...activeUser, role: { in: ['ADMIN', 'TEACHER'] } }, select: { id: true } }));
    case 'ROLE':
      if (!a.refId || !['ADMIN', 'TEACHER', 'STUDENT', 'PARENT'].includes(a.refId)) return [];
      return ids(await prisma.user.findMany({ where: { ...activeUser, role: a.refId as AccessUser['role'] }, select: { id: true } }));
    default:
      break;
  }
  if (!a.refId) return [];

  let students: string[] = [];
  let teachers: string[] = [];
  const courseTeachers = (courses: { teacherId: string; coTeacherIds: string[] }[]) => courses.flatMap((c) => [c.teacherId, ...c.coTeacherIds]);

  if (a.type === 'GRADE_LEVEL') {
    const [profiles, courses] = await Promise.all([
      a.includeStudents || a.includeParents
        ? prisma.studentProfile.findMany({ where: { gradeLevelId: a.refId }, select: { userId: true } })
        : Promise.resolve([]),
      a.includeTeachers
        ? prisma.course.findMany({ where: { ...currentYear, archivedAt: null, section: { gradeLevelId: a.refId } }, select: { teacherId: true, coTeacherIds: true } })
        : Promise.resolve([]),
    ]);
    students = profiles.map((p) => p.userId);
    teachers = courseTeachers(courses);
  } else if (a.type === 'SECTION') {
    const [members, section, courses] = await Promise.all([
      prisma.sectionMember.findMany({ where: { sectionId: a.refId, section: currentYear }, select: { studentId: true } }),
      prisma.section.findUnique({ where: { id: a.refId }, select: { homeroomTeacherId: true } }),
      prisma.course.findMany({ where: { sectionId: a.refId, archivedAt: null }, select: { teacherId: true, coTeacherIds: true } }),
    ]);
    students = members.map((m) => m.studentId);
    teachers = [...(section?.homeroomTeacherId ? [section.homeroomTeacherId] : []), ...courseTeachers(courses)];
  } else if (a.type === 'COURSE') {
    const [enrollments, course] = await Promise.all([
      prisma.enrollment.findMany({ where: { courseId: a.refId, status: 'ACTIVE' }, select: { studentId: true } }),
      prisma.course.findFirst({ where: { id: a.refId, archivedAt: null }, select: { teacherId: true, coTeacherIds: true } }),
    ]);
    students = enrollments.map((e) => e.studentId);
    teachers = course ? courseTeachers([course]) : [];
  }

  return [
    ...(a.includeStudents ? students : []),
    ...(a.includeParents ? await parentsOf(students) : []),
    ...(a.includeTeachers ? teachers : []),
  ];
}

/** Every ACTIVE, non-archived user in any of the audiences, deduped. */
export async function resolveAudienceUserIds(audiences: AudienceRow[]): Promise<string[]> {
  const all = new Set((await Promise.all(audiences.map(resolveOne))).flat());
  if (all.size === 0) return [];
  const active = await prisma.user.findMany({ where: { id: { in: [...all] }, ...activeUser }, select: { id: true } });
  return active.map((u) => u.id);
}

/**
 * FR-7: ADMIN → any audience. TEACHER → a COURSE they manage (assertCanManageCourse)
 * or a SECTION they are homeroom teacher of. Everyone else → false.
 */
export async function canTargetAudience(user: AccessUser, audience: Pick<AudienceRow, 'type' | 'refId'>): Promise<boolean> {
  if (user.role === 'ADMIN') return true;
  if (user.role !== 'TEACHER' || !audience.refId) return false;
  if (audience.type === 'COURSE') {
    try {
      await assertCanManageCourse(user, audience.refId);
      return true;
    } catch (error) {
      if (error instanceof AppError) return false;
      throw error;
    }
  }
  if (audience.type === 'SECTION') {
    const section = await prisma.section.findUnique({ where: { id: audience.refId }, select: { homeroomTeacherId: true } });
    return section?.homeroomTeacherId === user.id;
  }
  return false;
}
