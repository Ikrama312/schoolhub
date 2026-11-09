import { notFound, redirect } from 'next/navigation';
import Box from '@mui/material/Box';
import { requirePageRole } from '@/server/auth/requireRole';
import { AppError } from '@/server/http';
import { prisma } from '@/server/db';
import { getStudentAttendance } from '@/server/attendance/attendance-service';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { ALL_ROLES } from '@/config/navigation';
import { StudentAttendanceClient } from './StudentAttendanceClient';

export const dynamic = 'force-dynamic';

/** Student "Attendance" tab — FR-24 to FR-28. Access is assertCanViewStudent inside the service. */
export default async function StudentAttendancePage({ params }: { params: { id: string } }) {
  const user = await requirePageRole(...ALL_ROLES);
  let data: Awaited<ReturnType<typeof getStudentAttendance>>;
  try {
    data = await getStudentAttendance(user, params.id, {});
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    if (error instanceof AppError && error.code === 'FORBIDDEN') redirect('/forbidden');
    throw error;
  }
  const student = await prisma.user.findUnique({ where: { id: params.id }, select: { firstName: true, lastName: true } });
  if (!student) notFound();

  return (
    <Box>
      <PageHeader title="Attendance" description={`${student.firstName} ${student.lastName}`} />
      <StudentAttendanceClient studentId={params.id} initial={data} />
    </Box>
  );
}
