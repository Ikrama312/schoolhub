import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Link from 'next/link';

/** 403 slot — reserved for later auth PRDs to redirect into. */
export default function ForbiddenPage() {
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center' }}>
      <Stack spacing={2} sx={{ alignItems: 'center', textAlign: 'center', px: 2 }}>
        <Typography variant="h3" sx={{ fontWeight: 700 }}>
          403
        </Typography>
        <Typography variant="h6" color="text.secondary">
          You don&apos;t have permission to view this page.
        </Typography>
        <Button component={Link} href="/dashboard" variant="contained">
          Back to dashboard
        </Button>
      </Stack>
    </Box>
  );
}
