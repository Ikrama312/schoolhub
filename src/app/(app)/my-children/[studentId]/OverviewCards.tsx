import Link from 'next/link';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardActions from '@mui/material/CardActions';
import CardContent from '@mui/material/CardContent';
import CardHeader from '@mui/material/CardHeader';
import Chip from '@mui/material/Chip';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CampaignOutlinedIcon from '@mui/icons-material/CampaignOutlined';
import type { SessionUser } from '@/server/auth/requireRole';
import {
  getActionItems,
  getFeesSummary,
  getAssignmentsSummary,
  getAttendanceSummary,
  getRecentGrades,
  getTeachers,
  getToday,
  getUpcomingEvents,
  listUnreadAnnouncements,
} from '@/server/parent/overview-service';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { formatMoney } from '@/lib/money';

/** PRD-15 overview cards (FR-9 to FR-17). Async server components; each streams under its own Suspense. */

interface CardProps {
  user: SessionUser;
  studentId: string;
}

const STATUS_COLOR = { PRESENT: 'success', ABSENT: 'error', LATE: 'warning', EXCUSED: 'info' } as const;
const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const date = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n * 10) / 10}%`);

function Shell({ title, href, linkLabel = 'View all', children }: { title: string; href?: string; linkLabel?: string; children: React.ReactNode }) {
  return (
    <Card variant="outlined" sx={{ height: '100%', display: 'flex', flexDirection: 'column' }} component="section" aria-label={title}>
      <CardHeader title={title} slotProps={{ title: { variant: 'h6', component: 'h2' } }} sx={{ pb: 0 }} />
      <CardContent sx={{ flexGrow: 1 }}>{children}</CardContent>
      {href && (
        <CardActions>
          <Button size="small" component={Link} href={href}>
            {linkLabel}
          </Button>
        </CardActions>
      )}
    </Card>
  );
}

const Empty = ({ text }: { text: string }) => (
  <Typography variant="body2" color="text.secondary">
    {text}
  </Typography>
);

export async function TodayCard({ user, studentId }: CardProps) {
  const t = await getToday(user, studentId);
  return (
    <Shell title="Today" href={`/students/${studentId}/courses`}>
      {!t.isSchoolDay ? (
        <Empty text={t.noSchoolReason ?? 'No school today'} />
      ) : t.periods.length === 0 ? (
        <Empty text="No classes scheduled today." />
      ) : (
        <List dense disablePadding>
          {t.periods.map((p) => (
            <ListItem key={`${p.periodName}-${p.courseName}`} disableGutters>
              <ListItemText primary={`${p.startsAt}–${p.endsAt} · ${p.courseName}`} secondary={[p.periodName, p.room, p.teacherName].filter(Boolean).join(' · ')} />
            </ListItem>
          ))}
        </List>
      )}
    </Shell>
  );
}

export async function AttendanceCard({ user, studentId }: CardProps) {
  const a = await getAttendanceSummary(user, studentId);
  return (
    <Shell title="Attendance" href={`/students/${studentId}/attendance`}>
      <Stack direction="row" spacing={3} sx={{ mb: 2 }}>
        <div>
          <Typography variant="h5">{a.rateTerm === null ? '—' : pct(a.rateTerm * 100)}</Typography>
          <Typography variant="caption" color="text.secondary">
            {a.termName ?? 'This term'}
          </Typography>
        </div>
        <div>
          <Typography variant="h5">{a.absences}</Typography>
          <Typography variant="caption" color="text.secondary">
            Absences
          </Typography>
        </div>
        <div>
          <Typography variant="h5">{a.lates}</Typography>
          <Typography variant="caption" color="text.secondary">
            Lates
          </Typography>
        </div>
      </Stack>
      <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
        {a.last5.map((r, i) => (
          <Chip key={i} size="small" variant="outlined" color={STATUS_COLOR[r.status]} label={`${r.date.slice(5)} ${r.periodName ?? ''} ${r.status.toLowerCase()}`} />
        ))}
      </Stack>
      {user.role === 'PARENT' && (
        <Button sx={{ mt: 2 }} size="small" variant="outlined" component={Link} href={`/my-children/${studentId}/absence/new`}>
          Report an absence
        </Button>
      )}
    </Shell>
  );
}

export async function AssignmentsCard({ user, studentId }: CardProps) {
  const a = await getAssignmentsSummary(user, studentId);
  return (
    <Shell title="Assignments" href={`/assignments?studentId=${studentId}`}>
      {a.missing.length === 0 && a.dueNext7Days.length === 0 ? (
        <Empty text="Nothing missing or due this week." />
      ) : (
        <List dense disablePadding>
          {a.missing.map((x) => (
            <ListItem key={x.id} disableGutters>
              <ListItemText primary={x.title} secondary={`${x.courseName} · was due ${date(x.dueAt)}`} slotProps={{ primary: { color: 'error' } }} />
              <Chip size="small" color="error" label="Missing" />
            </ListItem>
          ))}
          {a.dueNext7Days.map((x) => (
            <ListItem key={x.id} disableGutters>
              <ListItemText primary={x.title} secondary={`${x.courseName} · due ${when(x.dueAt)}`} />
            </ListItem>
          ))}
        </List>
      )}
    </Shell>
  );
}

export async function GradesCard({ user, studentId }: CardProps) {
  const g = await getRecentGrades(user, studentId);
  return (
    <Shell title="Recent grades" href={`/grades?studentId=${studentId}`}>
      {g.recent.length === 0 ? (
        <Empty text="No grades yet this term." />
      ) : (
        <List dense disablePadding>
          {g.recent.map((r) => (
            <ListItem key={r.gradeItemId} disableGutters>
              <ListItemText primary={`${r.title} — ${r.score}/${r.maxScore}`} secondary={r.courseName} />
            </ListItem>
          ))}
        </List>
      )}
      {g.courses.length > 0 && (
        <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap', mt: 1 }}>
          {g.courses.map((c) => (
            <Chip key={c.courseId} size="small" variant="outlined" label={`${c.courseName}: ${pct(c.currentPct)}`} />
          ))}
        </Stack>
      )}
    </Shell>
  );
}

/** FR-13 partial (ADR-11): PRD-12 announcements are not built yet. */
export async function AnnouncementsCard({ user, studentId }: CardProps) {
  const items = await listUnreadAnnouncements(user, studentId);
  return (
    <Shell title="Announcements">
      {items.length === 0 && <EmptyState icon={<CampaignOutlinedIcon sx={{ fontSize: 40 }} />} title="No new announcements" />}
    </Shell>
  );
}

export async function EventsCard({ user, studentId }: CardProps) {
  const events = await getUpcomingEvents(user, studentId);
  return (
    <Shell title="Upcoming events" href="/conferences" linkLabel="Conferences">
      {events.length === 0 ? (
        <Empty text="Nothing coming up." />
      ) : (
        <List dense disablePadding>
          {events.map((e) => (
            <ListItem key={`${e.source}-${e.id}-${e.startsAt}`} disableGutters>
              <ListItemText primary={e.title} secondary={e.allDay ? date(e.startsAt) : when(e.startsAt)} />
              {e.source === 'myMeetings' && <Chip size="small" color="primary" variant="outlined" label="My meeting" />}
            </ListItem>
          ))}
        </List>
      )}
    </Shell>
  );
}

export async function TeachersCard({ user, studentId }: CardProps) {
  const teachers = await getTeachers(user, studentId);
  return (
    <Shell title="Teachers" href={`/students/${studentId}/courses`}>
      {teachers.length === 0 ? (
        <Empty text="No teachers yet." />
      ) : (
        <List dense disablePadding>
          {teachers.map((t) => (
            <ListItem
              key={t.userId}
              disableGutters
              secondaryAction={
                <Button size="small" component={Link} href={t.messageHref}>
                  Message
                </Button>
              }
            >
              <ListItemText primary={t.name} secondary={t.subjects.join(', ')} />
            </ListItem>
          ))}
        </List>
      )}
    </Shell>
  );
}

export async function ActionsCard({ user, studentId }: CardProps) {
  const [items, fees] = await Promise.all([getActionItems(user, studentId), user.role === 'PARENT' ? getFeesSummary(user, studentId) : null]);
  return (
    <Shell title="Action items" href="/consent-forms" linkLabel="Consent forms">
      {/* PRD-17 FR-40: shown only while the child has an outstanding balance. */}
      {fees && (
        <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: 'center', justifyContent: 'space-between' }} component="section" aria-label="Fees">
          <ListItemText primary="Fees" secondary={`Outstanding balance ${formatMoney(fees.outstanding, fees.currency)}`} />
          <Button size="small" variant="outlined" component={Link} href={fees.href}>
            View fees
          </Button>
        </Stack>
      )}
      {items.length === 0 && !fees ? (
        <Empty text="You're all caught up." />
      ) : (
        <List dense disablePadding>
          {items.map((a) => (
            <ListItem
              key={`${a.type}-${a.id}`}
              disableGutters
              secondaryAction={
                <Button size="small" variant="outlined" component={Link} href={a.href}>
                  {a.type === 'consent' ? 'Respond' : 'Book'}
                </Button>
              }
            >
              <ListItemText primary={a.title} secondary={`${a.type === 'consent' ? 'Consent due' : 'Booking closes'} ${when(a.dueAt)}`} />
            </ListItem>
          ))}
        </List>
      )}
    </Shell>
  );
}
