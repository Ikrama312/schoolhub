import Link from 'next/link';
import { notFound } from 'next/navigation';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import { prisma } from '@/server/db';
import { requirePageRole } from '@/server/auth/requireRole';
import { assertCanViewStudent } from '@/server/auth/student-access';
import { list } from '@/server/absence-notes/absence-notes-service';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { ABSENCE_REASON_LABELS } from '@/lib/validators/absence-notes';

const STATUS_COLOR = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'error' } as const;

/** /my-children/[studentId]/absence — the parent's notes with status (FR-20). */
export default async function AbsenceNotesListPage({ params }: { params: { studentId: string } }) {
  const user = await requirePageRole('PARENT');
  await assertCanViewStudent(user, params.studentId).catch(() => notFound());
  const [student, { rows }] = await Promise.all([
    prisma.user.findUnique({ where: { id: params.studentId }, select: { firstName: true, lastName: true } }),
    // ponytail: first 100 notes, newest first; add paging if a family ever exceeds that.
    list(user, { studentId: params.studentId, sort: { field: 'createdAt', dir: 'desc' } }, { page: 1, pageSize: 100, skip: 0, take: 100 }),
  ]);
  if (!student) notFound();
  const newHref = `/my-children/${params.studentId}/absence/new`;
  return (
    <>
      <PageHeader
        title={`Absence notes — ${student.firstName}`}
        breadcrumbs={[{ label: 'My children', href: '/my-children' }, { label: `${student.firstName} ${student.lastName}`, href: `/my-children/${params.studentId}` }, { label: 'Absence notes' }]}
        actions={
          <Button variant="contained" component={Link} href={newHref}>
            Report an absence
          </Button>
        }
      />
      {rows.length === 0 ? (
        <EmptyState title="No absence notes yet" description="Notes you send to the school appear here with their status." />
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table aria-label="Absence notes">
            <TableHead>
              <TableRow>
                <TableCell>Dates</TableCell>
                <TableCell>Periods</TableCell>
                <TableCell>Reason</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>School&apos;s note</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((n) => (
                <TableRow key={n.id}>
                  <TableCell>{n.fromDate === n.toDate ? n.fromDate : `${n.fromDate} – ${n.toDate}`}</TableCell>
                  <TableCell>{n.partialDay ? n.periods.map((p) => p.name).join(', ') : 'Whole day'}</TableCell>
                  <TableCell>{ABSENCE_REASON_LABELS[n.reason]}</TableCell>
                  <TableCell>
                    <Chip size="small" color={STATUS_COLOR[n.status]} label={n.status.charAt(0) + n.status.slice(1).toLowerCase()} />
                  </TableCell>
                  <TableCell>{n.reviewNote ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </>
  );
}
