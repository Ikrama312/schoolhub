'use client';

import { useState } from 'react';
import { fromZonedTime } from 'date-fns-tz';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { manualItemSchema } from '@/lib/validators/gradebook';

const pad = (x: number) => String(x).padStart(2, '0');

/** FR-22: title, category, max points, date, term → POST /api/courses/:id/grade-items. */
export function AddManualItemDialog({
  open,
  courseId,
  timezone,
  categories,
  terms,
  defaultTermId,
  onClose,
  onCreated,
}: {
  open: boolean;
  courseId: string;
  timezone: string;
  categories: { id: string; name: string }[];
  terms: { id: string; name: string }[];
  defaultTermId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [maxPoints, setMaxPoints] = useState('10');
  const [date, setDate] = useState<Date | null>(null);
  const [termId, setTermId] = useState(defaultTermId);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    // The picker's local calendar day is a school-local date; the item is due at the end of it.
    const dueAt = date ? fromZonedTime(`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T23:59:00`, timezone).toISOString() : null;
    const payload = { title, categoryId: categoryId || null, maxPoints, dueAt, termId };
    const parsed = manualItemSchema.safeParse(payload);
    if (!parsed.success) {
      const e: Record<string, string> = {};
      for (const i of parsed.error.issues) e[String(i.path[0])] ??= i.message;
      setErrors(e);
      return;
    }
    setErrors({});
    setSaving(true);
    const res = await fetch(`/api/courses/${courseId}/grade-items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    setSaving(false);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setFormError(json?.error?.message ?? 'Could not add the item.');
      return;
    }
    setTitle('');
    setDate(null);
    setFormError(null);
    onCreated();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add manual item</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {formError && <Alert severity="error">{formError}</Alert>}
          <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus error={!!errors.title} helperText={errors.title} />
          <TextField select label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <MenuItem value="">Uncategorised</MenuItem>
            {categories.map((c) => (
              <MenuItem key={c.id} value={c.id}>
                {c.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField label="Max points" value={maxPoints} onChange={(e) => setMaxPoints(e.target.value)} required error={!!errors.maxPoints} helperText={errors.maxPoints} slotProps={{ htmlInput: { inputMode: 'decimal' } }} />
          <DatePicker label="Date" value={date} onChange={setDate} slotProps={{ textField: { error: !!errors.dueAt, helperText: errors.dueAt ?? 'Optional; missing marks count as 0 after this date' } }} />
          <TextField select label="Term" value={termId} onChange={(e) => setTermId(e.target.value)} error={!!errors.termId} helperText={errors.termId}>
            {terms.map((t) => (
              <MenuItem key={t.id} value={t.id}>
                {t.name}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={saving}>
          Add item
        </Button>
      </DialogActions>
    </Dialog>
  );
}
