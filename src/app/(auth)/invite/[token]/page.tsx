import type { Metadata } from 'next';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { verifyToken } from '@/server/auth/tokens';
import { TokenInvalidAlert, TokenPasswordForm } from '../../TokenPasswordForm';

export const metadata: Metadata = { title: 'Accept invitation · SchoolHub' };
export const dynamic = 'force-dynamic';

const INVALID = 'This invitation link is invalid or has expired. Ask the school office to send a new one.';

/** /invite/[token] — C3 (FR-12, FR-13). No sign-up affordance (NFR-14). */
export default async function InvitePage({ params }: { params: { token: string } }) {
  const verified = await verifyToken(params.token, 'INVITE');
  return (
    <Stack spacing={2}>
      <Typography variant="h5" component="h1">
        Welcome to SchoolHub
      </Typography>
      {verified ? (
        <TokenPasswordForm
          mode="invite"
          token={params.token}
          email={verified.user.email}
          name={`${verified.user.firstName} ${verified.user.lastName}`}
          invalidMessage={INVALID}
        />
      ) : (
        <TokenInvalidAlert message={INVALID} showForgotLink={false} />
      )}
    </Stack>
  );
}
