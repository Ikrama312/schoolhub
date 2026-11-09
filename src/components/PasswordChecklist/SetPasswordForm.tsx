'use client';

import { useState } from 'react';
import { useForm, type FieldValues, type Path, type UseFormSetError } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import { TextFormField } from '@/components/FormField/FormField';
import { setPasswordSchema, type SetPasswordValues } from '@/lib/validators/auth';
import { PasswordChecklist } from './PasswordChecklist';

/** The API error envelope's body, or null on success. */
export interface ApiFailure {
  status: number;
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
}

/** POST JSON to our own API; resolves to the parsed `data` or an ApiFailure. */
export async function postJson<T = unknown>(url: string, body: unknown): Promise<{ data: T } | { error: ApiFailure }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) return { data: json.data as T };
    return {
      error: {
        status: res.status,
        code: json.error?.code ?? 'INTERNAL',
        message: json.error?.message ?? 'Something went wrong. Please try again.',
        fieldErrors: json.error?.details?.fieldErrors,
      },
    };
  } catch {
    return { error: { status: 0, code: 'NETWORK', message: 'Network error. Check your connection and try again.' } };
  }
}

/** Maps server details.fieldErrors onto form fields; returns true if any field matched. */
export function applyFieldErrors<T extends FieldValues>(
  setError: UseFormSetError<T>,
  fieldErrors: Record<string, string[]> | undefined,
  fields: Path<T>[],
): boolean {
  let matched = false;
  for (const field of fields) {
    const messages = fieldErrors?.[field];
    if (messages?.length) {
      setError(field, { type: 'server', message: messages.join(' ') }, { shouldFocus: !matched });
      matched = true;
    }
  }
  return matched;
}

/** Visibility toggle for a password TextField (v9: slotProps.input). */
export function passwordInputSlot(show: boolean, toggle: () => void) {
  return {
    input: {
      endAdornment: (
        <InputAdornment position="end">
          <IconButton aria-label={show ? 'Hide password' : 'Show password'} onClick={toggle} edge="end">
            {show ? <VisibilityOff /> : <Visibility />}
          </IconButton>
        </InputAdornment>
      ),
    },
  };
}

export interface SetPasswordFormProps {
  name?: string;
  email: string;
  submitLabel?: string;
  /** Return an ApiFailure to show it; return nothing on success. */
  onSubmit: (password: string, confirm: string) => Promise<ApiFailure | void>;
}

/** Shared set-password form for invite acceptance and password reset (FR-16, FR-21). */
export function SetPasswordForm({ name, email, submitLabel = 'Set password', onSubmit }: SetPasswordFormProps) {
  const [show, setShow] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, watch, setError, formState } = useForm<SetPasswordValues>({
    resolver: zodResolver(setPasswordSchema(email)),
    defaultValues: { password: '', confirm: '' },
    shouldFocusError: true,
  });

  const submit = handleSubmit(async ({ password, confirm }) => {
    setFormError(null);
    const failure = await onSubmit(password, confirm);
    if (!failure) return;
    if (!applyFieldErrors(setError, failure.fieldErrors, ['password', 'confirm'])) setFormError(failure.message);
  });

  return (
    <Box component="form" noValidate onSubmit={submit}>
      <Stack spacing={2}>
        <Box aria-live="polite">{formError && <Alert severity="error">{formError}</Alert>}</Box>
        {name && <TextField label="Name" value={name} fullWidth slotProps={{ htmlInput: { readOnly: true } }} />}
        <TextField label="Email" value={email} fullWidth slotProps={{ htmlInput: { readOnly: true } }} />
        <TextFormField
          name="password"
          control={control}
          label="New password"
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          required
          slotProps={passwordInputSlot(show, () => setShow((s) => !s))}
        />
        <PasswordChecklist password={watch('password')} email={email} />
        <TextFormField
          name="confirm"
          control={control}
          label="Confirm password"
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          required
        />
        <Button type="submit" variant="contained" size="large" disabled={formState.isSubmitting}>
          {submitLabel}
        </Button>
      </Stack>
    </Box>
  );
}
