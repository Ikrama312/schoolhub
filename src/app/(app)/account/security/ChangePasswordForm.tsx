'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import { TextFormField } from '@/components/FormField/FormField';
import { PasswordChecklist, applyFieldErrors, passwordInputSlot, postJson } from '@/components/PasswordChecklist';
import { useToast } from '@/components/Toast/useToast';
import { changePasswordFormSchema, type ChangePasswordInput } from '@/lib/validators/auth';

/** C5: signed-in password change. Other sessions are revoked server-side (FR-23). */
export function ChangePasswordForm({ email }: { email: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [show, setShow] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, watch, setError, reset, formState } = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordFormSchema(email)),
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' },
    shouldFocusError: true,
  });

  const submit = handleSubmit(async (values) => {
    setFormError(null);
    const result = await postJson('/api/account/password', values);
    if ('data' in result) {
      showToast({ message: 'Password updated', severity: 'success' });
      reset();
      router.refresh();
      return;
    }
    const { password, ...rest } = result.error.fieldErrors ?? {};
    // The server's common-password policy error is keyed `password`; this form calls it newPassword.
    const fieldErrors = password ? { ...rest, newPassword: [...(rest.newPassword ?? []), ...password] } : rest;
    if (!applyFieldErrors(setError, fieldErrors, ['currentPassword', 'newPassword', 'confirm'])) {
      setFormError(result.error.message);
    }
  });

  const toggle = () => setShow((s) => !s);
  const type = show ? 'text' : 'password';

  return (
    <Box component="form" noValidate onSubmit={submit} sx={{ maxWidth: 480 }}>
      <Stack spacing={2}>
        <Box aria-live="polite">{formError && <Alert severity="error">{formError}</Alert>}</Box>
        <TextFormField
          name="currentPassword"
          control={control}
          label="Current password"
          type={type}
          autoComplete="current-password"
          required
          slotProps={passwordInputSlot(show, toggle)}
        />
        <TextFormField
          name="newPassword"
          control={control}
          label="New password"
          type={type}
          autoComplete="new-password"
          required
          slotProps={passwordInputSlot(show, toggle)}
        />
        <PasswordChecklist password={watch('newPassword')} email={email} />
        <TextFormField
          name="confirm"
          control={control}
          label="Confirm new password"
          type={type}
          autoComplete="new-password"
          required
        />
        <Button type="submit" variant="contained" disabled={formState.isSubmitting} sx={{ alignSelf: 'flex-start' }}>
          Update password
        </Button>
      </Stack>
    </Box>
  );
}
