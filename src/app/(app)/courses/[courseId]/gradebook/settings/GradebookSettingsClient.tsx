'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import { useToast } from '@/components/Toast/useToast';
import { categoriesPutSchema, weightSum } from '@/lib/validators/gradebook';

type Row = { key: string; id?: string; name: string; weightPercent: string; dropLowest: string };
interface Initial {
  gradingScaleId: string | null;
  categories: { id: string; name: string; weightPercent: string; dropLowest: number; order: number }[];
}

let n = 0;
const strip = (v: string) => String(Number(v));

/** FR-17: category rows with a live Σ weights / 100 chip; Save is disabled until it is 100. */
export function GradebookSettingsClient({ courseId, initial, scales }: { courseId: string; initial: Initial; scales: { id: string; name: string; isDefault: boolean }[] }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [rows, setRows] = useState<Row[]>(
    initial.categories.map((c) => ({ key: c.id, id: c.id, name: c.name, weightPercent: strip(c.weightPercent), dropLowest: String(c.dropLowest) })),
  );
  const [scaleId, setScaleId] = useState(initial.gradingScaleId ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const sum = weightSum(rows);
  const sumOk = rows.length === 0 || Number(sum) === 100;
  const update = (key: string, field: 'name' | 'weightPercent' | 'dropLowest', value: string) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  const move = (i: number, d: -1 | 1) =>
    setRows((rs) => {
      const next = [...rs];
      [next[i], next[i + d]] = [next[i + d], next[i]];
      return next;
    });

  const save = async () => {
    const payload = {
      categories: rows.map((r, order) => ({ ...(r.id ? { id: r.id } : {}), name: r.name, weightPercent: r.weightPercent, dropLowest: r.dropLowest || 0, order })),
      gradingScaleId: scaleId || null,
    };
    const parsed = categoriesPutSchema.safeParse(payload);
    if (!parsed.success) {
      const e: Record<string, string> = {};
      for (const i of parsed.error.issues) e[i.path.join('.')] ??= i.message;
      setErrors(e);
      return;
    }
    setErrors({});
    setFormError(null);
    setSaving(true);
    const res = await fetch(`/api/courses/${courseId}/grade-categories`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    setSaving(false);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setFormError(json?.error?.message ?? 'Could not save.');
      return;
    }
    setRows(json.data.categories.map((c: Initial['categories'][number]) => ({ key: c.id, id: c.id, name: c.name, weightPercent: strip(c.weightPercent), dropLowest: String(c.dropLowest) })));
    showToast({ message: 'Gradebook settings saved', severity: 'success' });
    router.refresh();
  };

  return (
    <Stack spacing={3}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={2}>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="h6" component="h2">
              Categories
            </Typography>
            <Chip
              aria-live="polite"
              color={sumOk ? 'success' : 'error'}
              variant={sumOk ? 'outlined' : 'filled'}
              label={`Weights total ${Number(sum)} / 100`}
            />
          </Stack>
          {rows.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              No categories: the term grade is total points earned over total possible.
            </Typography>
          )}
          {formError && <Alert severity="error">{formError}</Alert>}
          {rows.map((r, i) => (
            <Stack key={r.key} direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'flex-start' } }}>
              <TextField size="small" label="Name" value={r.name} onChange={(e) => update(r.key, 'name', e.target.value)} error={!!errors[`categories.${i}.name`]} helperText={errors[`categories.${i}.name`]} sx={{ flex: 1 }} />
              <TextField
                size="small"
                label="Weight %"
                value={r.weightPercent}
                onChange={(e) => update(r.key, 'weightPercent', e.target.value)}
                error={!!errors[`categories.${i}.weightPercent`]}
                helperText={errors[`categories.${i}.weightPercent`]}
                slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                sx={{ width: { sm: 130 } }}
              />
              <TextField
                size="small"
                label="Drop lowest"
                value={r.dropLowest}
                onChange={(e) => update(r.key, 'dropLowest', e.target.value)}
                error={!!errors[`categories.${i}.dropLowest`]}
                helperText={errors[`categories.${i}.dropLowest`]}
                slotProps={{ htmlInput: { inputMode: 'numeric' } }}
                sx={{ width: { sm: 130 } }}
              />
              <Stack direction="row">
                <IconButton aria-label={`Move ${r.name || 'category'} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUpwardIcon fontSize="small" />
                </IconButton>
                <IconButton aria-label={`Move ${r.name || 'category'} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDownwardIcon fontSize="small" />
                </IconButton>
                <IconButton aria-label={`Remove ${r.name || 'category'}`} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Stack>
            </Stack>
          ))}
          <Stack direction="row">
            <Button startIcon={<AddIcon />} onClick={() => setRows((rs) => [...rs, { key: `new-${n++}`, name: '', weightPercent: '0', dropLowest: '0' }])} disabled={rows.length >= 20}>
              Add category
            </Button>
          </Stack>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={2}>
          <Typography variant="h6" component="h2">
            Grading scale
          </Typography>
          <TextField select label="Scale" value={scaleId} onChange={(e) => setScaleId(e.target.value)} sx={{ maxWidth: 360 }} error={!!errors.gradingScaleId} helperText={errors.gradingScaleId}>
            <MenuItem value="">School default{scales.find((s) => s.isDefault) ? ` (${scales.find((s) => s.isDefault)!.name})` : ''}</MenuItem>
            {scales.map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.name}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </Paper>

      <Stack direction="row" spacing={1}>
        <Button variant="contained" onClick={save} disabled={saving || !sumOk}>
          Save
        </Button>
        {!sumOk && (
          <Typography variant="body2" color="error" sx={{ alignSelf: 'center' }}>
            Weights must total 100 before saving.
          </Typography>
        )}
      </Stack>
    </Stack>
  );
}
