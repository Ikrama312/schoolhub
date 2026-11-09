import Link from 'next/link';
import { notFound } from 'next/navigation';
import Chip from '@mui/material/Chip';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import { requirePageRole } from '@/server/auth/requireRole';
import { getCourseRoster, type RosterEntry } from '@/server/courses/courses-service';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { ALL_ROLES } from '@/config/navigation';

export const dynamic = 'force-dynamic';

/** Roster tab — FR-17 / NFR-4: same getCourseRoster as the API; PARENT has no roster. */
export default async function CourseRosterPage({ params }: { params: { courseId: string } }) {
  const user = await requirePageRole(...ALL_ROLES);
  if (user.role === 'PARENT') notFound();
  const { rows } = await getCourseRoster(params.courseId, user.role);

  if (rows.length === 0) return <EmptyState title="No students enrolled" />;

  if (user.role === 'STUDENT') {
    return (
      <Paper variant="outlined">
        <List dense aria-label="Classmates">
          {(rows as { name: string }[]).map((r, i) => (
            <ListItem key={i}>
              <ListItemText primary={r.name} />
            </ListItem>
          ))}
        </List>
      </Paper>
    );
  }

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small" aria-label="Course roster">
        <TableHead>
          <TableRow>
            <TableCell>Student</TableCell>
            <TableCell>Admission no.</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Enrolled</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {(rows as RosterEntry[]).map((r) => (
            <TableRow key={r.enrollmentId}>
              <TableCell>
                <Link href={r.student.profileUrl}>{r.student.name}</Link>
              </TableCell>
              <TableCell>{r.student.admissionNumber ?? '—'}</TableCell>
              <TableCell>
                <Chip size="small" color={r.status === 'ACTIVE' ? 'success' : 'default'} label={r.status} />
              </TableCell>
              <TableCell>{r.enrolledAt.toLocaleDateString()}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
