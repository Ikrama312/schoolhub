import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import GlobalStyles from '@mui/material/GlobalStyles';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import type { ReportCardSnapshot } from '@/server/report-cards/snapshot';

/**
 * PRD-11 report card (FR-35, NFR-11). Renders the frozen snapshot only — never recomputes.
 * Print: A4 portrait with 12 mm margins, app shell hidden, one card per page.
 */
export function ReportCardPrintStyles() {
  return (
    <GlobalStyles
      styles={{
        '@page': { size: 'A4 portrait', margin: '12mm' },
        '@media print': {
          '.MuiAppBar-root, .MuiDrawer-root, [data-print-hide]': { display: 'none !important' },
          'main.MuiBox-root, main': { width: '100% !important', padding: '0 !important' },
          'main > .MuiToolbar-root': { display: 'none !important' },
          body: { background: '#fff !important' },
          '.report-card': { breakAfter: 'page', boxShadow: 'none !important', border: '0 !important', padding: '0 !important' },
          '.report-card:last-of-type': { breakAfter: 'auto' },
          '.report-card tr, .report-card .keep-together': { breakInside: 'avoid' },
        },
      }}
    />
  );
}

const Field = ({ label, value }: { label: string; value: string | null | undefined }) => (
  <Grid size={{ xs: 6, sm: 4 }}>
    <Typography variant="caption" color="text.secondary" component="div">
      {label}
    </Typography>
    <Typography variant="body2">{value || '—'}</Typography>
  </Grid>
);

export function ReportCardDocument({
  snapshot: s,
  homeroomComment,
  principalComment,
  draft,
}: {
  snapshot: ReportCardSnapshot;
  homeroomComment: string | null;
  principalComment: string | null;
  draft?: boolean;
}) {
  const scales = [s.scale, ...s.extraScales];
  return (
    <Paper variant="outlined" className="report-card" component="article" aria-label={`Report card for ${s.student.name}`} sx={{ p: 4, mb: 3, maxWidth: '210mm', mx: 'auto' }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        {s.school.logoUrl && <Avatar src={s.school.logoUrl} alt="" variant="rounded" sx={{ width: 56, height: 56 }} />}
        <Box sx={{ flex: 1 }}>
          <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
            {s.school.name}
          </Typography>
          <Typography variant="subtitle1">
            Report card — {s.term.name}, {s.term.academicYear}
            {draft ? ' (DRAFT)' : ''}
          </Typography>
        </Box>
      </Stack>
      <Divider sx={{ my: 2 }} />
      <Grid container spacing={1.5} className="keep-together">
        <Field label="Student" value={s.student.name} />
        <Field label="Admission number" value={s.student.admissionNumber} />
        <Field label="Grade level" value={s.student.gradeLevel} />
        <Field label="Section" value={s.student.section} />
        <Field label="Homeroom teacher" value={s.student.homeroomTeacher} />
        <Field label="Term dates" value={`${s.term.startDate} – ${s.term.endDate}`} />
      </Grid>

      <Typography variant="h6" component="h2" sx={{ mt: 3, mb: 1 }}>
        Courses
      </Typography>
      <Table size="small" aria-label="Course grades">
        <TableHead>
          <TableRow>
            <TableCell>Subject</TableCell>
            <TableCell>Teacher</TableCell>
            <TableCell align="right">%</TableCell>
            <TableCell align="center">Grade</TableCell>
            <TableCell>Comment</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {s.courses.map((c) => (
            <TableRow key={c.code}>
              <TableCell>
                {c.subject}
                <Typography variant="caption" color="text.secondary" component="div">
                  {c.code}
                </Typography>
              </TableCell>
              <TableCell>{c.teacher ?? '—'}</TableCell>
              <TableCell align="right">{c.percent ?? '—'}</TableCell>
              <TableCell align="center">
                <strong>{c.letter ?? '—'}</strong>
                {c.descriptor && (
                  <Typography variant="caption" component="div" color="text.secondary">
                    {c.descriptor}
                  </Typography>
                )}
              </TableCell>
              <TableCell sx={{ whiteSpace: 'pre-wrap' }}>{c.teacherComment ?? ''}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Grid container spacing={3} sx={{ mt: 2 }} className="keep-together">
        <Grid size={{ xs: 12, sm: 5 }}>
          <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
            Attendance
          </Typography>
          <Table size="small" aria-label="Attendance summary">
            <TableBody>
              <TableRow>
                <TableCell>Attendance rate</TableCell>
                <TableCell align="right">{s.attendance.rate === null ? '—' : `${s.attendance.rate}%`}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Absences</TableCell>
                <TableCell align="right">{s.attendance.absences}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Lates</TableCell>
                <TableCell align="right">{s.attendance.lates}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Grid>
        <Grid size={{ xs: 12, sm: 7 }}>
          <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
            Grading scale
          </Typography>
          {scales.map((sc) => (
            <Box key={sc.name} sx={{ mb: 1 }}>
              <Typography variant="caption" color="text.secondary">
                {sc.name}
              </Typography>
              <Typography variant="body2">{sc.bands.map((b) => `${b.letter} ≥ ${b.minPercent}%${b.descriptor ? ` (${b.descriptor})` : ''}`).join(' · ')}</Typography>
            </Box>
          ))}
        </Grid>
      </Grid>

      <Stack spacing={2} sx={{ mt: 3 }} className="keep-together">
        <Box>
          <Typography variant="subtitle2">Homeroom teacher’s comment</Typography>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', minHeight: 24 }}>
            {homeroomComment ?? ''}
          </Typography>
        </Box>
        <Box>
          <Typography variant="subtitle2">Principal’s comment</Typography>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', minHeight: 24 }}>
            {principalComment ?? ''}
          </Typography>
        </Box>
      </Stack>

      <Grid container spacing={6} sx={{ mt: 5 }} className="keep-together">
        {['Principal', 'Homeroom teacher'].map((who) => (
          <Grid key={who} size={6}>
            <Divider sx={{ borderColor: 'text.primary' }} />
            <Typography variant="caption">{who} — signature and date</Typography>
          </Grid>
        ))}
      </Grid>
    </Paper>
  );
}
