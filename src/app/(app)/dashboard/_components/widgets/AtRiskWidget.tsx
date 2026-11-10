import NextLink from 'next/link';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { UpdatedAgo } from '@/components/Widget/Widget';
import type { AccessUser } from '@/server/auth/student-access';
import { getTopAtRisk } from '@/server/dashboards/insights';

/** PRD-16 FR-7: top 5 at-risk students in scope, from the snapshot table. */
export async function AtRiskWidget({ user }: { user: AccessUser }) {
  const { data, computedAt } = await getTopAtRisk(user, 5);
  return (
    <>
      {data.length === 0 ? (
        <EmptyState title="No students flagged" description="Nobody in your classes is currently at risk." />
      ) : (
        <List dense disablePadding>
          {data.map((r) => (
            <ListItem key={r.studentId} disableGutters divider>
              <ListItemText
                primary={
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Link component={NextLink} href={`/students/${r.studentId}/insights`}>
                      {r.studentName}
                    </Link>
                    <Chip size="small" color={r.level === 'HIGH' ? 'error' : 'warning'} label={r.level === 'HIGH' ? 'High' : 'Medium'} />
                  </Stack>
                }
                secondary={
                  <Stack component="span" direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
                    {r.reasons.map((x) => (
                      <Chip key={x.signal} component="span" size="small" variant="outlined" label={x.label} />
                    ))}
                  </Stack>
                }
              />
            </ListItem>
          ))}
        </List>
      )}
      <Link component={NextLink} href="/insights/at-risk" sx={{ display: 'inline-block', mt: 1 }}>
        View all at-risk students
      </Link>
      <UpdatedAgo computedAt={computedAt} />
    </>
  );
}
