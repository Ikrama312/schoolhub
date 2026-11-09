'use client';

import { useState } from 'react';
import NextLink from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import Link from '@mui/material/Link';
import { TextFormField } from '@/components/FormField/FormField';
import { applyFieldErrors, postJson } from '@/components/PasswordChecklist';
import { forgotPasswordSchema } from '@/lib/validators/auth';

type Values = z.infer<typeof forgotPasswordSchema>;
type Status = { severity: 'success' | 'error'; message: string } | null;

/** C1: same success copy for known and unknown emails (FR-18, no enumeration). */
export function ForgotPasswordForm() {
  const [status, setStatus] = useState<Status>(null);
  const { control, handleSubmit, setError, formState } = useForm<Values>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
    shouldFocusError: true,
  });

  const submit = handleSubmit(async ({ email }) => {
    setStatus(null);
    const result = await postJson<{ message: string }>('/api/auth/forgot-password', { email });
    if ('data' in result) {
      setStatus({ severity: 'success', message: result.data.message });
      return;
    }
    const { error } = result;
    if (error.status === 429) {
      setStatus({ severity: 'error', message: 'Too many attempts. Wait a few minutes and try again.' });
    } else if (!(error.status === 400 && applyFieldErrors(setError, error.fieldErrors, ['email']))) {
      setStatus({ severity: 'error', message: error.message });
    }
  });

  return (
    <Box component="form" noValidate onSubmit={submit}>
      <Stack spacing={2}>
        <Box aria-live="polite">{status && <Alert severity={status.severity}>{status.message}</Alert>}</Box>
        <TextFormField name="email" control={control} label="Email" type="email" autoComplete="email" required />
        <Button type="submit" variant="contained" size="large" disabled={formState.isSubmitting}>
          Send reset link
        </Button>
        <Link component={NextLink} href="/login" variant="body2" sx={{ alignSelf: 'center' }}>
          Back to sign in
        </Link>
      </Stack>
    </Box>
  );
}
