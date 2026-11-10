import NextLink from 'next/link';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { requirePageRole } from '@/server/auth/requireRole';
import { REPORT_KEYS, REPORTS } from '@/server/reports';

/** PRD-16 FR-33: the six admin reports. */
export default async function ReportsPage() {
  await requirePageRole('ADMIN');
  return (
    <>
      <PageHeader title="Reports" description="School-wide reports with charts and CSV export." />
      <Grid container spacing={2}>
        {REPORT_KEYS.map((key) => (
          <Grid key={key} size={{ xs: 12, sm: 6, lg: 4 }}>
            <Card variant="outlined" sx={{ height: '100%' }}>
              <CardActionArea component={NextLink} href={`/admin/reports/${key}`} sx={{ height: '100%' }}>
                <CardContent>
                  <Typography variant="h6" component="h2">
                    {REPORTS[key].title}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {REPORTS[key].description}
                  </Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>
    </>
  );
}
