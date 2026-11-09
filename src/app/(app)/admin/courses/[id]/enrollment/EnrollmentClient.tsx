'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { GridColDef } from '@mui/x-data-grid';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { DataTable } from '@/components/DataTable/DataTable';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { UserPicker, type UserPickerOption } from '@/components/UserPicker/UserPicker';
import { useToast } from '@/components/Toast/useToast';
import { enrollStudentsSchema } from '@/lib/validators/sections';

interface RosterRow {
  enrollmentId: string;
  status: 'ACTIVE' | 'DROPPED';
  enrolledAt: string;
  droppedAt: string | null;
  student: { id: string; name: string; admissionNumber: string | null };
}
interface CourseSummary {
  id: string;
  name: string;
  code: string;
  kind: 'CORE' | 'ELECTIVE';
  capacity: number | null;
  enrolledCount: number;
  section: { id: string; name: string } | null;
}

class ConflictError extends Error {}

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = json?.error?.message ?? 'Request failed';
    throw res.status === 409 ? new ConflictError(message) : new Error(message);
  }
  return json;
}

/** A capacity CONFLICT can be retried with overrideCapacity after the admin confirms. */
type Pending = { message: string; retry: () => Promise<string> };

export function EnrollmentClient({ course, roster }: { course: CourseSummary; roster: RosterRow[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const [toAdd, setToAdd] = useState<UserPickerOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const isCore = course.kind === 'CORE';

  const run = async (fn: (override: boolean) => Promise<string>) => {
    setBusy(true);
    try {
      showToast({ message: await fn(false), severity: 'success' });
      router.refresh();
    } catch (error) {
      const message = (error as Error).message;
      if (error instanceof ConflictError && /is full/.test(message)) {
        setPending({ message, retry: () => fn(true) });
      } else {
        showToast({ message, severity: 'error' });
      }
    } finally {
      setBusy(false);
    }
  };

  const confirmOverride = async () => {
    if (!pending) return;
    const { retry } = pending;
    setPending(null);
    setBusy(true);
    try {
      showToast({ message: await retry(), severity: 'success' });
      router.refresh();
    } catch (error) {
      showToast({ message: (error as Error).message, severity: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const addStudents = () =>
    run(async (overrideCapacity) => {
      const body = enrollStudentsSchema.parse({ studentIds: toAdd.map((s) => s.id), overrideCapacity });
      const json = await send(`/api/courses/${course.id}/enrollments`, 'POST', body);
      setToAdd([]);
      return `Enrolled ${json.data.enrolled}, reactivated ${json.data.reactivated}`;
    });

  const setStatus = (row: RosterRow, status: 'ACTIVE' | 'DROPPED') =>
    run(async (overrideCapacity) => {
      await send(`/api/enrollments/${row.enrollmentId}`, 'PATCH', { status, overrideCapacity });
      return `${row.student.name} ${status === 'DROPPED' ? 'dropped' : 'reactivated'}`;
    });

  const q = (searchParams.get('q') ?? '').toLowerCase();
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Number(searchParams.get('pageSize')) || 20);
  const filtered = roster.filter((r) => !q || r.student.name.toLowerCase().includes(q));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);

  const columns: GridColDef[] = [
    {
      field: 'student',
      headerName: 'Student',
      flex: 1.5,
      sortable: false,
      renderCell: ({ row }) => <Link href={`/students/${row.student.id}`}>{row.student.name}</Link>,
    },
    {
      field: 'admissionNumber',
      headerName: 'Admission no.',
      flex: 1,
      sortable: false,
      valueGetter: (_v, row) => row.student.admissionNumber ?? '—',
    },
    {
      field: 'status',
      headerName: 'Status',
      flex: 0.8,
      sortable: false,
      renderCell: ({ row }) => (
        <Chip size="small" color={row.status === 'ACTIVE' ? 'success' : 'default'} label={row.status} />
      ),
    },
    {
      field: 'enrolledAt',
      headerName: 'Enrolled',
      flex: 1,
      sortable: false,
      valueGetter: (v) => new Date(v as string).toLocaleDateString(),
    },
    {
      field: 'actions',
      headerName: '',
      width: 130,
      sortable: false,
      renderCell: ({ row }) =>
        row.status === 'ACTIVE' ? (
          <Button size="small" color="error" disabled={busy} onClick={() => setStatus(row, 'DROPPED')}>
            Drop
          </Button>
        ) : (
          <Button size="small" disabled={busy} onClick={() => setStatus(row, 'ACTIVE')}>
            Reactivate
          </Button>
        ),
    },
  ];

  return (
    <Box>
      <PageHeader
        title={`${course.code} · ${course.name}`}
        description={`${course.enrolledCount}${course.capacity ? `/${course.capacity}` : ''} enrolled · ${course.kind}`}
        breadcrumbs={[
          { label: 'Administration' },
          { label: 'Courses', href: '/admin/courses' },
          { label: course.code, href: `/courses/${course.id}` },
          { label: 'Enrollment' },
        ]}
      />

      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600, mb: 1 }}>
          Add students
        </Typography>
        {isCore && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Core course enrollment is managed via section{' '}
            {course.section ? <Link href={`/admin/sections/${course.section.id}`}>{course.section.name}</Link> : '(none)'}.
          </Alert>
        )}
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: { md: 'center' } }}>
          <Box sx={{ flex: 1, ...(isCore ? { pointerEvents: 'none', opacity: 0.5 } : {}) }} aria-disabled={isCore}>
            <UserPicker
              label="Students"
              role="STUDENT"
              multiple
              value={toAdd}
              onChange={(v) => setToAdd((v as UserPickerOption[]) ?? [])}
            />
          </Box>
          <Button variant="contained" disabled={isCore || busy || toAdd.length === 0} onClick={addStudents}>
            Enroll
          </Button>
        </Stack>
      </Paper>

      <DataTable
        columns={columns}
        rows={visible as never}
        total={filtered.length}
        getRowId={(row) => row.enrollmentId as string}
      />

      <ConfirmDialog
        open={Boolean(pending)}
        title="Course is full"
        description={`${pending?.message ?? ''} Enroll anyway and exceed capacity?`}
        confirmLabel="Override capacity"
        onConfirm={confirmOverride}
        onCancel={() => setPending(null)}
      />
    </Box>
  );
}
