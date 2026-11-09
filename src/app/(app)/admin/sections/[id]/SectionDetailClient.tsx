'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { GridColDef } from '@mui/x-data-grid';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import DriveFileMoveOutlinedIcon from '@mui/icons-material/DriveFileMoveOutlined';
import { DataTable } from '@/components/DataTable/DataTable';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { UserPicker, type UserPickerOption } from '@/components/UserPicker/UserPicker';
import { useToast } from '@/components/Toast/useToast';
import { coreCoursesSchema, enrollStudentsSchema, moveSectionSchema } from '@/lib/validators/sections';

interface Option {
  id: string;
  name: string;
}
interface Student extends Option {
  email: string;
  admissionNumber: string | null;
}
interface SectionDetail {
  id: string;
  name: string;
  capacity: number;
  memberCount: number;
  gradeLevel: Option;
  homeroomTeacher: Option | null;
  room: Option | null;
  academicYear: Option;
  members: (Student & { joinedAt: string })[];
  courses: {
    id: string;
    name: string;
    code: string;
    kind: 'CORE' | 'ELECTIVE';
    archivedAt: string | null;
    subject: { id: string; color: string };
    teacher: Option;
  }[];
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

export function SectionDetailClient({
  section,
  eligibleStudents,
  subjects,
  otherSections,
}: {
  section: SectionDetail;
  eligibleStudents: Student[];
  subjects: (Option & { code: string })[];
  otherSections: Option[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();

  const [toAdd, setToAdd] = useState<Student[]>([]);
  const [overrideCapacity, setOverrideCapacity] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toRemove, setToRemove] = useState<Student | null>(null);
  const [toMove, setToMove] = useState<Student | null>(null);
  const [moveTarget, setMoveTarget] = useState('');
  const [coreOpen, setCoreOpen] = useState(false);
  const [core, setCore] = useState<Record<string, { checked: boolean; teacher: UserPickerOption | null }>>({});

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    try {
      showToast({ message: await fn(), severity: 'success' });
      router.refresh();
      return true;
    } catch (error) {
      showToast({ message: (error as Error).message, severity: 'error' });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const addStudents = () =>
    run(async () => {
      const body = enrollStudentsSchema.parse({ studentIds: toAdd.map((s) => s.id), overrideCapacity });
      const json = await send(`/api/sections/${section.id}/members`, 'POST', body);
      setToAdd([]);
      setOverrideCapacity(false);
      return `Added ${json.data.added} student(s)`;
    });

  const removeStudent = async () => {
    if (!toRemove) return;
    const student = toRemove;
    await run(async () => {
      await send(`/api/sections/${section.id}/members/${student.id}`, 'DELETE');
      return `${student.name} removed from ${section.name}`;
    });
    setToRemove(null);
  };

  const moveStudent = async () => {
    if (!toMove) return;
    const parsed = moveSectionSchema.safeParse({ toSectionId: moveTarget });
    if (!parsed.success) return showToast({ message: 'Pick a destination section', severity: 'error' });
    const student = toMove;
    const done = await run(async () => {
      await send(`/api/students/${student.id}/move-section`, 'POST', parsed.data);
      return `${student.name} moved to ${otherSections.find((s) => s.id === moveTarget)?.name ?? 'section'}`;
    });
    if (done) {
      setToMove(null);
      setMoveTarget('');
    }
  };

  const createCore = async () => {
    const items = Object.entries(core)
      .filter(([, v]) => v.checked)
      .map(([subjectId, v]) => ({ subjectId, teacherId: v.teacher?.id ?? '' }));
    const parsed = coreCoursesSchema.safeParse({ items });
    if (!parsed.success) {
      return showToast({ message: parsed.error.issues[0]?.message ?? 'Invalid selection', severity: 'error' });
    }
    const done = await run(async () => {
      const json = await send(`/api/sections/${section.id}/core-courses`, 'POST', parsed.data);
      return `Created ${json.data.courses.length} course(s), ${json.data.enrollmentsCreated} enrollment(s)`;
    });
    if (done) {
      setCoreOpen(false);
      setCore({});
    }
  };

  // Members list is small and fully loaded: filter/paginate the URL params client-side.
  const q = (searchParams.get('q') ?? '').toLowerCase();
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Number(searchParams.get('pageSize')) || 20);
  const filtered = section.members.filter(
    (m) => !q || m.name.toLowerCase().includes(q) || (m.admissionNumber ?? '').toLowerCase().includes(q),
  );
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  const existingSubjectIds = new Set(section.courses.map((c) => c.subject.id));

  const columns: GridColDef[] = [
    {
      field: 'name',
      headerName: 'Student',
      flex: 1.5,
      sortable: false,
      renderCell: ({ row }) => <Link href={`/students/${row.id}`}>{row.name}</Link>,
    },
    { field: 'admissionNumber', headerName: 'Admission no.', flex: 1, sortable: false, valueGetter: (v) => v ?? '—' },
    { field: 'email', headerName: 'Email', flex: 1.5, sortable: false },
    {
      field: 'actions',
      headerName: '',
      width: 100,
      sortable: false,
      renderCell: ({ row }) => (
        <>
          <Tooltip title="Move to section…">
            <span>
              <IconButton
                size="small"
                aria-label={`Move ${row.name} to another section`}
                disabled={otherSections.length === 0}
                onClick={() => setToMove(row)}
              >
                <DriveFileMoveOutlinedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Remove">
            <IconButton size="small" aria-label={`Remove ${row.name}`} onClick={() => setToRemove(row)}>
              <DeleteOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </>
      ),
    },
  ];

  const full = section.memberCount >= section.capacity;

  return (
    <Box>
      <PageHeader
        title={`Section ${section.name}`}
        description={`${section.gradeLevel.name} · ${section.academicYear.name} · Homeroom: ${
          section.homeroomTeacher?.name ?? '—'
        } · Room: ${section.room?.name ?? '—'}`}
        breadcrumbs={[{ label: 'Administration' }, { label: 'Sections', href: '/admin/sections' }, { label: section.name }]}
        actions={
          <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setCoreOpen(true)}>
            Create core courses
          </Button>
        }
      />

      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600, mb: 1 }}>
          Add students{' '}
          <Typography component="span" variant="body2" color={full ? 'warning.main' : 'text.secondary'}>
            ({section.memberCount}/{section.capacity})
          </Typography>
        </Typography>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: { md: 'center' } }}>
          <Autocomplete
            multiple
            sx={{ flex: 1 }}
            options={eligibleStudents}
            value={toAdd}
            onChange={(_e, v) => setToAdd(v)}
            getOptionLabel={(s) => (s.admissionNumber ? `${s.name} (${s.admissionNumber})` : s.name)}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            noOptionsText="No eligible students (same grade, not yet in a section this year)"
            renderInput={(params) => <TextField {...params} label="Eligible students" />}
          />
          <FormControlLabel
            control={<Checkbox checked={overrideCapacity} onChange={(e) => setOverrideCapacity(e.target.checked)} />}
            label="Override capacity"
          />
          <Button variant="contained" disabled={busy || toAdd.length === 0} onClick={addStudents}>
            Add
          </Button>
        </Stack>
      </Paper>

      <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600, mb: 1 }}>
        Members
      </Typography>
      <DataTable columns={columns} rows={visible as never} total={filtered.length} />

      <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600, mt: 3, mb: 1 }}>
        Courses
      </Typography>
      <Paper variant="outlined">
        {section.courses.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
            No courses yet. Use “Create core courses” to add them.
          </Typography>
        ) : (
          <List dense>
            {section.courses.map((c) => (
              <ListItem
                key={c.id}
                secondaryAction={
                  <Stack direction="row" spacing={1}>
                    <Chip size="small" label={c.kind} />
                    {c.archivedAt && <Chip size="small" label="Archived" />}
                  </Stack>
                }
              >
                <Box sx={{ width: 8, height: 32, borderRadius: 1, bgcolor: c.subject.color, mr: 2 }} />
                <ListItemText
                  primary={<Link href={`/admin/courses/${c.id}/enrollment`}>{`${c.code} · ${c.name}`}</Link>}
                  secondary={c.teacher.name}
                />
              </ListItem>
            ))}
          </List>
        )}
      </Paper>

      <ConfirmDialog
        open={Boolean(toRemove)}
        title={`Remove ${toRemove?.name ?? ''} from ${section.name}?`}
        description="Their core course enrollments for this section will be dropped (history is kept)."
        destructive
        confirmLabel="Remove"
        onConfirm={removeStudent}
        onCancel={() => setToRemove(null)}
      />

      <Dialog open={Boolean(toMove)} onClose={() => setToMove(null)} fullWidth maxWidth="xs">
        <DialogTitle>Move {toMove?.name}</DialogTitle>
        <DialogContent>
          <TextField
            select
            fullWidth
            label="Destination section"
            value={moveTarget}
            onChange={(e) => setMoveTarget(e.target.value)}
            sx={{ mt: 1 }}
          >
            {otherSections.map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.name}
              </MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setToMove(null)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="contained" onClick={moveStudent} disabled={busy || !moveTarget}>
            Move
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={coreOpen} onClose={() => setCoreOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Create core courses for {section.name}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Every current member is enrolled in each new course.
          </Typography>
          <Stack spacing={2}>
            {subjects
              .filter((s) => !existingSubjectIds.has(s.id))
              .map((s) => {
                const entry = core[s.id] ?? { checked: false, teacher: null };
                return (
                  <Stack key={s.id} direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                    <FormControlLabel
                      sx={{ minWidth: 180 }}
                      control={
                        <Checkbox
                          checked={entry.checked}
                          onChange={(e) => setCore({ ...core, [s.id]: { ...entry, checked: e.target.checked } })}
                        />
                      }
                      label={s.name}
                    />
                    <Box sx={{ flex: 1 }}>
                      <UserPicker
                        label={`${s.name} teacher`}
                        role="TEACHER"
                        value={entry.teacher}
                        onChange={(v) =>
                          setCore({
                            ...core,
                            [s.id]: { checked: true, teacher: (v as UserPickerOption | null) ?? null },
                          })
                        }
                      />
                    </Box>
                  </Stack>
                );
              })}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCoreOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="contained" onClick={createCore} disabled={busy}>
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
