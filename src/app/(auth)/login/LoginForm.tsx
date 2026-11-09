'use client';

import { useEffect, useRef, useState } from 'react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import Link from '@mui/material/Link';
import { TextFormField } from '@/components/FormField/FormField';
import { passwordInputSlot } from '@/components/PasswordChecklist';
import { useToast } from '@/components/Toast/useToast';
import { safeCallbackUrl, signInSchema, type SignInInput } from '@/lib/validators/auth';

/** FR-4/FR-6: maps the authorize() error code to user-facing copy. */
export function loginErrorMessage(code: string | null | undefined): string {
  const locked = code?.match(/^locked:(\d+)$/);
  if (locked) return `This account is temporarily locked. Try again in ${locked[1]} minutes.`;
  if (code === 'disabled') return 'This account is disabled. Contact the school office.';
  if (code === 'rate_limited') return 'Too many attempts. Wait a few minutes and try again.';
  return 'Email or password is incorrect.';
}

export function LoginForm({ callbackUrl, reset }: { callbackUrl?: string; reset: boolean }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toasted = useRef(false);
  const { control, handleSubmit, formState } = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
    shouldFocusError: true,
  });

  useEffect(() => {
    if (reset && !toasted.current) {
      toasted.current = true;
      showToast({ message: 'Password updated. Sign in with your new password.', severity: 'success' });
    }
  }, [reset, showToast]);

  const submit = handleSubmit(async ({ email, password }) => {
    setError(null);
    const result = await signIn('credentials', { email, password, redirect: false });
    // signIn resolves ok:true even on CredentialsSignin; `error` is the failure signal.
    if (!result || result.error) {
      setError(loginErrorMessage(result?.code));
      return;
    }
    router.replace(safeCallbackUrl(callbackUrl));
    router.refresh();
  });

  return (
    <Box component="form" noValidate onSubmit={submit}>
      <Stack spacing={2}>
        <Typography variant="h5" component="h1">
          Sign in
        </Typography>
        <Box aria-live="polite">{error && <Alert severity="error">{error}</Alert>}</Box>
        <TextFormField name="email" control={control} label="Email" type="email" autoComplete="email" required />
        <TextFormField
          name="password"
          control={control}
          label="Password"
          type={show ? 'text' : 'password'}
          autoComplete="current-password"
          required
          slotProps={passwordInputSlot(show, () => setShow((s) => !s))}
        />
        <Button type="submit" variant="contained" size="large" disabled={formState.isSubmitting}>
          Sign in
        </Button>
        <Link component={NextLink} href="/forgot-password" variant="body2" sx={{ alignSelf: 'center' }}>
          Forgot your password?
        </Link>
      </Stack>
    </Box>
  );
}
