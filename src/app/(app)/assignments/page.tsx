import NextLink from 'next/link';
import { redirect } from 'next/navigation';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';
import { requirePageUser } from '@/server/auth/requireRole';
import { AppError } from '@/server/http';
import { getSchoolTimezone, listMyAssignments } from '@/server/assignments/assignments-service';
import { formatInSchoolTz } from '@/lib/dates';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { AssignmentList } from './AssignmentList';

export const dynamic = 'force-dynamic';

/** /assignments (FR-37..FR-39): student tabs, parent child selector, teacher/admin "To grade". */
export default async function AssignmentsPage({ searchParams }: { searchParams: { studentId?: string } }) {
  const user = await requirePageUser();
  let data: Awaited<ReturnType<typeof listMyAssignments>>;
  try {
    data = await listMyAssignments(user, { studentId: searchParams.studentId });
  } catch (error) {
    if (error instanceof AppError && error.code === 'FORBIDDEN') redirect('/forbidden');
    throw error;
  }
  const timezone = await getSchoolTimezone();

  if (data.view === 'toGrade') {
    return (
      <Box>
        <PageHeader title="To grade" description="Submitted work waiting for a grade, oldest first." />
        <Paper variant="outlined">
          {data.items.length === 0 ? (
            <EmptyState title="All caught up" description="No submissions are waiting to be graded." />
          ) : (
            <List disablePadding>
              {data.items.map((s) => (
                <ListItemButton key={s.submissionId} component={NextLink} href={`/courses/${s.assignment.courseId}/assignments/${s.assignment.id}/grade`} divider>
                  <ListItemText
                    primary={`${s.student.name} — ${s.assignment.title}`}
                    secondary={`${s.assignment.courseName} · submitted ${formatInSchoolTz(s.submittedAt, 'EEE d MMM, HH:mm', timezone)}`}
                  />
                  {s.isLate && <Chip size="small" color="warning" label="Late" />}
                </ListItemButton>
              ))}
            </List>
          )}
        </Paper>
      </Box>
    );
  }

  const child = data.children.find((c) => c.id === data.studentId);
  return (
    <Box>
      <PageHeader title="Assignments" description={child ? child.name : undefined} />
      <AssignmentList
        variant="tabs"
        showCourse
        rows={data.items}
        timezone={timezone}
        courses={data.courses}
        childOptions={data.children}
        studentId={data.studentId}
      />
    </Box>
  );
}
