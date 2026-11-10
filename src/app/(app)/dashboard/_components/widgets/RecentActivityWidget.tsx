import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { formatInSchoolTz } from '@/lib/dates';
import { getSchoolTimezone } from '@/server/assignments/assignments-service';
import { getRecentActivity } from '@/server/dashboards/admin';

/** PRD-16 FR-22: last 10 user / report-card / settings audit entries. */
export async function RecentActivityWidget() {
  const [rows, tz] = await Promise.all([getRecentActivity(), getSchoolTimezone()]);
  if (!rows.length) return <EmptyState title="No recent activity" />;
  return (
    <List dense disablePadding>
      {rows.map((r) => (
        <ListItem key={r.id} disableGutters divider>
          <ListItemText
            primary={`${r.actorName ?? 'System'} · ${r.action}`}
            secondary={`${r.entityType ?? ''}${r.entityType ? ' · ' : ''}${formatInSchoolTz(r.createdAt, 'd MMM, HH:mm', tz)}`}
          />
        </ListItem>
      ))}
    </List>
  );
}
