import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { requirePageRole } from '@/server/auth/requireRole';
import { assertCanViewStudent } from '@/server/auth/student-access';
import { AppError } from '@/server/http';
import { getStudentCourses } from '@/server/courses/courses-service';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { ALL_ROLES } from '@/config/navigation';

export const dynamic = 'force-dynamic';

/** Student "Courses" tab — PRD-05 FR-21/FR-22. */
export default async function StudentCoursesPage({ params }: { params: { id: string } }) {
  const user = await requirePageRole(...ALL_ROLES);
  try {
    await assertCanViewStudent(user, params.id);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    if (error instanceof AppError && error.code === 'FORBIDDEN') redirect('/forbidden');
    throw error;
  }
  const { academicYear, section, courses } = await getStudentCourses(params.id);

  return (
    <Box>
      <PageHeader title="Courses" description={academicYear ? academicYear.name : 'No current academic year'} />
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="body2">
          <strong>Section:</strong> {section?.name ?? '—'}
          {'  ·  '}
          <strong>Homeroom teacher:</strong> {section?.homeroomTeacher?.name ?? '—'}
        </Typography>
      </Paper>
      {courses.length === 0 ? (
        <EmptyState title="No courses this year" />
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small" aria-label="Student courses">
            <TableHead>
              <TableRow>
                <TableCell>Course</TableCell>
                <TableCell>Code</TableCell>
                <TableCell>Teacher</TableCell>
                <TableCell>Kind</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {courses.map((c) => (
                <TableRow key={c.enrollmentId}>
                  <TableCell>
                    <Box component="span" sx={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', bgcolor: c.subjectColor, mr: 1 }} />
                    <Link href={`/courses/${c.courseId}`}>{c.name}</Link>
                  </TableCell>
                  <TableCell>{c.code}</TableCell>
                  <TableCell>{c.teacher.name}</TableCell>
                  <TableCell>{c.kind}</TableCell>
                  <TableCell>
                    <Chip size="small" color={c.status === 'ACTIVE' ? 'success' : 'default'} label={c.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
