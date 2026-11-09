'use client';

import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { COMMENT_MAX, termOverrideSchema } from '@/lib/validators/gradebook';
import type { StudentTermResult } from '@/server/gradebook/grade-calc';

/** FR-23: percent, letter, comment (≤ 1000) → PUT /api/courses/:id/term-overrides/:studentId. */
export function TermOverrideDialog({
  courseId,
  termId,
  student,
  result,
  letters,
  onClose,
  onSaved,
}: {
  courseId: string;
  termId: string;
  student: { id: string; firstName: string; lastName: string };
  result: StudentTermResult;
  letters: string[];
  onClose: () => void;
  onSaved: (result: StudentTermResult) => void;
}) {
  const o = result.override;
  const [percent, setPercent] = useState(o?.percent ? String(Number(o.percent)) : '');
  const [letter, setLetter] = useState(o?.letter ?? '');
  const [comment, setComment] = useState(o?.teacherComment ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const payload = { termId, percent: percent.trim() ? percent.trim() : null, letter: letter || null, teacherComment: comment.trim() ? comment : null };
    const parsed = termOverrideSchema.safeParse(payload);
    if (!parsed.success) {
      const e: Record<string, string> = {};
      for (const i of parsed.error.issues) e[String(i.path[0])] ??= i.message;
      setErrors(e);
      return;
    }
    setErrors({});
    setSaving(true);
    const res = await fetch(`/api/courses/${courseId}/term-overrides/${student.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    setSaving(false);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setFormError(json?.error?.message ?? 'Could not save the override.');
      return;
    }
    onSaved(json.data.result);
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Override term grade — {student.firstName} {student.lastName}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <DialogContentText>
            Computed: {result.computedPercent ? `${result.computedPercent}%` : '—'} {result.computedLetter ?? ''}. Leave a field blank to use the computed value; a percent alone re-derives the letter.
          </DialogContentText>
          {formError && <Alert severity="error">{formError}</Alert>}
          <Stack direction="row" spacing={2}>
            <TextField label="Percent" value={percent} onChange={(e) => setPercent(e.target.value)} error={!!errors.percent} helperText={errors.percent} slotProps={{ htmlInput: { inputMode: 'decimal' } }} />
            <TextField select label="Letter" value={letter} onChange={(e) => setLetter(e.target.value)} sx={{ minWidth: 140 }} error={!!errors.letter} helperText={errors.letter}>
              <MenuItem value="">Computed</MenuItem>
              {letters.map((l) => (
                <MenuItem key={l} value={l}>
                  {l}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <TextField
            label="Teacher comment (appears on the report card)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            multiline
            minRows={3}
            error={!!errors.teacherComment}
            helperText={errors.teacherComment ?? `${comment.length} / ${COMMENT_MAX}`}
            slotProps={{ htmlInput: { maxLength: COMMENT_MAX } }}
          />
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
