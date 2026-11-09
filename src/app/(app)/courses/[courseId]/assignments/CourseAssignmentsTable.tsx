'use client';

import NextLink from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { GridColDef } from '@mui/x-data-grid';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import { DataTable } from '@/components/DataTable/DataTable';
import { formatInSchoolTz } from '@/lib/dates';
import type { listCourseAssignments } from '@/server/assignments/assignments-service';

type ManagerItem = Extract<Awaited<ReturnType<typeof listCourseAssignments>>, { view: 'manager' }>['items'][number];

const STATUS_COLOR = { DRAFT: 'default', SCHEDULED: 'info', PUBLISHED: 'success' } as const;

/** FR-17: manager table on the shared DataTable (MUI X DataGrid, override verified per ADR-2). */
export function CourseAssignmentsTable({ courseId, items, timezone }: { courseId: string; items: ManagerItem[]; timezone: string }) {
  const searchParams = useSearchParams();
  const q = (searchParams.get('q') ?? '').toLowerCase();
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Number(searchParams.get('pageSize')) || 20);
  const matching = items.filter((a) => a.title.toLowerCase().includes(q));
  // ponytail: one course's assignments are loaded at once and paged here; move paging server-side if a course ever has hundreds.
  const rows = matching.slice((page - 1) * pageSize, page * pageSize);

  const columns: GridColDef<ManagerItem>[] = [
    {
      field: 'title',
      headerName: 'Title',
      flex: 2,
      minWidth: 200,
      sortable: false,
      renderCell: ({ row }) => (
        <Link component={NextLink} href={`/courses/${courseId}/assignments/${row.id}`}>
          {row.title}
        </Link>
      ),
    },
    { field: 'dueAt', headerName: 'Due', flex: 1, minWidth: 150, sortable: false, valueFormatter: (v: string) => formatInSchoolTz(v, 'EEE d MMM, HH:mm', timezone) },
    {
      field: 'status',
      headerName: 'Status',
      flex: 1,
      minWidth: 170,
      sortable: false,
      renderCell: ({ row }) => (
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', height: '100%' }}>
          <Chip size="small" label={row.status.charAt(0) + row.status.slice(1).toLowerCase()} color={STATUS_COLOR[row.status]} />
          {row.archivedAt && <Chip size="small" variant="outlined" label="Archived" />}
        </Stack>
      ),
    },
    {
      field: 'submitted',
      headerName: 'Submitted',
      minWidth: 110,
      sortable: false,
      valueGetter: (_v, row) => (row.submissionType === 'NO_SUBMISSION' ? '—' : `${row.counts.submitted}/${row.counts.enrolled}`),
    },
    { field: 'graded', headerName: 'Graded', minWidth: 100, sortable: false, valueGetter: (_v, row) => `${row.counts.graded}/${row.submissionType === 'NO_SUBMISSION' ? row.counts.enrolled : row.counts.submitted}` },
    {
      field: 'actions',
      headerName: '',
      minWidth: 110,
      sortable: false,
      renderCell: ({ row }) => (
        <Button size="small" variant="outlined" component={NextLink} href={`/courses/${courseId}/assignments/${row.id}/grade`}>
          Grade
        </Button>
      ),
    },
  ];

  return <DataTable columns={columns as GridColDef[]} rows={rows} total={matching.length} />;
}
