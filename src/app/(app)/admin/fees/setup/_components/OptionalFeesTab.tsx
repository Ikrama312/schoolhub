'use client';

import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import { UserPicker, type UserPickerOption } from '@/components/UserPicker/UserPicker';
import { useToast } from '@/components/Toast/useToast';
import { sendJson, type SetupData } from './SetupTabs';

type Row = { feeItemId: string; amount: string };

/** FR-9: optional fees per student for the year, and a bulk assign for a whole section. */
export function OptionalFeesTab({ data }: { data: SetupData }) {
  const { showToast } = useToast();
  const optionalItems = data.items.filter((i) => i.isOptional);
  const [student, setStudent] = useState<UserPickerOption | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [bulk, setBulk] = useState({ sectionId: '', feeItemId: '', amount: '' });
  const yearId = data.academicYear?.id;

  useEffect(() => {
    setRows([]);
    if (!student || !yearId) return;
    fetch(`/api/fees/students/${student.id}/optional-fees?academicYearId=${yearId}`)
      .then((r) => r.json())
      .then((j) => setRows((j.data?.fees ?? []).map((f: Row) => ({ feeItemId: f.feeItemId, amount: f.amount }))))
      .catch(() => showToast({ message: 'Could not load optional fees.', severity: 'error' }));
  }, [student, yearId, showToast]);

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await action();
      showToast({ message: done, severity: 'success' });
    } catch (e) {
      showToast({ message: (e as Error).message, severity: 'error' });
    } finally {
      setBusy(false);
    }
  }

  if (!yearId) return <Alert severity="warning">Set a current academic year first.</Alert>;
  if (optionalItems.length === 0) return <Alert severity="info">Create an optional fee item (such as Bus service) first.</Alert>;

  const itemSelect = (value: string, onChange: (v: string) => void) => (
    <TextField select size="small" label="Fee item" value={value} onChange={(e) => onChange(e.target.value)} sx={{ minWidth: 200 }} disabled={!data.canWrite}>
      {optionalItems.map((i) => (
        <MenuItem key={i.id} value={i.id}>
          {i.name}
        </MenuItem>
      ))}
    </TextField>
  );

  return (
    <Stack spacing={3}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" component="h2" sx={{ mb: 2 }}>
          Per student
        </Typography>
        <Stack spacing={2}>
          <UserPicker label="Student" role="STUDENT" value={student} onChange={(v) => setStudent(v as UserPickerOption | null)} />
          {student && (
            <>
              {rows.map((r, i) => (
                <Stack key={i} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  {itemSelect(r.feeItemId, (v) => setRows(rows.map((x, j) => (j === i ? { ...x, feeItemId: v } : x))))}
                  <TextField
                    size="small"
                    label="Amount"
                    value={r.amount}
                    disabled={!data.canWrite}
                    onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value.trim() } : x)))}
                    slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                  />
                  {data.canWrite && (
                    <IconButton aria-label="Remove" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                      <DeleteOutlineIcon />
                    </IconButton>
                  )}
                </Stack>
              ))}
              {rows.length === 0 && <Typography color="text.secondary">No optional fees for this student.</Typography>}
              {data.canWrite && (
                <Stack direction="row" spacing={1}>
                  <Button
                    size="small"
                    startIcon={<AddIcon />}
                    onClick={() => setRows([...rows, { feeItemId: optionalItems[0].id, amount: optionalItems[0].defaultAmount }])}
                  >
                    Add
                  </Button>
                  <Button
                    variant="contained"
                    disabled={busy}
                    onClick={() => run(() => sendJson(`/api/fees/students/${student.id}/optional-fees`, 'PUT', { academicYearId: yearId, fees: rows }), 'Optional fees saved.')}
                  >
                    Save
                  </Button>
                </Stack>
              )}
            </>
          )}
        </Stack>
      </Paper>

      {data.canWrite && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h6" component="h2">
            Bulk assign to a section
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Every student in the section gets this fee for {data.academicYear?.name}. Existing amounts for the same item are replaced.
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
            <TextField select size="small" label="Section" value={bulk.sectionId} onChange={(e) => setBulk({ ...bulk, sectionId: e.target.value })} sx={{ minWidth: 180 }}>
              {data.sections.map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.name}
                </MenuItem>
              ))}
            </TextField>
            {itemSelect(bulk.feeItemId, (v) => setBulk({ ...bulk, feeItemId: v, amount: bulk.amount || (optionalItems.find((i) => i.id === v)?.defaultAmount ?? '') }))}
            <TextField size="small" label="Amount" value={bulk.amount} onChange={(e) => setBulk({ ...bulk, amount: e.target.value.trim() })} slotProps={{ htmlInput: { inputMode: 'decimal' } }} />
            <Button
              variant="contained"
              disabled={busy || !bulk.sectionId || !bulk.feeItemId || !bulk.amount}
              onClick={() =>
                run(async () => {
                  const r = await sendJson<{ assigned: number; updated: number }>('/api/fees/optional-fees/bulk', 'POST', { ...bulk, academicYearId: yearId });
                  showToast({ message: `${r.assigned} assigned, ${r.updated} updated.`, severity: 'info' });
                }, 'Bulk assignment done.')
              }
            >
              Assign
            </Button>
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}
