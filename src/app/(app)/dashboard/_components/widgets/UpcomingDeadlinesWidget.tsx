import NextLink from 'next/link';
import LinearProgress from '@mui/material/LinearProgress';
import Link from '@mui/material/Link';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { UpdatedAgo } from '@/components/Widget/Widget';
import { formatInSchoolTz } from '@/lib/dates';
import type { AccessUser } from '@/server/auth/student-access';
import { getSchoolTimezone } from '@/server/assignments/assignments-service';
import { getUpcomingDeadlines } from '@/server/dashboards/teacher';

/** PRD-16 FR-6: next 7 days of deadlines with submission rates. */
export async function UpcomingDeadlinesWidget({ user }: { user: AccessUser }) {
  const [{ data, computedAt }, tz] = await Promise.all([getUpcomingDeadlines(user), getSchoolTimezone()]);
  return (
    <>
      {data.length === 0 ? (
        <EmptyState title="Nothing due in the next 7 days" />
      ) : (
        <List dense disablePadding>
          {data.map((d) => (
            <ListItem key={`${d.kind}-${d.id}`} disableGutters divider sx={{ display: 'block' }}>
              <ListItemText
                primary={
                  <Link component={NextLink} href={d.href}>
                    {d.title}
                  </Link>
                }
                secondary={`${d.kind === 'QUIZ' ? 'Quiz' : 'Assignment'} · ${d.courseName} · due ${formatInSchoolTz(d.dueAt, 'EEE d MMM, HH:mm', tz)} · ${d.submitted}/${d.expected} submitted (${d.submissionRate} %)`}
              />
              <LinearProgress variant="determinate" value={Math.min(100, d.submissionRate)} aria-label={`${d.title}: ${d.submissionRate} % submitted`} />
            </ListItem>
          ))}
        </List>
      )}
      <UpdatedAgo computedAt={computedAt} />
    </>
  );
}
