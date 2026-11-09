'use client';

import NextLink from 'next/link';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Tooltip from '@mui/material/Tooltip';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import type { getCourseMatrix } from '@/server/attendance/attendance-service';

type Matrix = Awaited<ReturnType<typeof getCourseMatrix>>;

const CELL = {
  PRESENT: { short: 'P', colour: 'success.main' },
  ABSENT: { short: 'A', colour: 'error.main' },
  LATE: { short: 'L', colour: 'warning.main' },
  EXCUSED: { short: 'E', colour: 'info.main' },
} as const;

/** FR-29: students × last 20 registers, coloured P/A/L/E cells, rate column, headers link to the register. */
export function CourseAttendanceMatrix({ courseId, matrix }: { courseId: string; matrix: Matrix }) {
  if (matrix.sessions.length === 0) {
    return <EmptyState title="No registers yet" description="Attendance taken for this course will appear here." />;
  }

  const columns: GridColDef[] = [
    {
      field: 'name',
      headerName: 'Student',
      width: 180,
      valueGetter: (_v, row) => `${row.lastName}, ${row.firstName}${row.enrollmentStatus === 'DROPPED' ? ' (dropped)' : ''}`,
    },
    { field: 'rate', headerName: 'Rate', width: 80, type: 'number', valueFormatter: (v: number | null) => (v === null ? '—' : `${v}%`) },
    ...matrix.sessions.map<GridColDef>((s) => ({
      field: s.sessionId,
      width: 72,
      sortable: false,
      align: 'center',
      headerAlign: 'center',
      valueGetter: (_v, row) => row.cells[s.sessionId] ?? null,
      renderHeader: () => (
        <Tooltip title={`${s.date} · ${s.periodName}`}>
          <Link component={NextLink} href={`/attendance/take/${courseId}?date=${s.date}&periodId=${s.periodId}`} underline="hover">
            {s.date.slice(5)}
          </Link>
        </Tooltip>
      ),
      renderCell: ({ value }) => {
        const cell = value ? CELL[value as keyof typeof CELL] : null;
        return cell ? (
          <Box component="span" aria-label={value} sx={{ color: cell.colour, fontWeight: 700 }}>
            {cell.short}
          </Box>
        ) : (
          '·'
        );
      },
    })),
  ];

  return (
    <Box sx={{ width: '100%', overflowX: 'auto' }}>
      <DataGrid
        autoHeight
        rows={matrix.students}
        columns={columns}
        getRowId={(r) => r.studentId}
        density="compact"
        disableRowSelectionOnClick
        disableColumnMenu
        pageSizeOptions={[25, 50, 100]}
        initialState={{ pagination: { paginationModel: { pageSize: 50 } } }}
      />
    </Box>
  );
}
