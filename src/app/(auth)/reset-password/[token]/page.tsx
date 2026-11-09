import type { Metadata } from 'next';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { verifyToken } from '@/server/auth/tokens';
import { TokenInvalidAlert, TokenPasswordForm } from '../../TokenPasswordForm';

export const metadata: Metadata = { title: 'Set a new password · SchoolHub' };
export const dynamic = 'force-dynamic';

const INVALID = 'This link is invalid or has expired.';

/** /reset-password/[token] — C2. verifyToken is read-only; the API consumes the token. */
export default async function ResetPasswordPage({ params }: { params: { token: string } }) {
  const verified = await verifyToken(params.token, 'PASSWORD_RESET');
  return (
    <Stack spacing={2}>
      <Typography variant="h5" component="h1">
        Set a new password
      </Typography>
      {verified ? (
        <TokenPasswordForm mode="reset" token={params.token} email={verified.user.email} invalidMessage={INVALID} />
      ) : (
        <TokenInvalidAlert message={INVALID} showForgotLink />
      )}
    </Stack>
  );
}
