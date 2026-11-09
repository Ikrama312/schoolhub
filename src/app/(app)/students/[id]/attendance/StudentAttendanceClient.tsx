'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { endOfMonth, format, startOfMonth } from 'date-fns';
import type { GridColDef } from '@mui/x-data-grid';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { DateCalendar } from '@mui/x-date-pickers/DateCalendar';
import { DayCalendarSkeleton } from '@mui/x-date-pickers/DayCalendarSkeleton';
import { PickerDay, type PickerDayProps } from '@mui/x-date-pickers/PickerDay';
import { StatCard } from '@/components/StatCard/StatCard';
import { DataTable } from '@/components/DataTable/DataTable';
import { useToast } from '@/components/Toast/useToast';
import type { getStudentAttendance } from '@/server/attendance/attendance-service';

type Data = Awaited<ReturnType<typeof getStudentAttendance>>;
type Day = Data['calendar'][number];

const STATUS_COLOUR = { PRESENT: 'success', ABSENT: 'error', LATE: 'warning', EXCUSED: 'info' } as const;

const toLocal = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day);
};

/** FR-26: day slot coloured by dayColour, with a per-day summary tooltip. */
function AttendanceDay(props: PickerDayProps & { days?: Map<string, Day> }) {
  const { days, ...other } = props;
  const info = other.outsideCurrentMonth ? undefined : days?.get(format(other.day, 'yyyy-MM-dd'));
  const day = (
    <PickerDay
      {...other}
      sx={
        info && info.colour !== 'default'
          ? { bgcolor: `${info.colour}.main`, color: `${info.colour}.contrastText`, '&:hover, &:focus': { bgcolor: `${info.colour}.dark` } }
          : undefined
      }
    />
  );
  if (!info) return day;
  return (
    <Tooltip describeChild title={`Present ${info.present} · Absent ${info.absent} · Late ${info.late} · Excused ${info.excused}`}>
      {day}
    </Tooltip>
  );
}

const pct = (rate: number | null) => (rate === null ? '—' : `${rate}%`);

export function StudentAttendanceClient({ studentId, initial }: { studentId: string; initial: Data }) {
  const { showToast } = useToast();
  const searchParams = useSearchParams();
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const days = new Map(data.calendar.map((d) => [d.date, d]));
  const hasNotes = data.records.some((r) => 'note' in r);

  async function loadMonth(month: Date) {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ from: format(startOfMonth(month), 'yyyy-MM-dd'), to: format(endOfMonth(month), 'yyyy-MM-dd') });
      const res = await fetch(`/api/students/${studentId}/attendance?${qs}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Could not load attendance.');
      setData(json.data);
    } catch (e) {
      showToast({ message: e instanceof Error ? e.message : 'Could not load attendance.', severity: 'error' });
    } finally {
      setLoading(false);
    }
  }

  const { term, year } = data.summary;
  const cards = [
    { label: `${term.termName ?? 'Term'} rate`, value: pct(term.rate) },
    { label: 'Term absences', value: term.absent },
    { label: 'Term lates', value: term.late },
    { label: 'Term excused', value: term.excused },
    { label: 'Year rate', value: pct(year.rate) },
    { label: 'Year absences', value: year.absent },
    { label: 'Year lates', value: year.late },
    { label: 'Year excused', value: year.excused },
  ];

  const columns: GridColDef[] = [
    { field: 'date', headerName: 'Date', width: 120, sortable: false },
    { field: 'periodName', headerName: 'Period', width: 110, sortable: false, valueGetter: (v) => v ?? 'Daily' },
    { field: 'courseName', headerName: 'Course', flex: 1, minWidth: 140, sortable: false, valueGetter: (v, row) => v ?? row.sectionName ?? '—' },
    {
      field: 'status',
      headerName: 'Status',
      width: 120,
      sortable: false,
      renderCell: ({ value }) => <Chip size="small" color={STATUS_COLOUR[value as keyof typeof STATUS_COLOUR]} label={value} />,
    },
    { field: 'minutesLate', headerName: 'Min late', width: 90, sortable: false, valueGetter: (v) => v ?? '' },
    ...(hasNotes ? [{ field: 'note', headerName: 'Note', flex: 1, minWidth: 160, sortable: false } as GridColDef] : []),
  ];

  // Records are one month at most; DataTable's URL page/pageSize are applied client-side.
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Number(searchParams.get('pageSize')) || 20);
  const rows = data.records.slice((page - 1) * pageSize, page * pageSize);

  return (
    <Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 2, mb: 3 }}>
        {cards.map((c) => (
          <StatCard key={c.label} label={c.label} value={c.value} />
        ))}
      </Box>

      <Box sx={{ display: 'flex', gap: 3, flexDirection: { xs: 'column', md: 'row' }, alignItems: { md: 'flex-start' } }}>
        <Paper variant="outlined" sx={{ flexShrink: 0, alignSelf: { xs: 'center', md: 'flex-start' } }}>
          <DateCalendar
            value={null}
            readOnly
            referenceDate={toLocal(data.from)}
            views={['day']}
            loading={loading}
            renderLoading={() => <DayCalendarSkeleton />}
            onMonthChange={loadMonth}
            slots={{ day: AttendanceDay }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            slotProps={{ day: { days } as any }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, pb: 1.5 }}>
            Green: present · Amber: late · Red: absent
          </Typography>
        </Paper>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <DataTable columns={columns} rows={rows} total={data.records.length} loading={loading} />
        </Box>
      </Box>
    </Box>
  );
}
