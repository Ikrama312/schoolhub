'use client';

import NextLink from 'next/link';
import type { GridColDef } from '@mui/x-data-grid';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardActions from '@mui/material/CardActions';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { DataTable } from '@/components/DataTable/DataTable';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { formatInSchoolTz } from '@/lib/dates';
import type { CourseQuizList } from '@/server/quiz/quiz-service';

type Manager = Extract<CourseQuizList, { role: 'MANAGER' }>['items'][number];
type Student = Extract<CourseQuizList, { role: 'STUDENT' }>['items'][number];
type Parent = Extract<CourseQuizList, { role: 'PARENT' }>['items'][number];

const STATUS_COLOR = { DRAFT: 'default', PUBLISHED: 'success', CLOSED: 'info' } as const;
const fmt = 'd MMM yyyy, HH:mm';
const pct = (p: number | null) => (p === null ? '—' : `${p}%`);

function ManagerTable({ courseId, items, total, timezone }: { courseId: string; items: Manager[]; total: number; timezone: string }) {
  const columns: GridColDef<Manager>[] = [
    {
      field: 'title',
      headerName: 'Title',
      flex: 2,
      minWidth: 200,
      sortable: false,
      renderCell: ({ row }) => (
        <Link component={NextLink} href={`/courses/${courseId}/quizzes/${row.id}/edit`}>
          {row.title}
        </Link>
      ),
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 140,
      sortable: false,
      renderCell: ({ row }) => (
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', height: '100%' }}>
          <Chip size="small" label={row.status} color={STATUS_COLOR[row.status]} />
          {row.isPractice && <Chip size="small" variant="outlined" label="Practice" />}
        </Stack>
      ),
    },
    {
      field: 'window',
      headerName: 'Window',
      flex: 2,
      minWidth: 240,
      sortable: false,
      valueGetter: (_v, row) => `${formatInSchoolTz(row.availableFrom, fmt, timezone)} – ${formatInSchoolTz(row.availableUntil, fmt, timezone)}`,
    },
    { field: 'attemptCount', headerName: 'Attempts', width: 100, sortable: false },
    { field: 'averagePercent', headerName: 'Average', width: 100, sortable: false, valueFormatter: (v: number | null) => pct(v) },
    {
      field: 'needsGradingCount',
      headerName: 'Needs grading',
      width: 150,
      sortable: false,
      renderCell: ({ row }) =>
        row.needsGradingCount > 0 ? (
          <Link component={NextLink} href={`/courses/${courseId}/quizzes/${row.id}/grade`}>
            {row.needsGradingCount} to grade
          </Link>
        ) : (
          '0'
        ),
    },
    {
      field: 'actions',
      headerName: '',
      width: 120,
      sortable: false,
      renderCell: ({ row }) =>
        row.attemptCount > 0 ? (
          <Link component={NextLink} href={`/courses/${courseId}/quizzes/${row.id}/analytics`}>
            Analytics
          </Link>
        ) : null,
    },
  ];
  return <DataTable columns={columns as GridColDef[]} rows={items} total={total} />;
}

const GROUPS = [
  { key: 'AVAILABLE', title: 'Available now' },
  { key: 'UPCOMING', title: 'Upcoming' },
  { key: 'COMPLETED', title: 'Completed' },
  { key: 'MISSED', title: 'Missed' },
] as const;

function StudentCard({ item, timezone }: { item: Student; timezone: string }) {
  const { quiz, group, latestResult } = item;
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
          <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
            {quiz.title}
          </Typography>
          {quiz.isPractice && <Chip size="small" variant="outlined" label="Practice" />}
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {group === 'UPCOMING' ? `Opens ${formatInSchoolTz(quiz.availableFrom, fmt, timezone)}` : `Closes ${formatInSchoolTz(quiz.availableUntil, fmt, timezone)}`}
          {' · '}
          {quiz.questionCount} questions · {quiz.totalPoints.replace(/\.00$/, '')} points
          {quiz.timeLimitMinutes ? ` · ${quiz.timeLimitMinutes + quiz.extraTimeMinutes} min` : ''}
          {' · '}attempts {quiz.attemptsUsed}/{quiz.attemptLimit}
        </Typography>
        {latestResult && (
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            {latestResult.score !== null ? `Score: ${latestResult.score} / ${latestResult.maxScore} (${pct(latestResult.percent)})` : 'Submitted — results will be available later.'}
          </Typography>
        )}
      </CardContent>
      <CardActions>
        {group === 'AVAILABLE' && (
          <Button variant="contained" size="small" component={NextLink} href={`/quizzes/${quiz.id}/take`}>
            {quiz.inProgressAttemptId ? 'Resume' : 'Start'}
          </Button>
        )}
        {latestResult && (
          <Button size="small" component={NextLink} href={`/quizzes/${quiz.id}/attempts/${latestResult.attemptId}`}>
            View result
          </Button>
        )}
      </CardActions>
    </Card>
  );
}

function ParentList({ items }: { items: Parent[] }) {
  const done = items.filter((i) => i.results.length);
  if (!done.length) return <EmptyState title="No released quiz results yet" />;
  return (
    <Stack spacing={1.5}>
      {done.map((i) => (
        <Card key={`${i.student.id}-${i.quiz.id}`} variant="outlined">
          <CardContent>
            <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
              {i.quiz.title} — {i.student.name}
            </Typography>
            {i.results.map((r) => (
              <Typography key={r.attemptId} variant="body2">
                <Link component={NextLink} href={`/quizzes/${i.quiz.id}/attempts/${r.attemptId}`}>
                  Attempt {r.attemptNumber}
                </Link>
                {': '}
                {r.score !== null ? `${r.score} / ${r.maxScore} (${pct(r.percent)})` : 'Awaiting grading'}
              </Typography>
            ))}
          </CardContent>
        </Card>
      ))}
    </Stack>
  );
}

/** FR-11: teacher table · student groups · parent read-only results. */
export function CourseQuizzesView({ courseId, data, timezone }: { courseId: string; data: CourseQuizList; timezone: string }) {
  if (data.role === 'MANAGER') return <ManagerTable courseId={courseId} items={data.items} total={data.meta.total} timezone={timezone} />;
  if (data.role === 'PARENT') return <ParentList items={data.items} />;
  if (!data.items.length) return <EmptyState title="No quizzes yet" />;
  return (
    <Stack spacing={3}>
      {GROUPS.map(({ key, title }) => {
        const rows = data.items.filter((i) => i.group === key);
        if (!rows.length) return null;
        return (
          <Box component="section" key={key} aria-label={title}>
            <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
              {title}
            </Typography>
            <Stack spacing={1.5}>
              {rows.map((i) => (
                <StudentCard key={i.quiz.id} item={i} timezone={timezone} />
              ))}
            </Stack>
          </Box>
        );
      })}
    </Stack>
  );
}
