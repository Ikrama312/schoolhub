import NextLink from 'next/link';
import Link from '@mui/material/Link';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { formatInSchoolTz } from '@/lib/dates';
import type { AccessUser } from '@/server/auth/student-access';
import { getSchoolTimezone } from '@/server/assignments/assignments-service';
import { getRecentGrades } from '@/server/dashboards/student';

/** PRD-16 FR-12: the last 5 grades. */
export async function RecentGradesWidget({ user }: { user: AccessUser }) {
  const [grades, tz] = await Promise.all([getRecentGrades(user), getSchoolTimezone()]);
  if (!grades.length) return <EmptyState title="No grades yet" />;
  return (
    <>
      <List dense disablePadding>
        {grades.map((g) => (
          <ListItem key={g.gradeItemId} disableGutters divider secondaryAction={<Typography variant="body2">{g.percent === null ? '—' : `${g.percent} %`}</Typography>}>
            <ListItemText primary={g.title} secondary={`${g.courseName} · ${formatInSchoolTz(g.gradedAt, 'd MMM', tz)}`} />
          </ListItem>
        ))}
      </List>
      <Link component={NextLink} href="/grades" sx={{ display: 'inline-block', mt: 1 }}>
        All grades
      </Link>
    </>
  );
}
