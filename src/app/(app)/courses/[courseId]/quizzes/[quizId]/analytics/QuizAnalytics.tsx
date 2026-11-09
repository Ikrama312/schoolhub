'use client';

import { BarChart } from '@mui/x-charts/BarChart';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import DownloadIcon from '@mui/icons-material/Download';
import { StatCard } from '@/components/StatCard/StatCard';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { QUESTION_TYPE_LABELS } from '@/lib/validators/quiz';
import type { QuizAnalytics as Data } from '@/server/quiz/analytics';

const pts = (p: string | null) => (p === null ? '—' : p.replace(/\.00$/, ''));
const duration = (s: number | null) => (s === null ? '—' : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`);
/** Plain-text preview of a Markdown prompt for the table. */
const plain = (md: string) => md.replace(/!\[[^\]]*]\([^)]*\)/g, '').replace(/[#*_`>]/g, '').trim().slice(0, 120);

/** FR-26 summary + 10-bucket histogram; FR-27 per-question table with option distribution and CSV export. */
export function QuizAnalytics({ quizId, data }: { quizId: string; data: Data }) {
  const s = data.summary;
  if (!s.attempts) return <EmptyState title="No submitted attempts yet" description="Analytics appear once students submit." />;
  const stats: [string, string][] = [
    ['Attempts', String(s.attempts)],
    ['Average', pts(s.average)],
    ['Median', pts(s.median)],
    ['Highest', pts(s.highest)],
    ['Lowest', pts(s.lowest)],
    ['Avg. time', duration(s.averageTimeSeconds)],
  ];

  return (
    <Stack spacing={3}>
      <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
        <Button variant="outlined" startIcon={<DownloadIcon />} href={`/api/quizzes/${quizId}/analytics?format=csv`}>
          Export CSV
        </Button>
      </Stack>
      <Grid container spacing={2}>
        {stats.map(([label, value]) => (
          <Grid key={label} size={{ xs: 6, sm: 4, md: 2 }}>
            <StatCard label={label} value={value} />
          </Grid>
        ))}
      </Grid>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" component="h2">
          Score distribution
        </Typography>
        <BarChart
          height={280}
          xAxis={[{ scaleType: 'band', data: data.histogram.map((h) => `${h.bucket}%`), label: 'Score (%)' }]}
          yAxis={[{ label: 'Attempts', tickMinStep: 1 }]}
          series={[{ data: data.histogram.map((h) => h.count), label: 'Attempts' }]}
        />
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
          Questions
        </Typography>
        <TableContainer>
          <Table size="small" aria-label="Per-question results">
            <TableHead>
              <TableRow>
                <TableCell>#</TableCell>
                <TableCell>Question</TableCell>
                <TableCell>Type</TableCell>
                <TableCell align="right">% correct</TableCell>
                <TableCell align="right">Avg points</TableCell>
                <TableCell>Selected options</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.questions.map((q, i) => (
                <TableRow key={q.questionId}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell sx={{ maxWidth: 320 }}>{plain(q.prompt)}</TableCell>
                  <TableCell>{QUESTION_TYPE_LABELS[q.type]}</TableCell>
                  <TableCell align="right">{q.percentCorrect === null ? '—' : `${q.percentCorrect}%`}</TableCell>
                  <TableCell align="right">
                    {pts(q.averagePoints)} / {pts(q.points)}
                  </TableCell>
                  <TableCell>
                    {q.optionDistribution ? (
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {q.optionDistribution.map((o) => (
                          <Chip
                            key={o.optionId}
                            size="small"
                            label={`${o.text}: ${o.count}`}
                            color={o.isCorrect ? 'success' : o.optionId === q.mostChosenWrongOptionId ? 'error' : 'default'}
                            variant={o.isCorrect || o.optionId === q.mostChosenWrongOptionId ? 'filled' : 'outlined'}
                            title={o.optionId === q.mostChosenWrongOptionId ? 'Most chosen wrong option' : o.isCorrect ? 'Correct option' : undefined}
                          />
                        ))}
                      </Box>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <Typography variant="caption" color="text.secondary">
          Green = correct option · red = most chosen wrong option.
        </Typography>
      </Paper>
    </Stack>
  );
}
