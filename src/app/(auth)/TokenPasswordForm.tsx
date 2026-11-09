'use client';

import { useState } from 'react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import Link from '@mui/material/Link';
import { SetPasswordForm, postJson } from '@/components/PasswordChecklist';

export interface TokenPasswordFormProps {
  mode: 'invite' | 'reset';
  token: string;
  email: string;
  name?: string;
  invalidMessage: string;
}

/** C4: shared invite-accept / password-reset form. The token is only ever a prop (NFR-8). */
export function TokenPasswordForm({ mode, token, email, name, invalidMessage }: TokenPasswordFormProps) {
  const router = useRouter();
  const [invalid, setInvalid] = useState(false);

  if (invalid) return <TokenInvalidAlert message={invalidMessage} showForgotLink={mode === 'reset'} />;

  const onSubmit = async (password: string, confirm: string) => {
    const url = mode === 'invite' ? '/api/auth/accept-invite' : '/api/auth/reset-password';
    const result = await postJson(url, { token, password, confirm });
    if ('error' in result) {
      if (result.error.status === 410) {
        setInvalid(true);
        return;
      }
      return result.error;
    }
    if (mode === 'reset') {
      router.replace('/login?reset=1');
      return;
    }
    const signedIn = await signIn('credentials', { email, password, redirect: false });
    router.replace(!signedIn || signedIn.error ? '/login' : '/dashboard');
    router.refresh();
  };

  return (
    <SetPasswordForm
      name={name}
      email={email}
      submitLabel={mode === 'invite' ? 'Activate account' : 'Set new password'}
      onSubmit={onSubmit}
    />
  );
}

/** Invalid/expired-link state, shared by the server pages (C2, C3) and the 410 path above. */
export function TokenInvalidAlert({ message, showForgotLink }: { message: string; showForgotLink: boolean }) {
  return (
    <Stack spacing={2} aria-live="polite">
      <Alert severity="error">{message}</Alert>
      {showForgotLink && (
        <Link component={NextLink} href="/forgot-password" variant="body2" sx={{ alignSelf: 'center' }}>
          Request a new reset link
        </Link>
      )}
    </Stack>
  );
}
