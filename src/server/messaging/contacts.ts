import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { canMessageWith, loadRelations, type Party } from './contact-rules';
import { toUserSummary, userSummarySelect, type UserSummary } from './messages';

/**
 * PRD-13 FR-8: labelled recipient groups for the new-conversation picker. Candidates are found
 * forward from the same relations contact-rules uses, then every one is re-checked through
 * canMessageWith, so the picker can never offer someone the API would refuse.
 */

const CAP = 50;
type Row = { id: string; firstName: string; lastName: string; role: Party['role'] };
type Group = { label: string; users: Row[] };

const active: Prisma.UserWhereInput = { status: 'ACTIVE', archivedAt: null };
const managed = (teacherId: string): Prisma.CourseWhereInput => ({
  archivedAt: null,
  OR: [{ teacherId }, { coTeacherIds: { has: teacherId } }],
});

/** Teachers (course teacher, co-teachers, current homeroom) of one student. */
async function teachersOf(studentId: string): Promise<Row[]> {
  const [courses, homerooms] = await Promise.all([
    prisma.course.findMany({
      where: { archivedAt: null, enrollments: { some: { studentId, status: 'ACTIVE' } } },
      select: { teacherId: true, coTeacherIds: true },
    }),
    prisma.sectionMember.findMany({
      where: { studentId, section: { academicYear: { isCurrent: true }, homeroomTeacherId: { not: null } } },
      select: { section: { select: { homeroomTeacherId: true } } },
    }),
  ]);
  const ids = [...courses.flatMap((c) => [c.teacherId, ...c.coTeacherIds]), ...homerooms.map((h) => h.section.homeroomTeacherId!)];
  return prisma.user.findMany({ where: { id: { in: [...new Set(ids)] }, role: 'TEACHER', ...active }, select: userSummarySelect });
}

const parentsOf = (studentIds: string[]) =>
  prisma.user.findMany({ where: { role: 'PARENT', ...active, parentLinks: { some: { studentId: { in: studentIds } } } }, select: userSummarySelect });

async function candidateGroups(user: Party, nameWhere: Prisma.UserWhereInput): Promise<Group[]> {
  const groups: Group[] = [];
  const office = () =>
    prisma.user.findMany({ where: { role: 'ADMIN', ...active, id: { not: user.id }, ...nameWhere }, select: userSummarySelect, take: CAP });

  if (user.role === 'STUDENT') {
    groups.push({ label: 'My teachers', users: await teachersOf(user.id) });
  } else if (user.role === 'PARENT') {
    const kids = await prisma.parentStudentLink.findMany({
      where: { parentId: user.id },
      select: { student: { select: { id: true, firstName: true } } },
      orderBy: { student: { firstName: 'asc' } },
    });
    for (const k of kids) groups.push({ label: `My child's teachers (${k.student.firstName})`, users: await teachersOf(k.student.id) });
  } else if (user.role === 'TEACHER') {
    const [courses, homerooms] = await Promise.all([
      prisma.course.findMany({
        where: managed(user.id),
        orderBy: { code: 'asc' },
        select: { code: true, enrollments: { where: { status: 'ACTIVE' }, select: { student: { select: userSummarySelect } } } },
      }),
      prisma.section.findMany({
        where: { homeroomTeacherId: user.id, academicYear: { isCurrent: true } },
        select: { name: true, members: { select: { student: { select: userSummarySelect } } } },
      }),
    ]);
    for (const c of courses) {
      const students = c.enrollments.map((e) => e.student);
      groups.push({ label: `Students in ${c.code}`, users: students });
      groups.push({ label: `Parents of students in ${c.code}`, users: await parentsOf(students.map((s) => s.id)) });
    }
    for (const s of homerooms) {
      const students = s.members.map((m) => m.student);
      groups.push({ label: `Homeroom ${s.name}`, users: [...students, ...(await parentsOf(students.map((x) => x.id)))] });
    }
    groups.push({
      label: 'Staff',
      users: await prisma.user.findMany({ where: { role: 'TEACHER', ...active, id: { not: user.id }, ...nameWhere }, select: userSummarySelect, take: CAP }),
    });
  } else if (user.role === 'ADMIN') {
    // ADMIN may message anyone (FR-5): search-driven groups, capped.
    const byRole = (role: Party['role']) =>
      prisma.user.findMany({ where: { role, ...active, ...nameWhere }, select: userSummarySelect, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }], take: CAP });
    groups.push({ label: 'Staff', users: await byRole('TEACHER') });
    groups.push({ label: 'Students', users: await byRole('STUDENT') });
    groups.push({ label: 'Parents', users: await byRole('PARENT') });
  }
  groups.push({ label: 'School office', users: await office() });
  return groups;
}

export async function listContacts(user: Party, q?: string): Promise<{ groups: { label: string; contacts: UserSummary[] }[] }> {
  const term = q?.trim().toLowerCase() ?? '';
  // DB pre-filter on the first word (so "Tom Te" still narrows); the full-name match runs below.
  const word = term.split(/\s+/)[0];
  const nameWhere: Prisma.UserWhereInput = word
    ? { OR: [{ firstName: { contains: word, mode: 'insensitive' } }, { lastName: { contains: word, mode: 'insensitive' } }] }
    : {};
  const groups = await candidateGroups(user, nameWhere);
  const rel = await loadRelations([user.id, ...groups.flatMap((g) => g.users.map((u) => u.id))]);

  return {
    groups: groups
      .map((g) => {
        const seen = new Set<string>();
        const contacts = g.users
          .filter((u) => {
            if (seen.has(u.id)) return false;
            seen.add(u.id);
            const r = rel.users.get(u.id);
            return !!r && canMessageWith(user, r, rel) && (!term || `${u.firstName} ${u.lastName}`.toLowerCase().includes(term));
          })
          .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName))
          .slice(0, CAP)
          .map(toUserSummary);
        return { label: g.label, contacts };
      })
      .filter((g) => g.contacts.length > 0),
  };
}
