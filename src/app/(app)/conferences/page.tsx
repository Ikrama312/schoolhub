import Link from 'next/link';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import { requirePageRole } from '@/server/auth/requireRole';
import { listEvents } from '@/server/conferences/conferences-service';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { EmptyState } from '@/components/EmptyState/EmptyState';

/** /conferences — events visible to the caller, with role-specific actions (FR-42). */
export default async function ConferencesPage() {
  const user = await requirePageRole('ADMIN', 'TEACHER', 'PARENT');
  // ponytail: first 100 events, newest first; conference days are a handful per year.
  const { rows } = await listEvents(user, { sort: { field: 'date', dir: 'desc' }, upcoming: false }, { page: 1, pageSize: 100, skip: 0, take: 100 });
  return (
    <>
      <PageHeader
        title="Parent–teacher conferences"
        actions={
          user.role === 'ADMIN' ? (
            <Button variant="contained" component={Link} href="/admin/conferences">
              Manage events
            </Button>
          ) : undefined
        }
      />
      {rows.length === 0 ? (
        <EmptyState title="No conferences scheduled" description="Conference days appear here once the school schedules them." />
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table aria-label="Conference events">
            <TableHead>
              <TableRow>
                <TableCell>Event</TableCell>
                <TableCell>Date</TableCell>
                <TableCell>Booking</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{e.title}</TableCell>
                  <TableCell>{e.date}</TableCell>
                  <TableCell>
                    <Chip size="small" color={e.bookingOpen ? 'success' : 'default'} label={e.bookingOpen ? 'Open' : 'Closed'} />
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                      {user.role === 'PARENT' && (
                        <Button size="small" variant="outlined" component={Link} href={`/conferences/${e.id}`}>
                          {e.bookingOpen ? 'Book' : 'View'}
                        </Button>
                      )}
                      {user.role === 'TEACHER' && (
                        <Button size="small" variant="outlined" component={Link} href={`/conferences/${e.id}/availability`}>
                          Availability
                        </Button>
                      )}
                      {user.role !== 'PARENT' && (
                        <Button size="small" component={Link} href={`/conferences/${e.id}/day`}>
                          Day view
                        </Button>
                      )}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </>
  );
}
