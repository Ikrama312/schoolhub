import NextLink from 'next/link';
import Link from '@mui/material/Link';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import { UpdatedAgo } from '@/components/Widget/Widget';
import { formatInSchoolTz } from '@/lib/dates';
import type { AccessUser } from '@/server/auth/student-access';
import { getSchoolTimezone } from '@/server/assignments/assignments-service';
import { getToGrade } from '@/server/dashboards/teacher';

/** PRD-16 FR-5: ungraded work count and the 5 oldest items. */
export async function ToGradeWidget({ user }: { user: AccessUser }) {
  const [{ data, computedAt }, tz] = await Promise.all([getToGrade(user), getSchoolTimezone()]);
  return (
    <>
      <Typography variant="h4" component="p" sx={{ fontWeight: 600 }}>
        {data.count}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {data.count === 1 ? 'item waiting to be graded' : 'items waiting to be graded'}
      </Typography>
      <List dense disablePadding>
        {data.items.map((i) => (
          <ListItem key={`${i.kind}-${i.id}`} disableGutters>
            <ListItemText
              primary={
                <Link component={NextLink} href={i.href}>
                  {i.title}
                </Link>
              }
              secondary={`${i.studentName} · ${i.courseName} · ${i.kind === 'QUIZ_ATTEMPT' ? 'Quiz' : 'Submitted'} ${formatInSchoolTz(i.submittedAt, 'd MMM', tz)}`}
            />
          </ListItem>
        ))}
      </List>
      {data.count > 0 && (
        <Link component={NextLink} href="/assignments">
          See all
        </Link>
      )}
      <UpdatedAgo computedAt={computedAt} />
    </>
  );
}
