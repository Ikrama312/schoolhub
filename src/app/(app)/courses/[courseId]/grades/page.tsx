import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/server/db';
import { requirePageRole } from '@/server/auth/requireRole';
import { AppError } from '@/server/http';
import { getStudentGrades, type StudentGrades } from '@/server/gradebook/student-grades-service';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { StudentGradesView } from '@/components/gradebook/StudentGradesView';
import { GradesClient } from '../../../grades/GradesClient';

export const dynamic = 'force-dynamic';

/** Course "Grades" tab — PRD-11 FR-28: this course's items only. The course layout gates view access. */
export default async function CourseGradesPage({ params, searchParams }: { params: { courseId: string }; searchParams: { studentId?: string } }) {
  const user = await requirePageRole('STUDENT', 'PARENT');
  const children =
    user.role === 'PARENT'
      ? await prisma.user.findMany({
          where: { studentLinks: { some: { parentId: user.id } }, enrollments: { some: { courseId: params.courseId, status: 'ACTIVE' } } },
          select: { id: true, firstName: true, lastName: true },
          orderBy: { firstName: 'asc' },
        })
      : [];
  if (user.role === 'PARENT' && !children.length) return <EmptyState title="No linked students in this course" />;
  const studentId = user.role === 'STUDENT' ? user.id : children.find((c) => c.id === searchParams.studentId)?.id ?? children[0].id;
  let data: StudentGrades;
  try {
    data = await getStudentGrades(user, studentId, undefined, params.courseId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    if (error instanceof AppError && error.code === 'FORBIDDEN') redirect('/forbidden');
    throw error;
  }
  const initial = JSON.parse(JSON.stringify(data));
  if (user.role === 'PARENT') return <GradesClient key={studentId} initial={initial} courseId={params.courseId} linkedChildren={children.map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}` }))} />;
  return <StudentGradesView initial={initial} courseId={params.courseId} />;
}
