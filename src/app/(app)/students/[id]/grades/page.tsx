import { notFound, redirect } from 'next/navigation';
import { requirePageUser } from '@/server/auth/requireRole';
import { AppError } from '@/server/http';
import { getStudentGrades, type StudentGrades } from '@/server/gradebook/student-grades-service';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { StudentGradesView } from '@/components/gradebook/StudentGradesView';

export const dynamic = 'force-dynamic';

/** Student "Grades" tab — PRD-11 FR-26. assertCanViewStudent runs inside the service. */
export default async function StudentGradesPage({ params }: { params: { id: string } }) {
  const user = await requirePageUser();
  let data: StudentGrades;
  try {
    data = await getStudentGrades(user, params.id);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    if (error instanceof AppError && error.code === 'FORBIDDEN') redirect('/forbidden');
    throw error;
  }
  return (
    <>
      <PageHeader title="Grades" description={`${data.student.firstName} ${data.student.lastName}`} />
      <StudentGradesView initial={data} />
    </>
  );
}
