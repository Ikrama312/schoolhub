import { notFound } from 'next/navigation';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';
import { requirePageRole } from '@/server/auth/requireRole';
import { getCourseRoster, type RosterEntry } from '@/server/courses/courses-service';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { ALL_ROLES } from '@/config/navigation';
import { prisma } from '@/server/db';
import { RosterTable, type RosterRow } from './RosterTable';

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

  const course = await prisma.course.findUnique({ where: { id: params.courseId }, select: { code: true } });
  const tableRows: RosterRow[] = (rows as RosterEntry[]).map((r) => ({
    enrollmentId: r.enrollmentId,
    studentId: r.student.id,
    name: r.student.name,
    profileUrl: r.student.profileUrl,
    admissionNumber: r.student.admissionNumber,
    status: r.status,
    enrolled: r.enrolledAt.toLocaleDateString(),
  }));
  // PRD-13 FR-17: the staff table is a client component so students can be selected and messaged.
  return <RosterTable rows={tableRows} courseCode={course?.code ?? ''} />;
}
