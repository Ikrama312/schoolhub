import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Link from 'next/link';
import { prisma } from '@/server/db';

export default async function LandingPage() {
  const settings = await prisma.schoolSettings.findUnique({ where: { id: 'singleton' } });

  return (
    <Box sx={{ py: { xs: 8, md: 12 } }}>
      <Container maxWidth="md">
        <Stack spacing={3} sx={{ alignItems: 'flex-start' }}>
          <Typography variant="h3" sx={{ fontWeight: 700 }}>
            {settings?.name ?? 'SchoolHub Academy'}
          </Typography>
          <Typography variant="h6" color="text.secondary">
            One place for admins, teachers, students and parents to stay in sync.
          </Typography>
          <Button component={Link} href="/login" variant="contained" size="large">
            Sign in
          </Button>
        </Stack>
      </Container>
    </Box>
  );
}
