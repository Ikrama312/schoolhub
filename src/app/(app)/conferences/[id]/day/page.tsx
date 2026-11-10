import { notFound } from 'next/navigation';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { prisma } from '@/server/db';
import { requirePageRole } from '@/server/auth/requireRole';
import { getEvent, teacherDay } from '@/server/conferences/conferences-service';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { PrintButton } from '@/components/report-cards/PrintButton';
import { formatInSchoolTz } from '@/lib/dates';

/** /conferences/[id]/day — printable list of booked slots (FR-34). TEACHER: own; ADMIN: everyone's. */
export default async function ConferenceDayPage({ params }: { params: { id: string } }) {
  const user = await requirePageRole('TEACHER', 'ADMIN');
  const event = await getEvent(user, params.id).catch(() => notFound());
  const [slots, settings] = await Promise.all([
    teacherDay(user, params.id),
    prisma.schoolSettings.findUnique({ where: { id: 'singleton' }, select: { timezone: true } }),
  ]);
  const tz = settings?.timezone ?? 'UTC';
  const hm = (iso: string) => formatInSchoolTz(iso, 'HH:mm', tz);
  return (
    <Box sx={{ '@media print': { '& .no-print': { display: 'none' }, '& .MuiPaper-root': { boxShadow: 'none', border: 0 } } }}>
      <Box className="no-print">
        <PageHeader title={`Bookings — ${event.title}`} breadcrumbs={[{ label: 'Conferences', href: '/conferences' }, { label: event.title }, { label: 'Day view' }]} actions={<PrintButton />} />
      </Box>
      <Typography variant="h6" sx={{ display: 'none', '@media print': { display: 'block', mb: 2 } }}>
        {event.title} — {event.date}
      </Typography>
      {slots.length === 0 ? (
        <Typography color="text.secondary">No bookings yet.</Typography>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small" aria-label="Booked conference slots">
            <TableHead>
              <TableRow>
                <TableCell>Time</TableCell>
                {user.role === 'ADMIN' && <TableCell>Teacher</TableCell>}
                <TableCell>Student</TableCell>
                <TableCell>Parent</TableCell>
                <TableCell>Location</TableCell>
                <TableCell>Note</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {slots.map((s) => (
                <TableRow key={s.id} sx={{ breakInside: 'avoid' }}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {hm(s.startsAt)}–{hm(s.endsAt)}
                  </TableCell>
                  {user.role === 'ADMIN' && <TableCell>{s.teacher.name}</TableCell>}
                  <TableCell>{s.booking ? `${s.booking.student.firstName} ${s.booking.student.lastName}` : ''}</TableCell>
                  <TableCell>{s.booking?.parent.name ?? ''}</TableCell>
                  <TableCell>{s.location ?? ''}</TableCell>
                  <TableCell>{s.booking?.parentNote ?? ''}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
