import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/server/db';
import { requirePageRole } from '@/server/auth/requireRole';
import { AppError } from '@/server/http';
import { getAccessibleStudentIds } from '@/server/auth/student-access';
import { getStudentGrades, type StudentGrades } from '@/server/gradebook/student-grades-service';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { GradesClient } from './GradesClient';

export const dynamic = 'force-dynamic';

/** /grades — PRD-11 FR-27. STUDENT sees self; PARENT picks a linked child. */
export default async function GradesPage({ searchParams }: { searchParams: { studentId?: string } }) {
  const user = await requirePageRole('STUDENT', 'PARENT');
  const accessible = await getAccessibleStudentIds(user);
  const ids = accessible === 'ALL' ? [] : accessible;
  const children = await prisma.user.findMany({
    where: { id: { in: ids }, role: 'STUDENT' },
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
  });
  if (!children.length) {
    return (
      <>
        <PageHeader title="Grades" />
        <EmptyState title="No linked students" description="Ask the school office to link your account to your child." />
      </>
    );
  }
  const studentId = searchParams.studentId && children.some((c) => c.id === searchParams.studentId) ? searchParams.studentId : children[0].id;
  let data: StudentGrades;
  try {
    data = await getStudentGrades(user, studentId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    if (error instanceof AppError && error.code === 'FORBIDDEN') redirect('/forbidden');
    throw error;
  }
  return (
    <>
      <PageHeader title="Grades" description={user.role === 'PARENT' ? undefined : 'Your current standing in each course.'} />
      <GradesClient
        key={studentId}
        initial={JSON.parse(JSON.stringify(data))}
        linkedChildren={user.role === 'PARENT' ? children.map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}` })) : []}
      />
    </>
  );
}
