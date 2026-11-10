'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import StickyNote2OutlinedIcon from '@mui/icons-material/StickyNote2Outlined';
import { UserAvatar } from '@/components/UserAvatar/UserAvatar';
import { useToast } from '@/components/Toast/useToast';
import { registerPutBody, MINUTES_LATE_MAX, NOTE_MAX, type AttendanceStatusValue } from '@/lib/validators/attendance';
import type { Register } from '@/server/attendance/attendance-service';

type Row = { status: AttendanceStatusValue | null; minutesLate: number; note: string; noteOpen: boolean };

const OPTIONS: { value: AttendanceStatusValue; short: string; word: string; color: 'success' | 'error' | 'warning' | 'info' }[] = [
  { value: 'PRESENT', short: 'P', word: 'present', color: 'success' },
  { value: 'ABSENT', short: 'A', word: 'absent', color: 'error' },
  { value: 'LATE', short: 'L', word: 'late', color: 'warning' },
  { value: 'EXCUSED', short: 'E', word: 'excused', color: 'info' },
];

function draftKey(key: Register['key']) {
  return 'courseId' in key
    ? `attendance-draft:${key.courseId}:${key.date}:${key.periodId}`
    : `attendance-draft:section:${key.sectionId}:${key.date}:daily`;
}

function rowsFrom(register: Register): Record<string, Row> {
  const byId = new Map(register.records.map((r) => [r.studentId, r]));
  return Object.fromEntries(
    register.students.map((s) => {
      const r = byId.get(s.id);
      // PRD-15 FR-24: an approved absence note pre-fills EXCUSED; the teacher can still change it.
      const status = r?.status ?? (s.prefilled ? 'EXCUSED' : null);
      return [s.id, { status, minutesLate: r?.minutesLate ?? 5, note: r?.note ?? '', noteOpen: Boolean(r?.note) }];
    }),
  );
}

/** The only register component: course and daily registers (FR-9 to FR-17, NFR-2, NFR-4, NFR-9). */
export function RegisterForm({ initial }: { initial: Register }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [register, setRegister] = useState(initial);
  const [rows, setRows] = useState(() => rowsFrom(initial));
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Record<string, Row> | null>(null);
  const storageKey = draftKey(register.key);
  const locked = register.readOnly || saving;

  // NFR-2: offer a draft left behind by a failed save.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setDraft(JSON.parse(raw));
    } catch {
      // Corrupt/unavailable storage: nothing to restore.
    }
  }, [storageKey]);

  const counts = useMemo(() => {
    const c = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0, unmarked: 0 };
    for (const r of Object.values(rows)) {
      if (r.status) c[r.status] += 1;
      else c.unmarked += 1;
    }
    return c;
  }, [rows]);

  const update = (id: string, patch: Partial<Row>) => setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const markAllPresent = () =>
    setRows((prev) => Object.fromEntries(Object.entries(prev).map(([id, r]) => [id, r.status ? r : { ...r, status: 'PRESENT' as const }])));

  async function save() {
    const body = {
      ...register.key,
      records: Object.entries(rows).map(([studentId, r]) => ({
        studentId,
        status: r.status!,
        ...(r.status === 'LATE' ? { minutesLate: r.minutesLate } : {}),
        ...(r.note.trim() ? { note: r.note.trim() } : {}),
      })),
    };
    const parsed = registerPutBody.safeParse(body);
    if (!parsed.success) {
      showToast({ message: parsed.error.issues[0]?.message ?? 'Check the register and try again.', severity: 'error' });
      return;
    }

    setSaving(true);
    try {
      let res: Response;
      try {
        res = await fetch('/api/attendance/register', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed.data),
        });
      } catch {
        localStorage.setItem(storageKey, JSON.stringify(rows));
        showToast({ message: 'You appear to be offline. Your register was saved on this device; try again shortly.', severity: 'warning' });
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast({ message: json?.error?.message ?? 'Could not save the register.', severity: 'error' });
        return;
      }
      localStorage.removeItem(storageKey);
      setDraft(null);
      setRegister(json.data);
      setRows(rowsFrom(json.data));
      showToast({ message: 'Attendance saved', severity: 'success' });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Box sx={{ pb: 10 }}>
      {draft && !register.readOnly && (
        <Alert
          severity="info"
          sx={{ mb: 2 }}
          action={
            <Stack direction="row" spacing={1}>
              <Button color="inherit" size="small" onClick={() => { setRows({ ...rows, ...draft }); setDraft(null); }}>
                Restore
              </Button>
              <Button color="inherit" size="small" onClick={() => { localStorage.removeItem(storageKey); setDraft(null); }}>
                Discard
              </Button>
            </Stack>
          }
        >
          Restore unsaved attendance?
        </Alert>
      )}

      {register.readOnly && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {register.readOnlyReason ?? 'This register is read-only.'}
        </Alert>
      )}
      {register.updatedBy && register.updatedAt && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }} suppressHydrationWarning>
          Last changed by {register.updatedBy.name} at {new Date(register.updatedAt).toLocaleString()}
        </Typography>
      )}

      <Stack direction="row" spacing={1} useFlexGap sx={{ mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <Chip color="success" variant="outlined" label={`Present ${counts.PRESENT}`} />
        <Chip color="error" variant="outlined" label={`Absent ${counts.ABSENT}`} />
        <Chip color="warning" variant="outlined" label={`Late ${counts.LATE}`} />
        {counts.EXCUSED > 0 && <Chip color="info" variant="outlined" label={`Excused ${counts.EXCUSED}`} />}
        <Chip variant="outlined" label={`Unmarked ${counts.unmarked}`} />
        <Box sx={{ flexGrow: 1 }} />
        <Button variant="outlined" onClick={markAllPresent} disabled={locked || counts.unmarked === 0}>
          Mark all present
        </Button>
      </Stack>

      <Paper variant="outlined">
        {register.students.length === 0 && (
          <Typography sx={{ p: 2 }} color="text.secondary">
            No students are on this register for this date.
          </Typography>
        )}
        {register.students.map((s, i) => {
          const name = `${s.firstName} ${s.lastName}`;
          const row = rows[s.id];
          return (
            <Box key={s.id} sx={{ px: 2, py: 1, minHeight: 48, borderTop: i ? 1 : 0, borderColor: 'divider' }}>
              <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <UserAvatar userId={s.id} name={name} />
                <Typography sx={{ flexGrow: 1, minWidth: 120 }}>{name}</Typography>
                {s.absenceNoteId && <Chip size="small" color="info" variant="outlined" label="Absence note" />}
                <ToggleButtonGroup
                  exclusive
                  value={row.status}
                  onChange={(_, value: AttendanceStatusValue | null) => value && update(s.id, { status: value })}
                  disabled={locked}
                  aria-label={`Attendance for ${name}`}
                >
                  {OPTIONS.map((o) => (
                    <ToggleButton
                      key={o.value}
                      value={o.value}
                      color={o.color}
                      aria-label={`Mark ${name} ${o.word}`}
                      disabled={locked || (o.value === 'EXCUSED' && !(register.canExcuse || s.excusable))}
                      sx={{ minWidth: 44, minHeight: 44, fontWeight: 600 }}
                    >
                      {o.short}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
                <IconButton
                  aria-label={`${row.noteOpen ? 'Hide' : 'Add'} note for ${name}`}
                  onClick={() => update(s.id, { noteOpen: !row.noteOpen })}
                  sx={{ width: 44, height: 44 }}
                  color={row.note ? 'primary' : 'default'}
                >
                  <StickyNote2OutlinedIcon />
                </IconButton>
              </Stack>
              {(row.status === 'LATE' || row.noteOpen) && (
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1, pl: { sm: 6 } }}>
                  {row.status === 'LATE' && (
                    <TextField
                      type="number"
                      size="small"
                      label="Minutes late"
                      value={row.minutesLate}
                      disabled={locked}
                      onChange={(e) => update(s.id, { minutesLate: Number(e.target.value) })}
                      sx={{ width: { sm: 140 } }}
                      slotProps={{ htmlInput: { min: 1, max: MINUTES_LATE_MAX, 'aria-label': `Minutes late for ${name}` } }}
                    />
                  )}
                  {row.noteOpen && (
                    <TextField
                      size="small"
                      label="Note"
                      value={row.note}
                      disabled={locked}
                      onChange={(e) => update(s.id, { note: e.target.value })}
                      sx={{ flexGrow: 1 }}
                      slotProps={{ htmlInput: { maxLength: NOTE_MAX, 'aria-label': `Note for ${name}` } }}
                    />
                  )}
                </Stack>
              )}
            </Box>
          );
        })}
      </Paper>

      <Paper
        elevation={3}
        sx={{ position: 'sticky', bottom: 0, mt: 2, p: 1.5, display: 'flex', alignItems: 'center', gap: 2, zIndex: 1 }}
      >
        <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
          {register.readOnly
            ? 'Read-only'
            : counts.unmarked > 0
              ? `${counts.unmarked} student${counts.unmarked === 1 ? '' : 's'} not marked`
              : 'Everyone is marked'}
        </Typography>
        <Button variant="contained" onClick={save} disabled={locked || counts.unmarked > 0 || register.students.length === 0}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </Paper>
    </Box>
  );
}
