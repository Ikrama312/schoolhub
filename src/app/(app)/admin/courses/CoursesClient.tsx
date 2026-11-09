'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { GridColDef } from '@mui/x-data-grid';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { DataTable } from '@/components/DataTable/DataTable';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { UserPicker, type UserPickerOption } from '@/components/UserPicker/UserPicker';
import { useToast } from '@/components/Toast/useToast';
import { courseInputSchema, courseUpdateSchema, defaultCourseCode, defaultCourseName } from '@/lib/validators/courses';

interface Option {
  id: string;
  name: string;
}
interface SubjectOption extends Option {
  code: string;
  color: string;
}
interface SectionOption extends Option {
  academicYearId: string;
  gradeLevelId: string;
}
export interface CourseRow {
  id: string;
  code: string;
  name: string;
  kind: 'CORE' | 'ELECTIVE';
  subjectId: string;
  sectionId: string | null;
  capacity: number | null;
  description: string | null;
  archivedAt: string | null;
  subject: SubjectOption;
  section: Option | null;
  teacher: Option;
  coTeachers: Option[];
  enrolledCount: number;
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

const asPickerOption = (u: Option): UserPickerOption => ({ id: u.id, name: u.name, email: '', role: 'TEACHER' });

interface FormState {
  id?: string;
  subjectId: string;
  sectionId: string;
  teacher: UserPickerOption | null;
  coTeachers: UserPickerOption[];
  name: string;
  code: string;
  kind: 'CORE' | 'ELECTIVE';
  capacity: string;
  description: string;
  archived: boolean;
}
const emptyForm: FormState = {
  subjectId: '',
  sectionId: '',
  teacher: null,
  coTeachers: [],
  name: '',
  code: '',
  kind: 'CORE',
  capacity: '',
  description: '',
  archived: false,
};

export function CoursesClient({
  years,
  currentYearId,
  gradeLevels,
  subjects,
  sections,
  initialRows,
  initialTotal,
}: {
  years: (Option & { isCurrent: boolean })[];
  currentYearId: string | null;
  gradeLevels: Option[];
  subjects: SubjectOption[];
  sections: SectionOption[];
  initialRows: CourseRow[];
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
  const [teacherFilter, setTeacherFilter] = useState<UserPickerOption | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const yearSections = sections.filter((s) => s.academicYearId === yearId);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams(searchParams.toString());
      if (yearId) params.set('academicYearId', yearId);
      const json = await send(`/api/courses?${params.toString()}`, 'GET');
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

  const setFilter = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.set('page', '1');
    router.push(`${pathname}?${next.toString()}`);
  };

  /** Auto-fill name/code from subject + section until the admin types their own. */
  const withDefaults = (next: FormState, prev: FormState): FormState => {
    if (next.id) return next;
    const subject = subjects.find((s) => s.id === next.subjectId);
    if (!subject) return next;
    const sectionName = (id: string) => yearSections.find((s) => s.id === id)?.name ?? null;
    const prevSubject = subjects.find((s) => s.id === prev.subjectId);
    const prevName = prevSubject ? defaultCourseName(prevSubject.name, sectionName(prev.sectionId)) : '';
    const prevCode = prevSubject ? defaultCourseCode(prevSubject.code, sectionName(prev.sectionId)) : '';
    return {
      ...next,
      name: !prev.name || prev.name === prevName ? defaultCourseName(subject.name, sectionName(next.sectionId)) : next.name,
      code: !prev.code || prev.code === prevCode ? defaultCourseCode(subject.code, sectionName(next.sectionId)) : next.code,
    };
  };
  const patchForm = (patch: Partial<FormState>) => form && setForm(withDefaults({ ...form, ...patch }, form));

  const openEdit = (row: CourseRow) => {
    setErrors({});
    setForm({
      id: row.id,
      subjectId: row.subjectId,
      sectionId: row.sectionId ?? '',
      teacher: asPickerOption(row.teacher),
      coTeachers: row.coTeachers.map(asPickerOption),
      name: row.name,
      code: row.code,
      kind: row.kind,
      capacity: row.capacity == null ? '' : String(row.capacity),
      description: row.description ?? '',
      archived: Boolean(row.archivedAt),
    });
  };

  const save = async () => {
    if (!form) return;
    const common = {
      subjectId: form.subjectId,
      teacherId: form.teacher?.id ?? '',
      coTeacherIds: form.coTeachers.map((t) => t.id),
      name: form.name,
      code: form.code,
      capacity: form.capacity,
      description: form.description,
    };
    const parsed = form.id
      ? courseUpdateSchema.safeParse({ ...common, archived: form.archived })
      : courseInputSchema.safeParse({ ...common, academicYearId: yearId, sectionId: form.sectionId, kind: form.kind });
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors as Record<string, string[] | undefined>;
      setErrors(Object.fromEntries(Object.entries(fieldErrors).map(([k, v]) => [k, v?.[0] ?? ''])));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      if (form.id) await send(`/api/courses/${form.id}`, 'PATCH', parsed.data);
      else await send('/api/courses', 'POST', parsed.data);
      showToast({ message: form.id ? 'Course updated' : 'Course created', severity: 'success' });
      setForm(null);
      await load();
    } catch (error) {
      showToast({ message: (error as Error).message, severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const columns: GridColDef[] = [
    {
      field: 'code',
      headerName: 'Code',
      flex: 1,
      renderCell: ({ row }) => <Link href={`/admin/courses/${row.id}/enrollment`}>{row.code}</Link>,
    },
    { field: 'name', headerName: 'Name', flex: 1.5 },
    {
      field: 'subject',
      headerName: 'Subject',
      flex: 1,
      sortable: false,
      renderCell: ({ row }) => (
        <Chip size="small" label={row.subject.name} sx={{ bgcolor: row.subject.color, color: '#fff' }} />
      ),
    },
    { field: 'section', headerName: 'Section', flex: 0.8, sortable: false, valueGetter: (_v, row) => row.section?.name ?? '—' },
    { field: 'teacher', headerName: 'Teacher', flex: 1.2, sortable: false, valueGetter: (_v, row) => row.teacher.name },
    { field: 'enrolledCount', headerName: 'Enrolled', flex: 0.7 },
    {
      field: 'kind',
      headerName: 'Kind',
      flex: 0.8,
      sortable: false,
      renderCell: ({ row }) => (
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', height: '100%' }}>
          <Chip size="small" variant="outlined" label={row.kind} />
          {row.archivedAt && <Chip size="small" label="Archived" />}
        </Stack>
      ),
    },
    {
      field: 'actions',
      headerName: '',
      width: 60,
      sortable: false,
      renderCell: ({ row }) => (
        <Tooltip title="Edit">
          <IconButton size="small" aria-label={`Edit ${row.code}`} onClick={() => openEdit(row)}>
            <EditOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ),
    },
  ];

  const filterSelect = (key: string, label: string, options: Option[], minWidth = 160) => (
    <TextField
      select
      size="small"
      label={label}
      value={searchParams.get(key) ?? ''}
      onChange={(e) => setFilter(key, e.target.value || undefined)}
      sx={{ minWidth }}
    >
      <MenuItem value="">All</MenuItem>
      {options.map((o) => (
        <MenuItem key={o.id} value={o.id}>
          {o.name}
        </MenuItem>
      ))}
    </TextField>
  );

  return (
    <Box>
      <PageHeader
        title="Courses"
        breadcrumbs={[{ label: 'Administration' }, { label: 'Courses' }]}
        actions={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            disabled={!yearId}
            onClick={() => {
              setErrors({});
              setForm(emptyForm);
            }}
          >
            New course
          </Button>
        }
      />

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2, flexWrap: 'wrap' }} useFlexGap>
        <TextField
          select
          size="small"
          label="Academic year"
          value={yearId}
          onChange={(e) => setFilter('academicYearId', e.target.value)}
          sx={{ minWidth: 200 }}
        >
          {years.map((y) => (
            <MenuItem key={y.id} value={y.id}>
              {y.name}
              {y.isCurrent ? ' (current)' : ''}
            </MenuItem>
          ))}
        </TextField>
        {filterSelect('gradeLevelId', 'Grade', gradeLevels)}
        {filterSelect('subjectId', 'Subject', subjects)}
        {filterSelect('kind', 'Kind', [
          { id: 'CORE', name: 'Core' },
          { id: 'ELECTIVE', name: 'Elective' },
        ], 130)}
        <Box sx={{ minWidth: 240 }}>
          <UserPicker
            label="Teacher"
            role="TEACHER"
            value={teacherFilter}
            onChange={(v) => {
              const teacher = (v as UserPickerOption | null) ?? null;
              setTeacherFilter(teacher);
              setFilter('teacherId', teacher?.id);
            }}
          />
        </Box>
        <FormControlLabel
          control={
            <Switch
              checked={searchParams.get('includeArchived') === 'true'}
              onChange={(e) => setFilter('includeArchived', e.target.checked ? 'true' : undefined)}
            />
          }
          label="Show archived"
        />
      </Stack>

      <DataTable columns={columns} rows={rows as never} total={total} loading={loading} />

      <Dialog open={Boolean(form)} onClose={() => setForm(null)} fullWidth maxWidth="sm">
        <DialogTitle>{form?.id ? 'Edit course' : 'New course'}</DialogTitle>
        {form && (
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                select
                label="Kind"
                value={form.kind}
                disabled={Boolean(form.id)}
                onChange={(e) => patchForm({ kind: e.target.value as FormState['kind'] })}
                helperText={form.id ? 'Kind cannot change after creation.' : undefined}
              >
                <MenuItem value="CORE">Core (section-wide)</MenuItem>
                <MenuItem value="ELECTIVE">Elective (direct enrollment)</MenuItem>
              </TextField>
              <TextField
                select
                label="Subject"
                value={form.subjectId}
                onChange={(e) => patchForm({ subjectId: e.target.value })}
                error={Boolean(errors.subjectId)}
                helperText={errors.subjectId}
              >
                {subjects.map((s) => (
                  <MenuItem key={s.id} value={s.id}>
                    {s.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label={form.kind === 'CORE' ? 'Section' : 'Section (optional)'}
                value={form.sectionId}
                disabled={Boolean(form.id)}
                onChange={(e) => patchForm({ sectionId: e.target.value })}
                error={Boolean(errors.sectionId)}
                helperText={errors.sectionId ?? (form.id ? 'Section cannot change after creation.' : undefined)}
              >
                <MenuItem value="">None</MenuItem>
                {yearSections.map((s) => (
                  <MenuItem key={s.id} value={s.id}>
                    {s.name}
                  </MenuItem>
                ))}
              </TextField>
              <UserPicker
                label="Teacher"
                role="TEACHER"
                value={form.teacher}
                onChange={(v) => patchForm({ teacher: (v as UserPickerOption | null) ?? null })}
                error={Boolean(errors.teacherId)}
                helperText={errors.teacherId}
              />
              <UserPicker
                label="Co-teachers"
                role="TEACHER"
                multiple
                value={form.coTeachers}
                onChange={(v) => patchForm({ coTeachers: (v as UserPickerOption[]) ?? [] })}
                error={Boolean(errors.coTeacherIds)}
                helperText={errors.coTeacherIds ?? 'Up to 3'}
              />
              <TextField
                label="Name"
                value={form.name}
                onChange={(e) => patchForm({ name: e.target.value })}
                error={Boolean(errors.name)}
                helperText={errors.name}
              />
              <TextField
                label="Code"
                value={form.code}
                onChange={(e) => patchForm({ code: e.target.value.toUpperCase() })}
                error={Boolean(errors.code)}
                helperText={errors.code ?? 'Unique within the academic year'}
              />
              <TextField
                label="Capacity"
                type="number"
                value={form.capacity}
                onChange={(e) => patchForm({ capacity: e.target.value })}
                error={Boolean(errors.capacity)}
                helperText={errors.capacity ?? 'Leave blank for no limit'}
                slotProps={{ htmlInput: { min: 1 } }}
              />
              <TextField
                label="Description"
                multiline
                minRows={2}
                value={form.description}
                onChange={(e) => patchForm({ description: e.target.value })}
              />
              {form.id && (
                <FormControlLabel
                  control={<Switch checked={form.archived} onChange={(e) => patchForm({ archived: e.target.checked })} />}
                  label="Archived"
                />
              )}
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
    </Box>
  );
}
