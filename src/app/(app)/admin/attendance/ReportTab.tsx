'use client';

import { useState } from 'react';
import { DataGrid, type GridColDef, type GridPaginationModel } from '@mui/x-data-grid';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useToast } from '@/components/Toast/useToast';
import { ATTENDANCE_STATUSES, reportFilters } from '@/lib/validators/attendance';
import type { StudentSummaryRow } from '@/server/attendance/attendance-service';

export interface ReportOptions {
  gradeLevels: { id: string; name: string }[];
  sections: { id: string; name: string }[];
  courses: { id: string; name: string }[];
}

const columns: GridColDef[] = [
  { field: 'studentName', headerName: 'Student', flex: 1, minWidth: 160, sortable: false },
  { field: 'sectionName', headerName: 'Section', width: 100, sortable: false },
  { field: 'gradeLevelName', headerName: 'Grade', width: 100, sortable: false },
  { field: 'records', headerName: 'Records', width: 90, type: 'number', sortable: false },
  { field: 'present', headerName: 'Present', width: 90, type: 'number', sortable: false },
  { field: 'absent', headerName: 'Absent', width: 90, type: 'number', sortable: false },
  { field: 'late', headerName: 'Late', width: 80, type: 'number', sortable: false },
  { field: 'excused', headerName: 'Excused', width: 90, type: 'number', sortable: false },
  { field: 'rate', headerName: 'Rate', width: 90, type: 'number', sortable: false, valueFormatter: (v: number | null) => (v === null ? '—' : `${v}%`) },
];

/** FR-32: filter form → paginated per-student summary; Export CSV uses the same filters. */
export function ReportTab({ options, today, monthStart }: { options: ReportOptions; today: string; monthStart: string }) {
  const { showToast } = useToast();
  const [filters, setFilters] = useState({ from: monthStart, to: today, gradeLevelId: '', sectionId: '', courseId: '', status: '' });
  const [rows, setRows] = useState<StudentSummaryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [paging, setPaging] = useState<GridPaginationModel>({ page: 0, pageSize: 20 });

  const query = () => new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]);

  async function run(model = paging) {
    const parsed = reportFilters.safeParse(Object.fromEntries(query()));
    if (!parsed.success) {
      showToast({ message: parsed.error.issues[0]?.message ?? 'Check the filters.', severity: 'error' });
      return;
    }
    setLoading(true);
    try {
      const qs = query();
      qs.set('page', String(model.page + 1));
      qs.set('pageSize', String(model.pageSize));
      const res = await fetch(`/api/admin/attendance/report?${qs}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Could not load the report.');
      setRows(json.data);
      setTotal(json.meta.total);
    } catch (e) {
      showToast({ message: e instanceof Error ? e.message : 'Could not load the report.', severity: 'error' });
    } finally {
      setLoading(false);
    }
  }

  const set = (field: keyof typeof filters) => (e: React.ChangeEvent<HTMLInputElement>) => setFilters({ ...filters, [field]: e.target.value });
  const select = (field: 'gradeLevelId' | 'sectionId' | 'courseId', label: string, items: { id: string; name: string }[]) => (
    <TextField select size="small" label={label} value={filters[field]} onChange={set(field)} sx={{ minWidth: 150 }}>
      <MenuItem value="">All</MenuItem>
      {items.map((i) => (
        <MenuItem key={i.id} value={i.id}>
          {i.name}
        </MenuItem>
      ))}
    </TextField>
  );

  return (
    <Box>
      <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: 'wrap', mb: 2 }}>
        <TextField type="date" size="small" label="From" value={filters.from} onChange={set('from')} slotProps={{ inputLabel: { shrink: true } }} />
        <TextField type="date" size="small" label="To" value={filters.to} onChange={set('to')} slotProps={{ inputLabel: { shrink: true } }} />
        {select('gradeLevelId', 'Grade', options.gradeLevels)}
        {select('sectionId', 'Section', options.sections)}
        {select('courseId', 'Course', options.courses)}
        <TextField select size="small" label="Has status" value={filters.status} onChange={set('status')} sx={{ minWidth: 140 }}>
          <MenuItem value="">Any</MenuItem>
          {ATTENDANCE_STATUSES.map((s) => (
            <MenuItem key={s} value={s}>
              {s}
            </MenuItem>
          ))}
        </TextField>
        <Button variant="contained" onClick={() => { const m = { ...paging, page: 0 }; setPaging(m); void run(m); }}>
          Run report
        </Button>
        <Button component="a" variant="outlined" href={`/api/admin/attendance/report?${query()}&format=csv`}>
          Export CSV
        </Button>
      </Stack>
      <DataGrid
        autoHeight
        rows={rows}
        columns={columns}
        rowCount={total}
        loading={loading}
        getRowId={(r) => r.studentId}
        paginationMode="server"
        paginationModel={paging}
        onPaginationModelChange={(m) => { setPaging(m); void run(m); }}
        pageSizeOptions={[20, 50, 100]}
        disableRowSelectionOnClick
        disableColumnMenu
      />
    </Box>
  );
}
