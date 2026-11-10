import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { formatInSchoolTz } from '@/lib/dates';
import { getSchoolTimezone } from '@/server/assignments/assignments-service';
import { getUpcomingEvents } from '@/server/dashboards/admin';

/** PRD-16 FR-21: next 5 school-wide events. */
export async function UpcomingEventsWidget() {
  const [events, tz] = await Promise.all([getUpcomingEvents(), getSchoolTimezone()]);
  if (!events.length) return <EmptyState title="No upcoming events" />;
  return (
    <List dense disablePadding>
      {events.map((e) => (
        <ListItem key={`${e.eventId}-${e.startsAt}`} disableGutters divider>
          <ListItemText primary={e.title} secondary={formatInSchoolTz(e.startsAt, e.allDay ? 'EEE d MMM' : 'EEE d MMM, HH:mm', tz)} />
        </ListItem>
      ))}
    </List>
  );
}
