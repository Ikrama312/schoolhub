'use client';

import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import { useToast } from '@/components/Toast/useToast';
import { scaleSchema } from '@/lib/validators/gradebook';
import type { GradingScaleDto } from '@/server/gradebook/scales-service';

type BandDraft = { key: number; letter: string; minPercent: string; gpa: string; descriptor: string };
let nextKey = 0;
const draft = (b?: { letter: string; minPercent: number; gpa?: number; descriptor?: string }): BandDraft => ({
  key: nextKey++,
  letter: b?.letter ?? '',
  minPercent: b ? String(b.minPercent) : '',
  gpa: b?.gpa === undefined ? '' : String(b.gpa),
  descriptor: b?.descriptor ?? '',
});

/** FR-16 band editor: rows of letter / min % / GPA / descriptor, Zod errors inline. */
export function ScaleEditorDialog({
  scale,
  isFirst,
  onClose,
  onSaved,
}: {
  scale: GradingScaleDto | null;
  isFirst: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const [name, setName] = useState(scale?.name ?? '');
  const [isDefault, setIsDefault] = useState(scale?.isDefault ?? isFirst);
  const [bands, setBands] = useState<BandDraft[]>(scale ? scale.bands.map(draft) : [draft({ letter: 'Pass', minPercent: 50 }), draft({ letter: 'Fail', minPercent: 0 })]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const setBand = (key: number, field: keyof Omit<BandDraft, 'key'>, value: string) => setBands((bs) => bs.map((b) => (b.key === key ? { ...b, [field]: value } : b)));

  const save = async () => {
    const payload = {
      name,
      isDefault,
      bands: bands.map((b) => ({
        letter: b.letter,
        minPercent: b.minPercent,
        ...(b.gpa.trim() ? { gpa: b.gpa } : {}),
        ...(b.descriptor.trim() ? { descriptor: b.descriptor } : {}),
      })),
    };
    const parsed = scaleSchema.safeParse(payload);
    if (!parsed.success) {
      const e: Record<string, string> = {};
      for (const i of parsed.error.issues) e[i.path.join('.')] ??= i.message;
      setErrors(e);
      setFormError(e.bands ?? null);
      return;
    }
    setErrors({});
    setFormError(null);
    setSaving(true);
    const res = await fetch(scale ? `/api/grading-scales/${scale.id}` : '/api/grading-scales', {
      method: scale ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.data),
    });
    setSaving(false);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setFormError(json?.error?.message ?? 'Could not save the scale.');
      return;
    }
    showToast({ message: 'Scale saved', severity: 'success' });
    onSaved();
  };

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{scale ? 'Edit grading scale' : 'New grading scale'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {formError && <Alert severity="error">{formError}</Alert>}
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} required error={!!errors.name} helperText={errors.name} />
          <FormControlLabel
            control={<Switch checked={isDefault} disabled={!!scale?.isDefault} onChange={(e) => setIsDefault(e.target.checked)} />}
            label={scale?.isDefault ? 'School default (make another scale default to change)' : 'School default'}
          />
          <Typography variant="subtitle2">Bands (highest first; the last band must start at 0)</Typography>
          {bands.map((b, i) => (
            <Stack key={b.key} direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'flex-start' } }}>
              <TextField size="small" label="Letter" value={b.letter} onChange={(e) => setBand(b.key, 'letter', e.target.value)} error={!!errors[`bands.${i}.letter`]} helperText={errors[`bands.${i}.letter`]} sx={{ width: { sm: 110 } }} />
              <TextField
                size="small"
                label="Min %"
                value={b.minPercent}
                onChange={(e) => setBand(b.key, 'minPercent', e.target.value)}
                error={!!errors[`bands.${i}.minPercent`]}
                helperText={errors[`bands.${i}.minPercent`]}
                slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                sx={{ width: { sm: 130 } }}
              />
              <TextField size="small" label="GPA (optional)" value={b.gpa} onChange={(e) => setBand(b.key, 'gpa', e.target.value)} error={!!errors[`bands.${i}.gpa`]} helperText={errors[`bands.${i}.gpa`]} slotProps={{ htmlInput: { inputMode: 'decimal' } }} sx={{ width: { sm: 140 } }} />
              <TextField size="small" label="Descriptor" value={b.descriptor} onChange={(e) => setBand(b.key, 'descriptor', e.target.value)} error={!!errors[`bands.${i}.descriptor`]} helperText={errors[`bands.${i}.descriptor`]} sx={{ flex: 1 }} />
              <IconButton aria-label={`Remove band ${b.letter || i + 1}`} disabled={bands.length === 1} onClick={() => setBands((bs) => bs.filter((x) => x.key !== b.key))}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Stack>
          ))}
          <Stack direction="row">
            <Button startIcon={<AddIcon />} onClick={() => setBands((bs) => [...bs, draft()])}>
              Add band
            </Button>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={saving}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
