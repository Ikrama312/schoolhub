'use client';

import NextLink from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Chip from '@mui/material/Chip';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import type { GridColDef } from '@mui/x-data-grid';
import { DataTable } from '@/components/DataTable/DataTable';
import type { AtRiskRow } from '@/server/dashboards/insights';

type Option = { id: string; name: string };

/** PRD-16 FR-30: the filters live in the URL; changing one resets to page 1. */
export function AtRiskFilters({ gradeLevels, sections }: { gradeLevels: Option[]; sections: Option[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page');
    router.push(`${pathname}?${next.toString()}`);
  };
  const select = (key: string, label: string, options: Option[]) => (
    <FormControl size="small" sx={{ minWidth: 160 }}>
      <InputLabel id={`f-${key}`}>{label}</InputLabel>
      <Select labelId={`f-${key}`} label={label} value={params.get(key) ?? ''} onChange={(e) => set(key, e.target.value)}>
        <MenuItem value="">All</MenuItem>
        {options.map((o) => (
          <MenuItem key={o.id} value={o.id}>
            {o.name}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
  return (
    <Stack direction="row" spacing={2} sx={{ mb: 2, flexWrap: 'wrap', rowGap: 2 }}>
      {select('level', 'Level', [
        { id: 'HIGH', name: 'High' },
        { id: 'MEDIUM', name: 'Medium' },
      ])}
      {select('reason', 'Reason', [
        { id: 'ATTENDANCE', name: 'Attendance' },
        { id: 'GRADES', name: 'Grades' },
        { id: 'MISSING', name: 'Missing work' },
      ])}
      {select('gradeLevel', 'Grade level', gradeLevels)}
      {select('sectionId', 'Section', sections)}
    </Stack>
  );
}

const TREND = {
  up: { icon: <ArrowUpwardIcon color="error" fontSize="small" />, label: 'Risk increased' },
  down: { icon: <ArrowDownwardIcon color="success" fontSize="small" />, label: 'Risk decreased' },
  flat: { icon: <ArrowForwardIcon color="disabled" fontSize="small" />, label: 'No change' },
} as const;

const columns: GridColDef[] = [
  {
    field: 'studentName',
    headerName: 'Student',
    flex: 1,
    minWidth: 160,
    sortable: false,
    renderCell: (p) => (
      <Link component={NextLink} href={`/students/${p.row.studentId}/insights`}>
        {p.value}
      </Link>
    ),
  },
  { field: 'sectionName', headerName: 'Section', width: 110, sortable: false },
  { field: 'gradeLevel', headerName: 'Grade', width: 110, sortable: false },
  {
    field: 'level',
    headerName: 'Level',
    width: 100,
    sortable: false,
    renderCell: (p) => <Chip size="small" color={p.value === 'HIGH' ? 'error' : 'warning'} label={p.value === 'HIGH' ? 'High' : 'Medium'} />,
  },
  {
    field: 'reasons',
    headerName: 'Reasons',
    flex: 2,
    minWidth: 220,
    sortable: false,
    renderCell: (p) => (
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', height: '100%', flexWrap: 'wrap' }}>
        {(p.value as AtRiskRow['reasons']).map((r) => (
          <Chip key={r.signal} size="small" variant="outlined" label={r.label} />
        ))}
      </Stack>
    ),
  },
  {
    field: 'trend',
    headerName: 'Trend',
    width: 80,
    sortable: false,
    renderCell: (p) => {
      const t = TREND[p.value as keyof typeof TREND];
      return (
        <Stack role="img" aria-label={t.label} title={t.label} sx={{ justifyContent: 'center', height: '100%' }}>
          {t.icon}
        </Stack>
      );
    },
  },
  {
    field: 'actions',
    headerName: 'Actions',
    width: 260,
    sortable: false,
    renderCell: (p) => (
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', height: '100%' }}>
        <Link component={NextLink} href={`/students/${p.row.studentId}/insights`}>
          Open student
        </Link>
        {/* The PRD-13 "Message parents" action (prefilled recipients) sits at the top of every student page. */}
        <Link component={NextLink} href={`/students/${p.row.studentId}/insights`}>
          Message parents
        </Link>
      </Stack>
    ),
  },
];

/** The shared DataTable needs renderCell functions, so the table lives on the client side of the boundary. */
export function AtRiskTable({ rows, total }: { rows: AtRiskRow[]; total: number }) {
  return <DataTable columns={columns} rows={rows.map((r) => ({ ...r, id: r.studentId }))} total={total} />;
}
