'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { GridColDef } from '@mui/x-data-grid';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { DataTable } from '@/components/DataTable/DataTable';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { UserPicker, type UserPickerOption } from '@/components/UserPicker/UserPicker';
import { useToast } from '@/components/Toast/useToast';
import { sectionInputSchema } from '@/lib/validators/sections';

interface Option {
  id: string;
  name: string;
}
interface YearOption extends Option {
  isCurrent: boolean;
  isCopyTarget: boolean;
}
export interface SectionRow {
  id: string;
  name: string;
  academicYearId: string;
  gradeLevelId: string;
  gradeLevel: { id: string; name: string };
  homeroomTeacher: Option | null;
  roomId: string | null;
  room: Option | null;
  capacity: number;
  memberCount: number;
  courseCount: number;
}

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message ?? 'Request failed');
  return json;
}

interface FormState {
  id?: string;
  gradeLevelId: string;
  name: string;
  homeroomTeacher: UserPickerOption | null;
  roomId: string;
  capacity: string;
}
const emptyForm: FormState = { gradeLevelId: '', name: '', homeroomTeacher: null, roomId: '', capacity: '30' };

export function SectionsClient({
  years,
  currentYearId,
  gradeLevels,
  rooms,
  initialRows,
  initialTotal,
}: {
  years: YearOption[];
  currentYearId: string | null;
  gradeLevels: Option[];
  rooms: Option[];
  initialRows: SectionRow[];
  initialTotal: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const yearId = searchParams.get('academicYearId') ?? currentYearId ?? '';

  const [rows, setRows] = useState(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<SectionRow | null>(null);
  const [confirmCopy, setConfirmCopy] = useState(false);

  const copyTarget = years.find((y) => y.isCopyTarget && y.id !== yearId) ?? null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams(searchParams.toString());
      if (yearId) params.set('academicYearId', yearId);
      const json = await send(`/api/sections?${params.toString()}`, 'GET');
      setRows(json.data);
      setTotal(json.meta.total);
    } catch (error) {
      showToast({ message: (error as Error).message, severity: 'error' });
    } finally {
      setLoading(false);
    }
  }, [searchParams, yearId, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const setYear = (id: string) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set('academicYearId', id);
    next.set('page', '1');
    router.push(`${pathname}?${next.toString()}`);
  };

  const openEdit = (row: SectionRow) =>
    setForm({
      id: row.id,
      gradeLevelId: row.gradeLevelId,
      name: row.name,
      homeroomTeacher: row.homeroomTeacher
        ? { id: row.homeroomTeacher.id, name: row.homeroomTeacher.name, email: '', role: 'TEACHER' }
        : null,
      roomId: row.roomId ?? '',
      capacity: String(row.capacity),
    });

  const save = async () => {
    if (!form) return;
    const payload = {
      academicYearId: yearId,
      gradeLevelId: form.gradeLevelId,
      name: form.name,
      homeroomTeacherId: form.homeroomTeacher?.id ?? null,
      roomId: form.roomId || null,
      capacity: form.capacity,
    };
    const parsed = sectionInputSchema.safeParse(payload);
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      setErrors(Object.fromEntries(Object.entries(fieldErrors).map(([k, v]) => [k, v?.[0] ?? ''])));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      if (form.id) {
        const { academicYearId: _ignored, ...update } = parsed.data;
        await send(`/api/sections/${form.id}`, 'PATCH', update);
      } else {
        await send('/api/sections', 'POST', parsed.data);
      }
      showToast({ message: form.id ? 'Section updated' : 'Section created', severity: 'success' });
      setForm(null);
      await load();
    } catch (error) {
      showToast({ message: (error as Error).message, severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!toDelete) return;
    try {
      await send(`/api/sections/${toDelete.id}`, 'DELETE');
      showToast({ message: `Section ${toDelete.name} deleted`, severity: 'success' });
      await load();
    } catch (error) {
      showToast({ message: (error as Error).message, severity: 'error' });
    } finally {
      setToDelete(null);
    }
  };

  const copy = async () => {
    if (!copyTarget) return;
    try {
      const json = await send('/api/sections/copy-to-year', 'POST', { fromYearId: yearId, toYearId: copyTarget.id });
      const skipped = json.data.skipped as { name: string; reason: string }[];
      showToast({
        message: `Copied ${json.data.created} section(s) to ${copyTarget.name}.${
          skipped.length ? ` Skipped: ${skipped.map((s) => `${s.name} (${s.reason})`).join(', ')}` : ''
        }`,
        severity: skipped.length ? 'warning' : 'success',
      });
    } catch (error) {
      showToast({ message: (error as Error).message, severity: 'error' });
    } finally {
      setConfirmCopy(false);
    }
  };

  const columns: GridColDef[] = [
    {
      field: 'name',
      headerName: 'Name',
      flex: 1,
      renderCell: ({ row }) => <Link href={`/admin/sections/${row.id}`}>{row.name}</Link>,
    },
    { field: 'gradeLevel', headerName: 'Grade', flex: 1, valueGetter: (_v, row) => row.gradeLevel?.name },
    {
      field: 'homeroomTeacher',
      headerName: 'Homeroom teacher',
      flex: 1.5,
      sortable: false,
      valueGetter: (_v, row) => row.homeroomTeacher?.name ?? '—',
    },
    { field: 'room', headerName: 'Room', flex: 1, sortable: false, valueGetter: (_v, row) => row.room?.name ?? '—' },
    {
      field: 'memberCount',
      headerName: 'Members',
      flex: 1,
      renderCell: ({ row }) => (
        <Typography
          variant="body2"
          sx={{ color: row.memberCount >= row.capacity * 0.9 ? 'warning.main' : 'text.primary', lineHeight: 'inherit' }}
        >
          {row.memberCount}/{row.capacity}
        </Typography>
      ),
    },
    { field: 'courseCount', headerName: 'Courses', flex: 0.7, sortable: false },
    {
      field: 'actions',
      headerName: '',
      sortable: false,
      width: 100,
      renderCell: ({ row }) => (
        <>
          <Tooltip title="Edit">
            <IconButton size="small" aria-label={`Edit ${row.name}`} onClick={() => openEdit(row)}>
              <EditOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete">
            <IconButton size="small" aria-label={`Delete ${row.name}`} onClick={() => setToDelete(row)}>
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </>
      ),
    },
  ];

  return (
    <Box>
      <PageHeader
        title="Sections"
        breadcrumbs={[{ label: 'Administration' }, { label: 'Sections' }]}
        actions={
          <Stack direction="row" spacing={1}>
            <Tooltip title={copyTarget ? `Copy into ${copyTarget.name}` : 'Requires a future, non-current academic year'}>
              <span>
                <Button
                  startIcon={<ContentCopyIcon />}
                  disabled={!copyTarget || !yearId}
                  onClick={() => setConfirmCopy(true)}
                >
                  Copy sections to next year
                </Button>
              </span>
            </Tooltip>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              disabled={!yearId}
              onClick={() => {
                setErrors({});
                setForm(emptyForm);
              }}
            >
              New section
            </Button>
          </Stack>
        }
      />

      <TextField
        select
        size="small"
        label="Academic year"
        value={yearId}
        onChange={(e) => setYear(e.target.value)}
        sx={{ mb: 2, minWidth: 220 }}
      >
        {years.map((y) => (
          <MenuItem key={y.id} value={y.id}>
            {y.name}
            {y.isCurrent ? ' (current)' : ''}
          </MenuItem>
        ))}
      </TextField>

      <DataTable columns={columns} rows={rows as never} total={total} loading={loading} />

      <Dialog open={Boolean(form)} onClose={() => setForm(null)} fullWidth maxWidth="sm">
        <DialogTitle>{form?.id ? 'Edit section' : 'New section'}</DialogTitle>
        {form && (
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                select
                label="Grade level"
                value={form.gradeLevelId}
                onChange={(e) => setForm({ ...form, gradeLevelId: e.target.value })}
                error={Boolean(errors.gradeLevelId)}
                helperText={errors.gradeLevelId}
              >
                {gradeLevels.map((g) => (
                  <MenuItem key={g.id} value={g.id}>
                    {g.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                error={Boolean(errors.name)}
                helperText={errors.name ?? 'e.g. 7A'}
              />
              <UserPicker
                label="Homeroom teacher"
                role="TEACHER"
                value={form.homeroomTeacher}
                onChange={(v) => setForm({ ...form, homeroomTeacher: (v as UserPickerOption | null) ?? null })}
                error={Boolean(errors.homeroomTeacherId)}
                helperText={errors.homeroomTeacherId ?? 'A teacher can be homeroom teacher of one section per year.'}
              />
              <TextField
                select
                label="Room"
                value={form.roomId}
                onChange={(e) => setForm({ ...form, roomId: e.target.value })}
              >
                <MenuItem value="">None</MenuItem>
                {rooms.map((r) => (
                  <MenuItem key={r.id} value={r.id}>
                    {r.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Capacity"
                type="number"
                value={form.capacity}
                onChange={(e) => setForm({ ...form, capacity: e.target.value })}
                error={Boolean(errors.capacity)}
                helperText={errors.capacity ?? '1–60'}
                slotProps={{ htmlInput: { min: 1, max: 60 } }}
              />
            </Stack>
          </DialogContent>
        )}
        <DialogActions>
          <Button onClick={() => setForm(null)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="contained" onClick={save} disabled={saving}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={Boolean(toDelete)}
        title={`Delete section ${toDelete?.name ?? ''}?`}
        description="Only sections without members or courses can be deleted."
        destructive
        confirmLabel="Delete"
        onConfirm={remove}
        onCancel={() => setToDelete(null)}
      />
      <ConfirmDialog
        open={confirmCopy}
        title={`Copy sections to ${copyTarget?.name ?? ''}?`}
        description="Copies names, rooms and capacities with the grade level advanced by one. Members, homeroom teachers and courses are not copied."
        confirmLabel="Copy"
        onConfirm={copy}
        onCancel={() => setConfirmCopy(false)}
      />
    </Box>
  );
}
