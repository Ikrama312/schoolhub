import NextLink from 'next/link';
import { notFound, redirect } from 'next/navigation';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { requirePageUser } from '@/server/auth/requireRole';
import { AppError } from '@/server/http';
import { getAssignment, getSchoolTimezone, type AssignmentDto } from '@/server/assignments/assignments-service';
import { formatInSchoolTz } from '@/lib/dates';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { MarkdownView } from '@/components/MarkdownView/MarkdownView';
import { FileList } from '@/components/FileList/FileList';
import { DueCountdown, SubmissionPanel } from './SubmissionPanel';

export const dynamic = 'force-dynamic';

const pts = (s: string) => String(Number(s));
const TYPE_LABELS = { ONLINE_TEXT: 'Online text', FILE_UPLOAD: 'File upload', TEXT_AND_FILE: 'Text and file', NO_SUBMISSION: 'No submission' } as const;

function latePolicy(a: AssignmentDto, tz: string): string {
  if (!a.allowLate) return 'Late submissions are not accepted.';
  const cutoff = a.lateCutoffAt ? ` until ${formatInSchoolTz(a.lateCutoffAt, 'EEE d MMM, HH:mm', tz)}` : '';
  const penalty = Number(a.latePenaltyPercentPerDay) > 0 ? `, ${pts(a.latePenaltyPercentPerDay)} % per day late (max ${pts(a.maxLatePenaltyPercent)} %)` : ', no penalty';
  return `Late submissions accepted${cutoff}${penalty}.`;
}

/** FR-19: assignment page. Non-managers get NOT_FOUND unless visible (service). */
export default async function AssignmentPage({ params, searchParams }: { params: { courseId: string; assignmentId: string }; searchParams: { studentId?: string } }) {
  const user = await requirePageUser();
  let data: Awaited<ReturnType<typeof getAssignment>>;
  try {
    data = await getAssignment(user, params.assignmentId, searchParams.studentId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    if (error instanceof AppError && error.code === 'FORBIDDEN') redirect('/forbidden');
    throw error;
  }
  const a = data.assignment;
  if (a.courseId !== params.courseId) notFound();
  const tz = await getSchoolTimezone();

  return (
    <Box>
      <PageHeader
        title={a.title}
        breadcrumbs={[{ label: 'Assignments', href: `/courses/${params.courseId}/assignments` }, { label: a.title }]}
        actions={
          data.canManage ? (
            <>
              <Button variant="outlined" component={NextLink} href={`/courses/${params.courseId}/assignments/${a.id}/edit`}>
                Edit
              </Button>
              <Button variant="contained" component={NextLink} href={`/courses/${params.courseId}/assignments/${a.id}/grade`}>
                Grade
              </Button>
            </>
          ) : undefined
        }
      />
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Stack spacing={2}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center', mb: 1 }}>
                <Typography variant="body1" sx={{ fontWeight: 600 }}>
                  Due {formatInSchoolTz(a.dueAt, 'EEE d MMM yyyy, HH:mm', tz)}
                </Typography>
                <DueCountdown dueAt={a.dueAt} serverNow={data.serverNow} />
                {data.canManage && <Chip size="small" label={a.status.charAt(0) + a.status.slice(1).toLowerCase()} />}
                {a.archivedAt && <Chip size="small" variant="outlined" label="Archived" />}
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {pts(a.maxPoints)} points · {TYPE_LABELS[a.submissionType]}
                {a.allowExtraCredit ? ' · extra credit allowed' : ''}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {latePolicy(a, tz)}
              </Typography>
            </Paper>
            {(a.instructions.trim() || a.attachments.length > 0) && (
              <Paper variant="outlined" sx={{ p: 2 }}>
                <MarkdownView source={a.instructions} />
                <FileList files={a.attachments} />
              </Paper>
            )}
            {a.rubric && (
              <Paper variant="outlined" sx={{ p: 2, overflowX: 'auto' }}>
                <Typography variant="h6" component="h2" gutterBottom>
                  Rubric
                </Typography>
                <Table size="small" aria-label="Rubric">
                  <TableHead>
                    <TableRow>
                      <TableCell>Criterion</TableCell>
                      <TableCell>Levels</TableCell>
                      <TableCell align="right">Max</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {a.rubric.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {c.title}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {c.description}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          {c.levels.map((l) => (
                            <Typography key={l.label} variant="body2">
                              {l.label} — {pts(l.points)}
                              {l.description ? `: ${l.description}` : ''}
                            </Typography>
                          ))}
                        </TableCell>
                        <TableCell align="right">{pts(c.maxPoints)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Paper>
            )}
          </Stack>
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          {data.canManage ? (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="h6" component="h2" gutterBottom>
                Submissions
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {data.submissionCount} submitted
              </Typography>
              <Button variant="contained" component={NextLink} href={`/courses/${params.courseId}/assignments/${a.id}/grade`}>
                Open grading
              </Button>
            </Paper>
          ) : (
            <SubmissionPanel
              assignment={a}
              submission={data.submission}
              exempt={data.exempt}
              userId={user.id}
              readOnly={user.role !== 'STUDENT'}
              timezone={tz}
              serverNow={data.serverNow}
            />
          )}
        </Grid>
      </Grid>
    </Box>
  );
}
