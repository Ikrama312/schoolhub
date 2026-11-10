import NextLink from 'next/link';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { formatInSchoolTz } from '@/lib/dates';
import type { AccessUser } from '@/server/auth/student-access';
import { getSchoolTimezone } from '@/server/assignments/assignments-service';
import { getDueSoon } from '@/server/dashboards/student';

/** PRD-16 FR-11: overdue first, marked with colour AND an "Overdue" label (NFR-2). */
export async function DueSoonWidget({ user }: { user: AccessUser }) {
  const [items, tz] = await Promise.all([getDueSoon(user), getSchoolTimezone()]);
  if (!items.length) return <EmptyState title="Nothing due in the next 7 days" />;
  return (
    <List dense disablePadding>
      {items.map((i) => (
        <ListItem key={`${i.kind}-${i.id}`} disableGutters divider>
          <ListItemText
            primary={
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Link component={NextLink} href={i.href} color={i.overdue ? 'error' : 'primary'}>
                  {i.title}
                </Link>
                {i.overdue && <Chip size="small" color="error" label="Overdue" />}
                {i.kind === 'QUIZ' && <Chip size="small" variant="outlined" label="Quiz" />}
              </Stack>
            }
            secondary={`${i.courseName} · ${i.overdue ? 'was due' : 'due'} ${formatInSchoolTz(i.dueAt, 'EEE d MMM, HH:mm', tz)}`}
            slotProps={{ secondary: { color: i.overdue ? 'error' : 'text.secondary' } }}
          />
        </ListItem>
      ))}
    </List>
  );
}
