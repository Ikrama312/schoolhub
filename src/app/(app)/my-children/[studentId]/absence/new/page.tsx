import { notFound } from 'next/navigation';
import { prisma } from '@/server/db';
import { requirePageRole } from '@/server/auth/requireRole';
import { assertCanViewStudent } from '@/server/auth/student-access';
import { schoolToday } from '@/server/attendance/attendance-rules';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { AbsenceNoteForm } from './AbsenceNoteForm';

/** /my-children/[studentId]/absence/new — parent reports an absence (FR-18). */
export default async function NewAbsenceNotePage({ params }: { params: { studentId: string } }) {
  const user = await requirePageRole('PARENT');
  await assertCanViewStudent(user, params.studentId).catch(() => notFound());
  const [student, periods, settings] = await Promise.all([
    prisma.user.findUnique({ where: { id: params.studentId }, select: { firstName: true, lastName: true } }),
    prisma.period.findMany({ where: { kind: 'CLASS' }, orderBy: { order: 'asc' }, select: { id: true, name: true, startTime: true, endTime: true } }),
    prisma.schoolSettings.findUnique({ where: { id: 'singleton' }, select: { timezone: true } }),
  ]);
  if (!student) notFound();
  const name = `${student.firstName} ${student.lastName}`;
  return (
    <>
      <PageHeader
        title="Report an absence"
        description={`Let the school know ${student.firstName} will be or was absent.`}
        breadcrumbs={[
          { label: 'My children', href: '/my-children' },
          { label: name, href: `/my-children/${params.studentId}` },
          { label: 'Absence notes', href: `/my-children/${params.studentId}/absence` },
          { label: 'New' },
        ]}
      />
      <AbsenceNoteForm studentId={params.studentId} periods={periods} today={schoolToday(new Date(), settings?.timezone ?? 'UTC')} />
    </>
  );
}
