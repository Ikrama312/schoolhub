import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Link from 'next/link';

export default function NotFound() {
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center' }}>
      <Stack spacing={2} sx={{ alignItems: 'center', textAlign: 'center', px: 2 }}>
        <Typography variant="h3" sx={{ fontWeight: 700 }}>
          404
        </Typography>
        <Typography variant="h6" color="text.secondary">
          Page not found.
        </Typography>
        <Button component={Link} href="/" variant="contained">
          Go home
        </Button>
      </Stack>
    </Box>
  );
}
