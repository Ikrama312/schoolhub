import NextLink from 'next/link';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { requirePageRole } from '@/server/auth/requireRole';
import { AppError } from '@/server/http';
import { getSchoolSettings } from '@/server/services/settings';
import { getToday } from '@/server/attendance/attendance-service';
import { schoolToday } from '@/server/attendance/attendance-rules';
import { dateOnly } from '@/lib/validators/attendance';
import { formatInSchoolTz } from '@/lib/dates';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { DateNav } from './DateNav';

export const dynamic = 'force-dynamic';

type Taken = { at: string; by: { name: string } } | null;

/** Teacher landing — today's meetings, current period highlighted, daily registers (FR-6, FR-7, FR-8). */
export default async function TakeAttendancePage({ searchParams }: { searchParams: { date?: string } }) {
  const user = await requirePageRole('TEACHER', 'ADMIN');
  const { timezone } = await getSchoolSettings();
  const today = schoolToday(new Date(), timezone);
  const date = dateOnly.safeParse(searchParams.date).success ? searchParams.date! : today;

  let data: Awaited<ReturnType<typeof getToday>> | null = null;
  let error: string | null = null;
  try {
    data = await getToday(user, date);
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    error = e.message;
  }

  const takenLabel = (t: Taken) =>
    t ? `Taken ${formatInSchoolTz(t.at, 'HH:mm', timezone)} by ${t.by.name}` : 'Not taken';
  const chip = (t: Taken) => <Chip size="small" color={t ? 'success' : 'default'} label={takenLabel(t)} />;

  return (
    <Box>
      <PageHeader
        title="Take attendance"
        description={formatInSchoolTz(new Date(`${date}T12:00:00Z`), 'EEEE d MMMM yyyy', 'UTC')}
        actions={<DateNav date={date} today={today} role={user.role} />}
      />
      {error && <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>}
      {data && data.meetings.length === 0 && data.dailyRegisters.length === 0 && (
        <EmptyState title="No registers for this day" description="You have no classes or homeroom registers scheduled." />
      )}
      {data && data.dailyRegisters.length > 0 && (
        <Stack spacing={1} sx={{ mb: 2 }}>
          {data.dailyRegisters.map((d) => (
            <Paper key={d.sectionId} variant="outlined" sx={{ p: 2 }}>
              <Stack direction="row" spacing={2} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography sx={{ flexGrow: 1, fontWeight: 600 }}>Daily register – {d.sectionName}</Typography>
                {chip(d.taken)}
                <Button component={NextLink} href={`/attendance/take/section/${d.sectionId}?date=${date}`} variant="outlined">
                  {d.taken ? 'Review' : 'Take attendance'}
                </Button>
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}
      {data && data.meetings.length > 0 && (
        <Stack spacing={1}>
          {data.meetings.map((m) => (
            <Paper
              key={`${m.courseId}-${m.periodId}`}
              variant="outlined"
              sx={{ p: 2, borderColor: m.isCurrent ? 'primary.main' : undefined, borderWidth: m.isCurrent ? 2 : 1 }}
            >
              <Stack direction="row" spacing={2} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <Box sx={{ flexGrow: 1, minWidth: 180 }}>
                  <Typography sx={{ fontWeight: 600 }}>
                    {m.courseName}
                    {m.sectionName && ` – ${m.sectionName}`}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {m.periodName} · {m.startTime}–{m.endTime}
                    {m.isCurrent && ' · Now'}
                  </Typography>
                </Box>
                {chip(m.taken)}
                <Button
                  component={NextLink}
                  href={`/attendance/take/${m.courseId}?date=${date}&periodId=${m.periodId}`}
                  variant={m.isCurrent ? 'contained' : 'outlined'}
                >
                  {m.taken ? 'Review' : 'Take attendance'}
                </Button>
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}
    </Box>
  );
}
