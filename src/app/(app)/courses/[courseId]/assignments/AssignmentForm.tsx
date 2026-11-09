'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import NextLink from 'next/link';
import { Controller, useForm } from 'react-hook-form';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { MarkdownEditor } from '@/components/MarkdownEditor/MarkdownEditor';
import { FileUpload, type FileRef } from '@/components/FileUpload/FileUpload';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { useToast } from '@/components/Toast/useToast';
import { assignmentInput, INSTRUCTIONS_MAX, TITLE_MAX } from '@/lib/validators/assignments';
import type { AssignmentDto } from '@/server/assignments/assignments-service';
import { RubricBuilder, rubricSumError, type CriterionDraft } from './RubricBuilder';

type Status = 'DRAFT' | 'SCHEDULED' | 'PUBLISHED';

interface FormValues {
  title: string;
  instructions: string;
  submissionType: 'ONLINE_TEXT' | 'FILE_UPLOAD' | 'TEXT_AND_FILE' | 'NO_SUBMISSION';
  maxPoints: string;
  /** Wall-clock Dates in the school timezone (the picker's local fields = school time). */
  dueAt: Date | null;
  availableFrom: Date | null;
  allowLate: boolean;
  lateCutoffAt: Date | null;
  latePenaltyPercentPerDay: string;
  maxLatePenaltyPercent: string;
  maxFileCount: string;
  allowExtraCredit: boolean;
}

const TYPE_LABELS: Record<FormValues['submissionType'], string> = {
  ONLINE_TEXT: 'Online text',
  FILE_UPLOAD: 'File upload',
  TEXT_AND_FILE: 'Text and file',
  NO_SUBMISSION: 'No submission (graded offline)',
};

export interface AssignmentFormProps {
  courseId: string;
  timezone: string;
  /** NFR-16 default: next teaching day 23:59 (server-computed). */
  defaultDueAt: string;
  initial?: AssignmentDto;
  submissionCount?: number;
  managedCourses: { id: string; name: string; code: string }[];
}

/** FR-9..FR-15: one form for create and edit. Validated with the shared assignmentInput schema. */
export function AssignmentForm({ courseId, timezone, defaultDueAt, initial, submissionCount = 0, managedCourses }: AssignmentFormProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const toWall = (iso: string | null | undefined) => (iso ? toZonedTime(iso, timezone) : null);
  const fromWall = (d: Date | null) => (d ? fromZonedTime(d, timezone).toISOString() : null);

  const { control, handleSubmit, watch, setError, formState } = useForm<FormValues>({
    defaultValues: {
      title: initial?.title ?? '',
      instructions: initial?.instructions ?? '',
      submissionType: initial?.submissionType ?? 'FILE_UPLOAD',
      maxPoints: initial ? String(Number(initial.maxPoints)) : '100',
      dueAt: toWall(initial?.dueAt ?? defaultDueAt),
      availableFrom: toWall(initial?.availableFrom),
      allowLate: initial?.allowLate ?? false,
      lateCutoffAt: toWall(initial?.lateCutoffAt),
      latePenaltyPercentPerDay: initial ? String(Number(initial.latePenaltyPercentPerDay)) : '10',
      maxLatePenaltyPercent: initial ? String(Number(initial.maxLatePenaltyPercent)) : '50',
      maxFileCount: String(initial?.maxFileCount ?? 3),
      allowExtraCredit: initial?.allowExtraCredit ?? false,
    },
  });
  const [attachments, setAttachments] = useState<FileRef[]>(initial?.attachments ?? []);
  const [useRubric, setUseRubric] = useState(!!initial?.rubric?.length);
  const [rubric, setRubric] = useState<CriterionDraft[]>(
    initial?.rubric?.map((c) => ({
      key: c.id,
      id: c.id,
      title: c.title,
      description: c.description,
      maxPoints: String(Number(c.maxPoints)),
      levels: c.levels.map((l) => ({ label: l.label, points: String(Number(l.points)), description: l.description })),
    })) ?? [],
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [reviewBanner, setReviewBanner] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const [dupTargets, setDupTargets] = useState<{ id: string; name: string; code: string }[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const maxPoints = watch('maxPoints');
  const allowLate = watch('allowLate');
  const submissionType = watch('submissionType');
  const sumError = useRubric ? rubricSumError(rubric, maxPoints) : null;
  const editingWithWork = !!initial && submissionCount > 0;

  async function save(values: FormValues, status: Status) {
    setFormError(null);
    const payload = {
      title: values.title,
      instructions: values.instructions,
      submissionType: values.submissionType,
      maxPoints: values.maxPoints,
      dueAt: fromWall(values.dueAt),
      availableFrom: fromWall(values.availableFrom),
      allowLate: values.allowLate,
      lateCutoffAt: values.allowLate ? fromWall(values.lateCutoffAt) : null,
      latePenaltyPercentPerDay: values.allowLate ? values.latePenaltyPercentPerDay : '0',
      maxLatePenaltyPercent: values.allowLate ? values.maxLatePenaltyPercent : '0',
      maxFileCount: values.maxFileCount,
      allowExtraCredit: values.allowExtraCredit,
      status,
      rubric: useRubric && rubric.length ? rubric.map(({ key: _key, ...c }) => c) : null,
      attachmentFileIds: attachments.map((f) => f.id),
    };
    const parsed = assignmentInput.safeParse(payload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof FormValues | 'rubric';
        if (field === 'rubric' || !(field in values)) setFormError(issue.message);
        else setError(field, { message: issue.message });
      }
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(initial ? `/api/assignments/${initial.id}` : `/api/courses/${courseId}/assignments`, {
        method: initial ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const fieldErrors = json?.error?.details?.fieldErrors as Record<string, string[]> | undefined;
        for (const [field, msgs] of Object.entries(fieldErrors ?? {})) {
          if (field in values) setError(field as keyof FormValues, { message: msgs[0] });
        }
        setFormError(json?.error?.message ?? 'Could not save the assignment.');
        return;
      }
      const saved = json.data as AssignmentDto;
      showToast({ message: status === 'DRAFT' ? 'Draft saved' : status === 'SCHEDULED' ? 'Assignment scheduled' : 'Assignment published', severity: 'success' });
      // FR-14 / D15: scores are kept when max points change; prompt a review instead of recalculating.
      if (initial && editingWithWork && Number(initial.maxPoints) !== Number(values.maxPoints)) {
        setReviewBanner(true);
        router.refresh();
        return;
      }
      router.push(`/courses/${courseId}/assignments/${saved.id}`);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function duplicate() {
    if (!initial) return;
    const res = await fetch(`/api/assignments/${initial.id}/duplicate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ courseIds: dupTargets.map((c) => c.id) }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast({ message: json?.error?.message ?? 'Could not duplicate.', severity: 'error' });
      return;
    }
    showToast({ message: `Copied as a draft to ${dupTargets.length} course${dupTargets.length === 1 ? '' : 's'}`, severity: 'success' });
    setDupOpen(false);
    setDupTargets([]);
  }

  async function remove() {
    if (!initial) return;
    const res = await fetch(`/api/assignments/${initial.id}`, { method: 'DELETE' });
    const json = await res.json().catch(() => ({}));
    setDeleteOpen(false);
    if (!res.ok) {
      showToast({ message: json?.error?.message ?? 'Could not delete.', severity: 'error' });
      return;
    }
    showToast({ message: json.data.result === 'archived' ? 'Assignment archived' : 'Assignment deleted', severity: 'success' });
    router.push(`/courses/${courseId}/assignments`);
    router.refresh();
  }

  const submitAs = (status: Status) => handleSubmit((v) => save(v, status));
  const err = (name: keyof FormValues) => formState.errors[name]?.message;
  const pickerSlot = (name: keyof FormValues, helper?: string) => ({
    textField: { fullWidth: true, error: !!err(name), helperText: err(name) ?? helper },
  });

  return (
    <Box component="form" noValidate onSubmit={(e) => e.preventDefault()}>
      {reviewBanner && (
        <Alert severity="info" sx={{ mb: 2 }} action={<Button component={NextLink} href={`/courses/${courseId}/assignments/${initial?.id}/grade`} color="inherit" size="small">Review grades</Button>}>
          Max points changed. Existing scores were kept — review grades for this assignment.
        </Alert>
      )}
      {editingWithWork && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {submissionCount} student{submissionCount === 1 ? ' has' : 's have'} already submitted. Changing the due date or max points will not recalculate existing scores.
        </Alert>
      )}
      <Stack spacing={3}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Controller
              name="title"
              control={control}
              render={({ field }) => (
                <TextField {...field} label="Title" required fullWidth error={!!err('title')} helperText={err('title')} slotProps={{ htmlInput: { maxLength: TITLE_MAX } }} />
              )}
            />
            <Controller
              name="instructions"
              control={control}
              render={({ field }) => (
                <MarkdownEditor label="Instructions" value={field.value} onChange={field.onChange} maxLength={INSTRUCTIONS_MAX} error={err('instructions')} />
              )}
            />
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Attachments
              </Typography>
              <FileUpload context="assignment" max={10} value={attachments} onChange={setAttachments} />
            </Box>
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <Controller
                name="submissionType"
                control={control}
                render={({ field }) => (
                  <TextField {...field} select label="Submission type" fullWidth>
                    {Object.entries(TYPE_LABELS).map(([value, label]) => (
                      <MenuItem key={value} value={value}>
                        {label}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
              <Controller
                name="maxPoints"
                control={control}
                render={({ field }) => (
                  <TextField {...field} label="Max points" required fullWidth error={!!err('maxPoints')} helperText={err('maxPoints')} slotProps={{ htmlInput: { inputMode: 'decimal' } }} />
                )}
              />
              {(submissionType === 'FILE_UPLOAD' || submissionType === 'TEXT_AND_FILE') && (
                <Controller
                  name="maxFileCount"
                  control={control}
                  render={({ field }) => (
                    <TextField {...field} label="Max files" type="number" fullWidth error={!!err('maxFileCount')} helperText={err('maxFileCount')} slotProps={{ htmlInput: { min: 1, max: 10 } }} />
                  )}
                />
              )}
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <Controller
                name="dueAt"
                control={control}
                render={({ field }) => (
                  <DateTimePicker label="Due" value={field.value} onChange={field.onChange} ampm={false} slotProps={pickerSlot('dueAt', `School time (${timezone})`)} />
                )}
              />
              <Controller
                name="availableFrom"
                control={control}
                render={({ field }) => (
                  <DateTimePicker label="Available from (for Schedule)" value={field.value} onChange={field.onChange} ampm={false} slotProps={pickerSlot('availableFrom', 'Optional')} />
                )}
              />
            </Stack>
            <Controller
              name="allowExtraCredit"
              control={control}
              render={({ field }) => (
                <FormControlLabel control={<Switch checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />} label="Allow extra credit (raw score up to 120 %)" />
              )}
            />
            <Divider />
            <Controller
              name="allowLate"
              control={control}
              render={({ field }) => (
                <FormControlLabel control={<Switch checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />} label="Allow late submissions" />
              )}
            />
            {allowLate && (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <Controller
                  name="lateCutoffAt"
                  control={control}
                  render={({ field }) => (
                    <DateTimePicker label="Late cutoff" value={field.value} onChange={field.onChange} ampm={false} slotProps={pickerSlot('lateCutoffAt', 'Optional — blank means no cutoff')} />
                  )}
                />
                <Controller
                  name="latePenaltyPercentPerDay"
                  control={control}
                  render={({ field }) => (
                    <TextField {...field} label="Penalty % per day" fullWidth error={!!err('latePenaltyPercentPerDay')} helperText={err('latePenaltyPercentPerDay')} />
                  )}
                />
                <Controller
                  name="maxLatePenaltyPercent"
                  control={control}
                  render={({ field }) => (
                    <TextField {...field} label="Maximum penalty %" fullWidth error={!!err('maxLatePenaltyPercent')} helperText={err('maxLatePenaltyPercent')} />
                  )}
                />
              </Stack>
            )}
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <FormControlLabel control={<Switch checked={useRubric} onChange={(e) => setUseRubric(e.target.checked)} />} label="Grade with a rubric" />
          {useRubric && (
            <Box sx={{ mt: 2 }}>
              <RubricBuilder value={rubric} onChange={setRubric} maxPoints={maxPoints} />
            </Box>
          )}
        </Paper>

        {formError && (
          <Alert severity="error" role="alert">
            {formError}
          </Alert>
        )}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: 'flex-end' }}>
          {initial && (
            <>
              <Button color="error" onClick={() => setDeleteOpen(true)} disabled={saving}>
                Delete
              </Button>
              <Button onClick={() => setDupOpen(true)} disabled={saving}>
                Duplicate to other courses
              </Button>
              <Box sx={{ flex: 1 }} />
            </>
          )}
          <Button variant="outlined" onClick={submitAs('DRAFT')} disabled={saving || !!sumError}>
            Save draft
          </Button>
          <Button variant="outlined" onClick={submitAs('SCHEDULED')} disabled={saving || !!sumError}>
            Schedule
          </Button>
          <Button variant="contained" onClick={submitAs('PUBLISHED')} disabled={saving || !!sumError}>
            {initial?.status === 'PUBLISHED' ? 'Save' : 'Publish'}
          </Button>
        </Stack>
      </Stack>

      <Dialog open={dupOpen} onClose={() => setDupOpen(false)} fullWidth maxWidth="sm" aria-labelledby="dup-title">
        <DialogTitle id="dup-title">Duplicate to other courses</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Copies are created as drafts with the same instructions, attachments, settings, rubric and due date.
          </Typography>
          <Autocomplete
            multiple
            options={managedCourses.filter((c) => c.id !== courseId)}
            getOptionLabel={(c) => `${c.name} (${c.code})`}
            value={dupTargets}
            onChange={(_e, v) => setDupTargets(v)}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            renderInput={(params) => <TextField {...params} label="Courses" />}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDupOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => void duplicate()} disabled={dupTargets.length === 0}>
            Duplicate
          </Button>
        </DialogActions>
      </Dialog>
      <ConfirmDialog
        open={deleteOpen}
        title="Delete this assignment?"
        description={submissionCount > 0 ? 'It has submissions, so it will be archived: hidden from students and parents, but kept for grading records.' : 'It has no submissions and will be permanently deleted.'}
        destructive
        confirmLabel={submissionCount > 0 ? 'Archive' : 'Delete'}
        onConfirm={remove}
        onCancel={() => setDeleteOpen(false)}
      />
    </Box>
  );
}
