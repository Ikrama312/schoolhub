import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import SchoolIcon from '@mui/icons-material/School';

/** Centred card for sign-in / forgot / invite / reset pages. Deliberately no AppShell. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <Box component="main" sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', py: 4 }}>
      <Container maxWidth="xs">
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, mb: 2 }}>
          <SchoolIcon color="primary" />
          <Typography variant="h6" component="p">
            SchoolHub
          </Typography>
        </Box>
        <Card variant="outlined">
          <CardContent sx={{ p: { xs: 3, sm: 4 } }}>{children}</CardContent>
        </Card>
      </Container>
    </Box>
  );
}
