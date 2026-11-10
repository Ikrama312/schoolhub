import { notFound, redirect } from 'next/navigation';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { StatCard } from '@/components/StatCard/StatCard';
import { requirePageRole } from '@/server/auth/requireRole';
import { AppError } from '@/server/http';
import { prisma } from '@/server/db';
import { getStudentInsights } from '@/server/dashboards/risk';
import { getSchoolTimezone } from '@/server/assignments/assignments-service';
import { formatInSchoolTz } from '@/lib/dates';

export const dynamic = 'force-dynamic';

const levelChip = (level: 'HIGH' | 'MEDIUM' | null) =>
  level ? <Chip color={level === 'HIGH' ? 'error' : 'warning'} label={level === 'HIGH' ? 'High risk' : 'Medium risk'} /> : <Chip label="Not at risk" />;

/** Student "Insights" tab — PRD-16 FR-31: current signals, level and the last 10 level changes. */
export default async function StudentInsightsPage({ params }: { params: { id: string } }) {
  const user = await requirePageRole('ADMIN', 'TEACHER');
  let data: Awaited<ReturnType<typeof getStudentInsights>>;
  try {
    data = await getStudentInsights(user, params.id);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    if (error instanceof AppError && error.code === 'FORBIDDEN') redirect('/forbidden');
    throw error;
  }
  const [student, tz] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: params.id }, select: { firstName: true, lastName: true } }),
    getSchoolTimezone(),
  ]);
  const s = data.signals;

  return (
    <>
      <PageHeader title="Insights" description={`${student.firstName} ${student.lastName}`} actions={levelChip(data.level)} />
      {!data.computedAt ? (
        <EmptyState title="No risk data yet" description="Insights are computed hourly for students in the current term." />
      ) : (
        <Stack spacing={3}>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <StatCard label="Attendance this term" value={s?.attendancePct == null ? '—' : `${s.attendancePct} %`} />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <StatCard label="Courses below 60 %" value={s?.coursesBelow60 ?? 0} />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <StatCard label="Missing work (30 days)" value={s?.missingCount ?? 0} />
            </Grid>
          </Grid>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
            {data.reasons.map((r) => (
              <Chip key={r.signal} variant="outlined" color={r.level === 'HIGH' ? 'error' : 'warning'} label={`${r.label} (${r.level === 'HIGH' ? 'high' : 'medium'})`} />
            ))}
          </Stack>
          <Typography variant="caption" color="text.secondary">
            Computed {formatInSchoolTz(data.computedAt, 'd MMM yyyy, HH:mm', tz)}
          </Typography>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="h6" component="h2">
                History
              </Typography>
              {data.history.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No level changes this term.
                </Typography>
              ) : (
                <List dense>
                  {data.history.map((h) => (
                    <ListItem key={h.computedAt} disableGutters divider>
                      <ListItemText
                        primary={h.level === 'HIGH' ? 'High risk' : h.level === 'MEDIUM' ? 'Medium risk' : 'No longer at risk'}
                        secondary={`${formatInSchoolTz(h.computedAt, 'd MMM yyyy, HH:mm', tz)}${h.reasons.length ? ` · ${h.reasons.map((r) => r.label).join(', ')}` : ''}`}
                      />
                    </ListItem>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>
        </Stack>
      )}
    </>
  );
}
