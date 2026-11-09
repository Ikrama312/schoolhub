import Box from '@mui/material/Box';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Stack from '@mui/material/Stack';
import Link from 'next/link';
import SchoolIcon from '@mui/icons-material/School';
import { prisma } from '@/server/db';

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const settings = await prisma.schoolSettings.findUnique({ where: { id: 'singleton' } });

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <AppBar position="static" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar component={Container} maxWidth="lg">
          <SchoolIcon color="primary" sx={{ mr: 1 }} />
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            {settings?.name ?? 'SchoolHub Academy'}
          </Typography>
          <Button component={Link} href="/login" variant="contained">
            Sign in
          </Button>
        </Toolbar>
      </AppBar>

      <Box component="main" sx={{ flexGrow: 1 }}>
        {children}
      </Box>

      <Box component="footer" sx={{ borderTop: 1, borderColor: 'divider', py: 3 }}>
        <Container maxWidth="lg">
          <Stack spacing={0.5}>
            <Typography variant="body2" color="text.secondary">
              {[settings?.addressLine1, settings?.city, settings?.country].filter(Boolean).join(', ')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {[settings?.phone, settings?.email].filter(Boolean).join(' · ')}
            </Typography>
          </Stack>
        </Container>
      </Box>
    </Box>
  );
}
