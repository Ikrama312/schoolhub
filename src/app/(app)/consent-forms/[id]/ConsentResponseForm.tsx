'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormHelperText from '@mui/material/FormHelperText';
import FormLabel from '@mui/material/FormLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useToast } from '@/components/Toast/useToast';
import { CONSENT_COMMENT_MAX, consentResponseSchema, type ConsentResponseInput } from '@/lib/validators/consent-forms';

interface Existing {
  value: 'GRANTED' | 'DECLINED';
  respondedBy: { id: string; name: string };
  comment: string | null;
  updatedAt: string;
}

/** FR-37/FR-38: Granted/Declined + typed signature (must match your name) + optional comment; changeable until dueAt. */
export function ConsentResponseForm({ formId, studentId, childName, open, initial }: { formId: string; studentId: string; childName: string; open: boolean; initial: Existing | null }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [editing, setEditing] = useState(!initial && open);
  const { control, handleSubmit, setError, formState } = useForm<ConsentResponseInput>({
    resolver: zodResolver(consentResponseSchema),
    defaultValues: { studentId, value: initial?.value ?? (undefined as unknown as 'GRANTED'), signature: '', comment: initial?.comment ?? '' },
  });
  const err = formState.errors;

  const onSubmit = handleSubmit(async (values) => {
    const res = await fetch(`/api/consent-forms/${formId}/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...values, comment: values.comment || undefined }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      for (const [f, msgs] of Object.entries((json?.error?.details?.fieldErrors ?? {}) as Record<string, string[]>)) setError(f as keyof ConsentResponseInput, { message: msgs[0] });
      showToast({ message: json?.error?.message ?? 'Could not save your response.', severity: 'error' });
      return;
    }
    showToast({ message: json.data.changed ? 'Response updated' : 'Response saved', severity: 'success' });
    setEditing(false);
    router.refresh();
  });

  if (!editing) {
    return (
      <Stack spacing={1.5}>
        {initial ? (
          <Alert severity={initial.value === 'GRANTED' ? 'success' : 'warning'}>
            {initial.value === 'GRANTED' ? 'Consent granted' : 'Consent declined'} by {initial.respondedBy.name} on {new Date(initial.updatedAt).toLocaleString()}
            {initial.comment ? ` — “${initial.comment}”` : ''}
          </Alert>
        ) : (
          <Alert severity="info">No response was given before the due date.</Alert>
        )}
        {open && (
          <div>
            <Button onClick={() => setEditing(true)}>Change response</Button>
          </div>
        )}
      </Stack>
    );
  }

  return (
    <Stack component="form" spacing={2} onSubmit={onSubmit} noValidate>
      <FormControl error={!!err.value}>
        <FormLabel id={`consent-${studentId}`}>Do you give consent for {childName}?</FormLabel>
        <Controller
          name="value"
          control={control}
          render={({ field }) => (
            <RadioGroup row aria-labelledby={`consent-${studentId}`} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value)}>
              <FormControlLabel value="GRANTED" control={<Radio />} label="I give consent" />
              <FormControlLabel value="DECLINED" control={<Radio />} label="I do not give consent" />
            </RadioGroup>
          )}
        />
        {err.value && <FormHelperText>Choose an answer</FormHelperText>}
      </FormControl>
      <Controller
        name="signature"
        control={control}
        render={({ field }) => <TextField label="Signature — type your full name" {...field} error={!!err.signature} helperText={err.signature?.message} autoComplete="name" />}
      />
      <Controller
        name="comment"
        control={control}
        render={({ field }) => (
          <TextField label="Comment (optional)" multiline minRows={2} {...field} value={field.value ?? ''} slotProps={{ htmlInput: { maxLength: CONSENT_COMMENT_MAX } }} />
        )}
      />
      <Stack direction="row" spacing={1}>
        <Button type="submit" variant="contained" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? 'Signing…' : 'Sign and submit'}
        </Button>
        {initial && (
          <Button onClick={() => setEditing(false)} disabled={formState.isSubmitting}>
            Cancel
          </Button>
        )}
      </Stack>
    </Stack>
  );
}
