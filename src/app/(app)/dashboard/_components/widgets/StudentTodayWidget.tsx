import Chip from '@mui/material/Chip';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import type { AccessUser } from '@/server/auth/student-access';
import { getStudentToday } from '@/server/dashboards/student';

/** PRD-16 FR-10: today's timetable with Now/Next, or the holiday message. */
export async function StudentTodayWidget({ user }: { user: AccessUser }) {
  const today = await getStudentToday(user);
  if (!today.isSchoolDay) return <EmptyState title={today.holidayName ?? 'No school today'} />;
  if (!today.items.length) return <EmptyState title="No classes scheduled today" />;
  return (
    <List dense disablePadding>
      {today.items.map((p) => (
        <ListItem key={p.slotId} disableGutters divider>
          <ListItemText
            primary={
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <span>{p.courseName}</span>
                {p.badge && <Chip size="small" color={p.badge === 'NOW' ? 'primary' : 'default'} label={p.badge === 'NOW' ? 'Now' : 'Next'} />}
              </Stack>
            }
            secondary={`${p.periodName} · ${p.startTime}–${p.endTime} · ${p.teacherName}${p.roomName ? ` · ${p.roomName}` : ''}`}
          />
        </ListItem>
      ))}
    </List>
  );
}
