'use client';

import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
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

type Row = { discountId: string; note: string };

/** FR-10: manual discounts (scholarships) per student per year. Sibling discounts apply automatically. */
export function StudentDiscountsTab({ data }: { data: SetupData }) {
  const { showToast } = useToast();
  const manual = data.discounts.filter((d) => !d.autoRule);
  const [student, setStudent] = useState<UserPickerOption | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const yearId = data.academicYear?.id;

  useEffect(() => {
    setRows([]);
    if (!student || !yearId) return;
    fetch(`/api/fees/students/${student.id}/discounts?academicYearId=${yearId}`)
      .then((r) => r.json())
      .then((j) => setRows((j.data?.discounts ?? []).map((d: { discountId: string; note: string | null }) => ({ discountId: d.discountId, note: d.note ?? '' }))))
      .catch(() => showToast({ message: 'Could not load discounts.', severity: 'error' }));
  }, [student, yearId, showToast]);

  async function save() {
    if (!student) return;
    setBusy(true);
    try {
      await sendJson(`/api/fees/students/${student.id}/discounts`, 'PUT', {
        academicYearId: yearId,
        discounts: rows.map((r) => ({ discountId: r.discountId, note: r.note || null })),
      });
      showToast({ message: 'Student discounts saved. They apply to invoices generated from now on.', severity: 'success' });
    } catch (e) {
      showToast({ message: (e as Error).message, severity: 'error' });
    } finally {
      setBusy(false);
    }
  }

  if (!yearId) return <Alert severity="warning">Set a current academic year first.</Alert>;
  if (manual.length === 0) return <Alert severity="info">Create a manual discount (such as a scholarship) first.</Alert>;

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={2}>
        <UserPicker label="Student" role="STUDENT" value={student} onChange={(v) => setStudent(v as UserPickerOption | null)} />
        {student && (
          <>
            {rows.map((r, i) => (
              <Stack key={i} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <TextField
                  select
                  size="small"
                  label="Discount"
                  value={r.discountId}
                  disabled={!data.canWrite}
                  onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, discountId: e.target.value } : x)))}
                  sx={{ minWidth: 220 }}
                >
                  {manual.map((d) => (
                    <MenuItem key={d.id} value={d.id}>
                      {d.name}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  size="small"
                  label="Note"
                  value={r.note}
                  disabled={!data.canWrite}
                  sx={{ flex: 1 }}
                  onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))}
                  slotProps={{ htmlInput: { maxLength: 500 } }}
                />
                {data.canWrite && (
                  <IconButton aria-label="Remove" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                    <DeleteOutlineIcon />
                  </IconButton>
                )}
              </Stack>
            ))}
            {rows.length === 0 && <Typography color="text.secondary">No manual discounts for this student.</Typography>}
            {data.canWrite && (
              <Stack direction="row" spacing={1}>
                <Button size="small" startIcon={<AddIcon />} onClick={() => setRows([...rows, { discountId: manual[0].id, note: '' }])}>
                  Add
                </Button>
                <Button variant="contained" onClick={save} disabled={busy}>
                  Save
                </Button>
              </Stack>
            )}
          </>
        )}
      </Stack>
    </Paper>
  );
}
