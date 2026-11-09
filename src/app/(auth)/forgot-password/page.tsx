import type { Metadata } from 'next';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { ForgotPasswordForm } from './ForgotPasswordForm';

export const metadata: Metadata = { title: 'Forgot password · SchoolHub' };

/** /forgot-password — C1 (FR-17, FR-18). */
export default function ForgotPasswordPage() {
  return (
    <Stack spacing={2}>
      <Typography variant="h5" component="h1">
        Forgot your password?
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Enter your email and we&apos;ll send you a link to set a new password.
      </Typography>
      <ForgotPasswordForm />
    </Stack>
  );
}
