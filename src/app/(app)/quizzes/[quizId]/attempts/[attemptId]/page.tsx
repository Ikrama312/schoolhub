import NextLink from 'next/link';
import { notFound, redirect } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { requirePageUser } from '@/server/auth/requireRole';
import { AppError } from '@/server/http';
import { getSchoolTimezone } from '@/server/assignments/assignments-service';
import { getAttemptView } from '@/server/quiz/attempt-service';
import { MarkdownView } from '@/components/MarkdownView/MarkdownView';
import { formatInSchoolTz } from '@/lib/dates';

export const dynamic = 'force-dynamic';

type Option = { id: string; text: string };
const pts = (p: string | null) => (p === null ? '—' : p.replace(/\.00$/, ''));

/** Human-readable response / correct answer for any question type. */
function describe(v: unknown, options: Option[] | null): string {
  if (v == null || typeof v !== 'object') return 'No answer';
  const o = v as Record<string, unknown>;
  const label = (id: unknown) => options?.find((x) => x.id === id)?.text ?? String(id);
  if (typeof o.optionId === 'string') return label(o.optionId);
  if (Array.isArray(o.optionIds)) return o.optionIds.length ? o.optionIds.map(label).join(', ') : 'No answer';
  if (typeof o.value === 'boolean') return o.value ? 'True' : 'False';
  if (typeof o.text === 'string') return o.text.trim() || 'No answer';
  if (Array.isArray(o.accepted)) return o.accepted.join(' / ');
  if (typeof o.guidance === 'string') return o.guidance;
  return '—';
}

interface Row {
  id: string;
  prompt: string;
  points: string;
  options: Option[] | null;
  response: unknown;
  pending: boolean;
  pointsAwarded: string | null;
  isCorrect: boolean | null;
  feedback: string | null;
  correct?: unknown;
  explanation?: string | null;
}

function QuestionResult({ row, index }: { row: Row; index: number }) {
  const chip = row.pending ? (
    <Chip size="small" label="Awaiting grading" />
  ) : row.isCorrect ? (
    <Chip size="small" color="success" label="Correct" />
  ) : Number(row.pointsAwarded ?? 0) > 0 ? (
    <Chip size="small" color="warning" label="Partly correct" />
  ) : (
    <Chip size="small" color="error" label="Incorrect" />
  );
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600, flex: 1 }}>
          Question {index + 1}
        </Typography>
        {chip}
        <Typography variant="body2">
          {row.pending ? '—' : pts(row.pointsAwarded)} / {pts(row.points)}
        </Typography>
      </Stack>
      <MarkdownView source={row.prompt} />
      <Typography variant="body2" sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>
        <strong>Your answer:</strong> {describe(row.response, row.options)}
      </Typography>
      {row.correct !== undefined && (
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          <strong>Correct answer:</strong> {describe(row.correct, row.options)}
        </Typography>
      )}
      {row.explanation && (
        <Box sx={{ mt: 1 }}>
          <Typography variant="body2" component="p" sx={{ fontWeight: 600 }}>
            Explanation
          </Typography>
          <MarkdownView source={row.explanation} />
        </Box>
      )}
      {row.feedback && (
        <Alert severity="info" sx={{ mt: 1 }}>
          {row.feedback}
        </Alert>
      )}
    </Paper>
  );
}

/** FR-20/FR-21 result page for the student, linked parents (read-only) and course managers. */
export default async function AttemptResultPage({ params }: { params: { quizId: string; attemptId: string } }) {
  const user = await requirePageUser();
  let view: Awaited<ReturnType<typeof getAttemptView>>;
  try {
    view = await getAttemptView(user, params.attemptId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  if (view.data.quizId !== params.quizId) notFound();
  if (view.view === 'attempt') redirect(`/quizzes/${params.quizId}/take`);
  const timezone = await getSchoolTimezone();

  if (view.view === 'manager') {
    const a = view.data;
    const byQ = new Map(a.answers.map((x) => [x.questionId, x]));
    return (
      <Box>
        <Typography variant="h5" component="h1" sx={{ mb: 1 }}>
          {a.student.name} — attempt {a.attemptNumber}
        </Typography>
        <Stack direction="row" spacing={2} sx={{ mb: 2, alignItems: 'center' }}>
          <Chip label={a.status} />
          <Typography>
            Score: {pts(a.score)} / {pts(a.maxScore)}
          </Typography>
          {a.autoSubmitted && <Chip size="small" variant="outlined" label="Auto-submitted" />}
        </Stack>
        <Stack spacing={2}>
          {a.questions.map((q, i) => {
            const ans = byQ.get(q.id);
            return (
              <QuestionResult
                key={q.id}
                index={i}
                row={{ ...q, response: ans?.response ?? null, pending: ans?.needsReview ?? false, pointsAwarded: ans?.pointsAwarded ?? null, isCorrect: ans?.isCorrect ?? null, feedback: ans?.feedback ?? null }}
              />
            );
          })}
        </Stack>
      </Box>
    );
  }

  const r = view.data;
  return (
    <Box>
      <Typography variant="h5" component="h1">
        {r.quizTitle} — attempt {r.attemptNumber}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Submitted {formatInSchoolTz(r.submittedAt, 'EEE d MMM yyyy, HH:mm', timezone)}
        {r.autoSubmitted ? ' (automatically, when time ran out)' : ''}
      </Typography>
      {!r.resultsVisible ? (
        <Alert severity="info">Submitted — results will be available later.</Alert>
      ) : (
        <Stack spacing={2}>
          {r.score !== null ? (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="h4" component="p">
                {pts(r.score)} / {pts(r.maxScore)}
              </Typography>
              <Typography color="text.secondary">{r.percent}%</Typography>
            </Paper>
          ) : (
            <Alert severity="info">Some answers are awaiting grading by your teacher. Your final score will appear here.</Alert>
          )}
          {r.questions?.map((q, i) => (
            <QuestionResult key={q.id} index={i} row={{ ...q, pending: q.pendingReview }} />
          ))}
        </Stack>
      )}
      <Box sx={{ mt: 3 }}>
        <Button component={NextLink} href={`/quizzes/${params.quizId}/take`}>
          Back to quiz
        </Button>
      </Box>
    </Box>
  );
}
