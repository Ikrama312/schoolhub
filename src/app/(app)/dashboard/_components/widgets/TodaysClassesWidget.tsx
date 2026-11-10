import NextLink from 'next/link';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import type { AccessUser } from '@/server/auth/student-access';
import { getTodaysClasses } from '@/server/dashboards/teacher';

/** PRD-16 FR-4: today's classes with Now/Next, register status and quick links. Live. */
export async function TodaysClassesWidget({ user }: { user: AccessUser }) {
  const classes = await getTodaysClasses(user);
  if (!classes.length) return <EmptyState title="No classes today" />;
  return (
    <List dense disablePadding>
      {classes.map((c) => (
        <ListItem
          key={c.slotId}
          disableGutters
          divider
          secondaryAction={
            !c.attendanceTaken && (
              <Button component={NextLink} href={c.takeAttendanceHref} size="small" variant="outlined">
                Take attendance
              </Button>
            )
          }
        >
          <ListItemText
            primary={
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <Link component={NextLink} href={c.courseHref}>
                  {c.courseName}
                </Link>
                {c.badge && <Chip size="small" color={c.badge === 'NOW' ? 'primary' : 'default'} label={c.badge === 'NOW' ? 'Now' : 'Next'} />}
                <Chip
                  size="small"
                  variant="outlined"
                  color={c.attendanceTaken ? 'success' : 'warning'}
                  label={c.attendanceTaken ? 'Attendance taken' : 'Attendance not taken'}
                />
              </Stack>
            }
            secondary={`${c.periodName} · ${c.startTime}–${c.endTime}${c.sectionName ? ` · ${c.sectionName}` : ''}${c.roomName ? ` · ${c.roomName}` : ''}`}
          />
        </ListItem>
      ))}
    </List>
  );
}
