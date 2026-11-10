'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { format } from 'date-fns';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormGroup from '@mui/material/FormGroup';
import FormHelperText from '@mui/material/FormHelperText';
import FormLabel from '@mui/material/FormLabel';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { FileUpload, type FileRef } from '@/components/FileUpload/FileUpload';
import { useToast } from '@/components/Toast/useToast';
import {
  ABSENCE_REASONS,
  ABSENCE_REASON_LABELS,
  DETAILS_MAX,
  FUTURE_DAYS,
  PAST_DAYS,
  absenceNoteSchemaFor,
  type AbsenceNoteFormValues,
} from '@/lib/validators/absence-notes';
import { addDays } from '@/server/attendance/attendance-rules';

interface Period {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
}

const toLocal = (d: string) => new Date(`${d}T00:00:00`);
const fromLocal = (d: Date | null) => (d && !Number.isNaN(d.getTime()) ? format(d, 'yyyy-MM-dd') : '');

/** FR-18: RHF + the shared Zod schema (same rules the API enforces). */
export function AbsenceNoteForm({ studentId, periods, today }: { studentId: string; periods: Period[]; today: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [files, setFiles] = useState<FileRef[]>([]);
  const schema = useMemo(() => absenceNoteSchemaFor(today), [today]);
  const { control, handleSubmit, watch, setValue, setError, formState } = useForm<AbsenceNoteFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { studentId, fromDate: today, toDate: today, partialDay: false, periodIds: [], reason: 'ILLNESS', details: '' },
  });
  const partialDay = watch('partialDay');
  const min = toLocal(addDays(today, -PAST_DAYS));
  const max = toLocal(addDays(today, FUTURE_DAYS));

  const onSubmit = handleSubmit(async (values) => {
    const res = await fetch('/api/absence-notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...values, details: values.details || undefined, fileId: files[0]?.id }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const fieldErrors = (json?.error?.details?.fieldErrors ?? {}) as Record<string, string[]>;
      for (const [field, msgs] of Object.entries(fieldErrors)) setError(field as keyof AbsenceNoteFormValues, { message: msgs[0] });
      showToast({ message: json?.error?.message ?? 'Could not submit the note.', severity: 'error' });
      return;
    }
    showToast({ message: 'Absence note sent to the school', severity: 'success' });
    router.push(`/my-children/${studentId}/absence`);
    router.refresh();
  });

  const err = formState.errors;
  return (
    <Paper variant="outlined" sx={{ p: 3, maxWidth: 640 }}>
      <Stack component="form" spacing={3} onSubmit={onSubmit} noValidate>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <Controller
            name="fromDate"
            control={control}
            render={({ field }) => (
              <DatePicker
                label="From"
                value={field.value ? toLocal(field.value) : null}
                minDate={min}
                maxDate={max}
                onChange={(d) => field.onChange(fromLocal(d))}
                slotProps={{ textField: { fullWidth: true, error: !!err.fromDate, helperText: err.fromDate?.message } }}
              />
            )}
          />
          <Controller
            name="toDate"
            control={control}
            render={({ field }) => (
              <DatePicker
                label="To"
                value={field.value ? toLocal(field.value) : null}
                minDate={min}
                maxDate={max}
                onChange={(d) => field.onChange(fromLocal(d))}
                slotProps={{ textField: { fullWidth: true, error: !!err.toDate, helperText: err.toDate?.message } }}
              />
            )}
          />
        </Stack>

        <FormControl>
          <FormLabel id="absence-span">Absent for</FormLabel>
          <Controller
            name="partialDay"
            control={control}
            render={({ field }) => (
              <RadioGroup
                row
                aria-labelledby="absence-span"
                value={field.value ? 'periods' : 'whole'}
                onChange={(e) => {
                  field.onChange(e.target.value === 'periods');
                  if (e.target.value === 'whole') setValue('periodIds', []);
                }}
              >
                <FormControlLabel value="whole" control={<Radio />} label="Whole day" />
                <FormControlLabel value="periods" control={<Radio />} label="Specific periods" />
              </RadioGroup>
            )}
          />
        </FormControl>

        {partialDay && (
          <FormControl error={!!err.periodIds} component="fieldset">
            <FormLabel component="legend">Periods</FormLabel>
            <Controller
              name="periodIds"
              control={control}
              render={({ field }) => (
                <FormGroup>
                  {periods.map((p) => {
                    const checked = (field.value ?? []).includes(p.id);
                    return (
                      <FormControlLabel
                        key={p.id}
                        label={`${p.name} (${p.startTime}–${p.endTime})`}
                        control={
                          <Checkbox
                            checked={checked}
                            onChange={() => field.onChange(checked ? field.value!.filter((x) => x !== p.id) : [...(field.value ?? []), p.id])}
                          />
                        }
                      />
                    );
                  })}
                </FormGroup>
              )}
            />
            {err.periodIds && <FormHelperText>{err.periodIds.message}</FormHelperText>}
          </FormControl>
        )}

        <Controller
          name="reason"
          control={control}
          render={({ field }) => (
            <TextField select label="Reason" {...field} error={!!err.reason} helperText={err.reason?.message}>
              {ABSENCE_REASONS.map((r) => (
                <MenuItem key={r} value={r}>
                  {ABSENCE_REASON_LABELS[r]}
                </MenuItem>
              ))}
            </TextField>
          )}
        />

        <Controller
          name="details"
          control={control}
          render={({ field }) => (
            <TextField
              label="Details (optional)"
              multiline
              minRows={3}
              {...field}
              error={!!err.details}
              helperText={err.details?.message ?? `${(field.value ?? '').length}/${DETAILS_MAX}`}
              slotProps={{ htmlInput: { maxLength: DETAILS_MAX } }}
            />
          )}
        />

        <FileUpload context="absence-note" max={1} value={files} onChange={setFiles} label="Attach a document (PDF, JPG or PNG)" disabled={formState.isSubmitting} />

        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
          <Button onClick={() => router.back()} disabled={formState.isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? 'Sending…' : 'Send note'}
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
