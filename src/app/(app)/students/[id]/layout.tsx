import { requirePageUser } from '@/server/auth/requireRole';
import { assertCanViewStudent } from '@/server/auth/student-access';
import { prisma } from '@/server/db';
import { messageableIds } from '@/server/messaging/contact-rules';
import { StudentMessageActions, type StudentMessageActionsProps } from '@/components/messaging/StudentMessageActions';

/**
 * PRD-13 FR-16: a compact action row above every student tab. The [id] segment name is kept.
 * Pages still do their own access checks; this layout renders nothing extra unless the viewer can
 * see the student and has someone to message.
 */
export default async function StudentLayout({ children, params }: { children: React.ReactNode; params: { id: string } }) {
  const user = await requirePageUser();
  const actions = await resolveActions(user, params.id).catch(() => null);
  return (
    <>
      {actions && <StudentMessageActions {...actions} />}
      {children}
    </>
  );
}

async function resolveActions(user: Awaited<ReturnType<typeof requirePageUser>>, studentId: string): Promise<StudentMessageActionsProps | null> {
  if (user.role === 'STUDENT') return null;
  await assertCanViewStudent(user, studentId);
  const student = await prisma.user.findUnique({
    where: { id: studentId },
    select: {
      role: true,
      firstName: true,
      lastName: true,
      studentLinks: { select: { parent: { select: { id: true, firstName: true, lastName: true } } } },
    },
  });
  if (!student || student.role !== 'STUDENT') return null;

  if (user.role === 'PARENT') {
    return student.studentLinks.some((l) => l.parent.id === user.id) ? { mode: 'teacher', childFirstName: student.firstName } : null;
  }
  const reachable = new Set(await messageableIds(user, student.studentLinks.map((l) => l.parent.id)));
  const parents = student.studentLinks
    .filter((l) => reachable.has(l.parent.id))
    .map((l) => ({ id: l.parent.id, name: `${l.parent.firstName} ${l.parent.lastName}`, role: 'PARENT' as const, avatarUrl: null }));
  return parents.length ? { mode: 'parents', studentName: `${student.firstName} ${student.lastName}`, parents } : null;
}
