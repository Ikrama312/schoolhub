import { notFound, redirect } from 'next/navigation';
import { requirePageRole } from '@/server/auth/requireRole';
import { AppError } from '@/server/http';
import { getCourseMatrix } from '@/server/attendance/attendance-service';
import { CourseAttendanceMatrix } from './CourseAttendanceMatrix';

export const dynamic = 'force-dynamic';

/** Course "Attendance" tab — FR-29. TEACHER/ADMIN; assertCanManageCourse inside the service. */
export default async function CourseAttendancePage({ params }: { params: { courseId: string } }) {
  const user = await requirePageRole('TEACHER', 'ADMIN');
  let matrix: Awaited<ReturnType<typeof getCourseMatrix>>;
  try {
    matrix = await getCourseMatrix(user, params.courseId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    if (error instanceof AppError && error.code === 'FORBIDDEN') redirect('/forbidden');
    throw error;
  }
  return <CourseAttendanceMatrix courseId={params.courseId} matrix={matrix} />;
}
