'use client';

import { useEffect } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import { logger } from '@/lib/logger';

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    logger.error('Unhandled client error', { message: error.message, stack: error.stack });
  }, [error]);

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center' }}>
      <Stack spacing={2} sx={{ alignItems: 'center', textAlign: 'center', px: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Something went wrong
        </Typography>
        <Typography variant="body2" color="text.secondary">
          An unexpected error occurred. You can try again.
        </Typography>
        <Button onClick={() => reset()} variant="contained">
          Try again
        </Button>
      </Stack>
    </Box>
  );
}
