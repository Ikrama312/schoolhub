'use client';

import { useState } from 'react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { StatCard } from '@/components/StatCard/StatCard';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { useToast } from '@/components/Toast/useToast';
import { ATTENDANCE_MODES, attendanceSettingsPatch } from '@/lib/validators/attendance';
import type { getBelowThreshold, getOverview } from '@/server/attendance/attendance-service';
import { ReportTab, type ReportOptions } from './ReportTab';

type Overview = Awaited<ReturnType<typeof getOverview>>;
type Below = Awaited<ReturnType<typeof getBelowThreshold>>;

const MODE_LABELS: Record<(typeof ATTENDANCE_MODES)[number], string> = {
  PER_PERIOD: 'Per period',
  DAILY_HOMEROOM: 'Daily homeroom',
  BOTH: 'Both',
};

const pct = (rate: number | null) => (rate === null ? '—' : `${rate}%`);

export interface AdminAttendanceProps {
  overview: Overview;
  below: Below;
  settings: { attendanceMode: (typeof ATTENDANCE_MODES)[number]; attendanceAlertThreshold: number };
  options: ReportOptions;
  today: string;
  monthStart: string;
}

/** FR-5, FR-30 to FR-33: Today, Report, Below threshold and Settings on one page. */
export function AdminAttendanceClient({ overview, below, settings, options, today, monthStart }: AdminAttendanceProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [tab, setTab] = useState('today');
  const [reminding, setReminding] = useState<string | null>(null);
  const [form, setForm] = useState({ attendanceMode: settings.attendanceMode, attendanceAlertThreshold: String(settings.attendanceAlertThreshold) });
  const [savingSettings, setSavingSettings] = useState(false);

  async function remind(m: Overview['missing'][number]) {
    const id = `${m.courseId}|${m.periodId}`;
    setReminding(id);
    try {
      const res = await fetch('/api/admin/attendance/remind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId: m.courseId, periodId: m.periodId, date: overview.date }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? 'Could not send the reminder.');
      showToast({ message: `Reminder sent to ${json.data.reminded.name}`, severity: 'success' });
    } catch (e) {
      showToast({ message: e instanceof Error ? e.message : 'Could not send the reminder.', severity: 'error' });
    } finally {
      setReminding(null);
    }
  }

  async function saveSettings() {
    const parsed = attendanceSettingsPatch.safeParse({ attendanceMode: form.attendanceMode, attendanceAlertThreshold: Number(form.attendanceAlertThreshold) });
    if (!parsed.success) {
      showToast({ message: 'Threshold must be a whole number from 0 to 100.', severity: 'error' });
      return;
    }
    setSavingSettings(true);
    try {
      const res = await fetch('/api/settings/school', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? 'Could not save settings.');
      showToast({ message: 'Attendance settings saved', severity: 'success' });
      router.refresh();
    } catch (e) {
      showToast({ message: e instanceof Error ? e.message : 'Could not save settings.', severity: 'error' });
    } finally {
      setSavingSettings(false);
    }
  }

  return (
    <Box>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto" sx={{ mb: 3 }} aria-label="Attendance admin">
        <Tab value="today" label="Today" />
        <Tab value="report" label="Report" />
        <Tab value="below" label={`Below threshold (${below.rows.length})`} />
        <Tab value="settings" label="Settings" />
      </Tabs>

      {tab === 'today' && (
        <Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 2, mb: 3 }}>
            <StatCard label="Registers expected" value={overview.expected} />
            <StatCard label="Registers taken" value={overview.taken} />
            <StatCard label="Missing" value={overview.missing.length} />
            <StatCard label="Attendance today" value={pct(overview.rate)} />
          </Box>
          <Typography variant="h6" sx={{ mb: 1 }}>
            Missing registers
          </Typography>
          {overview.missing.length === 0 ? (
            <EmptyState title="No missing registers" description="Registers count as missing 15 minutes after the period starts." />
          ) : (
            <Stack spacing={1}>
              {overview.missing.map((m) => (
                <Paper key={`${m.courseId}|${m.periodId}`} variant="outlined" sx={{ p: 2 }}>
                  <Stack direction="row" spacing={2} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    <Box sx={{ flexGrow: 1 }}>
                      <Typography sx={{ fontWeight: 600 }}>
                        {m.courseName}
                        {m.sectionName && ` – ${m.sectionName}`}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {m.periodName} · {m.startTime} · {m.teacher.name}
                      </Typography>
                    </Box>
                    <Button variant="outlined" onClick={() => remind(m)} disabled={reminding === `${m.courseId}|${m.periodId}`}>
                      Remind teacher
                    </Button>
                  </Stack>
                </Paper>
              ))}
            </Stack>
          )}
        </Box>
      )}

      {tab === 'report' && <ReportTab options={options} today={today} monthStart={monthStart} />}

      {tab === 'below' && (
        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Students whose year-to-date attendance is below {below.threshold}%.
          </Typography>
          {below.rows.length === 0 ? (
            <EmptyState title="Nobody is below the threshold" />
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small" aria-label="Students below the attendance threshold">
                <TableHead>
                  <TableRow>
                    <TableCell>Student</TableCell>
                    <TableCell>Section</TableCell>
                    <TableCell>Grade</TableCell>
                    <TableCell align="right">Absent</TableCell>
                    <TableCell align="right">Late</TableCell>
                    <TableCell align="right">Rate</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {below.rows.map((r) => (
                    <TableRow key={r.studentId}>
                      <TableCell>
                        <Link component={NextLink} href={r.href}>
                          {r.studentName}
                        </Link>
                      </TableCell>
                      <TableCell>{r.sectionName ?? '—'}</TableCell>
                      <TableCell>{r.gradeLevelName ?? '—'}</TableCell>
                      <TableCell align="right">{r.absent}</TableCell>
                      <TableCell align="right">{r.late}</TableCell>
                      <TableCell align="right">{pct(r.rate)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Box>
      )}

      {tab === 'settings' && (
        <Card variant="outlined" sx={{ maxWidth: 480 }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Attendance settings
            </Typography>
            <Stack spacing={2}>
              <TextField
                select
                label="Attendance mode"
                value={form.attendanceMode}
                onChange={(e) => setForm({ ...form, attendanceMode: e.target.value as typeof form.attendanceMode })}
              >
                {ATTENDANCE_MODES.map((m) => (
                  <MenuItem key={m} value={m}>
                    {MODE_LABELS[m]}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                type="number"
                label="Alert threshold (%)"
                value={form.attendanceAlertThreshold}
                onChange={(e) => setForm({ ...form, attendanceAlertThreshold: e.target.value })}
                slotProps={{ htmlInput: { min: 0, max: 100 } }}
              />
              <Box>
                <Button variant="contained" onClick={saveSettings} disabled={savingSettings}>
                  Save settings
                </Button>
              </Box>
            </Stack>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}
