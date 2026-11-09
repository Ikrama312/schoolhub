'use client';

import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { MarkdownView } from '@/components/MarkdownView/MarkdownView';
import { useToast } from '@/components/Toast/useToast';
import { FEEDBACK_MAX, manualGradeSchema, QUESTION_TYPE_LABELS } from '@/lib/validators/quiz';
import type { ManagerAnswer, ManagerAttempt, ManagerQuestion } from '@/server/quiz/serializers';

const pts = (p: string | null) => (p === null ? '—' : p.replace(/\.00$/, ''));

function describe(v: unknown, q: ManagerQuestion): string {
  if (v == null || typeof v !== 'object') return 'No answer';
  const o = v as Record<string, unknown>;
  const label = (id: unknown) => q.options?.find((x) => x.id === id)?.text ?? String(id);
  if (typeof o.optionId === 'string') return label(o.optionId);
  if (Array.isArray(o.optionIds)) return o.optionIds.map(label).join(', ') || 'No answer';
  if (typeof o.value === 'boolean') return o.value ? 'True' : 'False';
  if (typeof o.text === 'string') return o.text.trim() || 'No answer';
  return '—';
}

/** Points (0 – question points, step 0.5) + feedback; overrides auto-graded answers too (FR-24). */
function GradeForm({
  attempt,
  question,
  answer,
  onSaved,
  heading,
}: {
  attempt: ManagerAttempt;
  question: ManagerQuestion;
  answer: ManagerAnswer | undefined;
  onSaved: (answer: ManagerAnswer, a: { status: ManagerAttempt['status']; score: string | null }) => void;
  heading: string;
}) {
  const { showToast } = useToast();
  const [points, setPoints] = useState(answer?.pointsAwarded ? pts(answer.pointsAwarded) : '');
  const [feedback, setFeedback] = useState(answer?.feedback ?? '');
  const [saving, setSaving] = useState(false);
  const max = Number(question.points);
  const parsed = manualGradeSchema.safeParse({ pointsAwarded: points, feedback });
  const tooMany = parsed.success && Number(parsed.data.pointsAwarded) > max;
  const error = points === '' ? undefined : !parsed.success ? parsed.error.issues[0]?.message : tooMany ? `At most ${pts(question.points)}` : undefined;

  const save = async () => {
    if (!parsed.success || tooMany) return;
    setSaving(true);
    const res = await fetch(`/api/attempts/${attempt.id}/answers/${question.id}/grade`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pointsAwarded: parsed.data.pointsAwarded, feedback: feedback || null }),
    });
    setSaving(false);
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      showToast({ message: json?.error?.message ?? 'Could not save the grade.', severity: 'error' });
      return;
    }
    onSaved(json.data.answer, json.data.attempt);
    showToast({ message: 'Grade saved', severity: 'success' });
  };

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1, flexWrap: 'wrap' }} useFlexGap>
        <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600, flex: 1 }}>
          {heading}
        </Typography>
        {answer?.needsReview ? <Chip size="small" color="warning" label="Needs grading" /> : answer?.gradedById ? <Chip size="small" label="Graded by teacher" /> : <Chip size="small" variant="outlined" label="Auto-graded" />}
        <Typography variant="body2">
          {pts(answer?.pointsAwarded ?? null)} / {pts(question.points)}
        </Typography>
      </Stack>
      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mb: 2 }}>
        <strong>Answer:</strong> {describe(answer?.response ?? null, question)}
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'flex-start' } }}>
        <TextField
          label="Points"
          size="small"
          value={points}
          onChange={(e) => setPoints(e.target.value)}
          error={!!error}
          helperText={error ?? `0 – ${pts(question.points)}, steps of 0.5`}
          sx={{ width: { sm: 160 } }}
          slotProps={{ htmlInput: { inputMode: 'decimal', step: 0.5, min: 0, max } }}
        />
        <TextField label="Feedback" size="small" value={feedback} onChange={(e) => setFeedback(e.target.value)} multiline fullWidth slotProps={{ htmlInput: { maxLength: FEEDBACK_MAX } }} />
        <Button variant="contained" onClick={save} disabled={saving || points === '' || !!error}>
          Save
        </Button>
      </Stack>
    </Paper>
  );
}

/** FR-24: "By student" (one attempt at a time) and "By question" (all answers to one question). */
export function QuizGradingWorkspace({ questions, initialAttempts }: { questions: ManagerQuestion[]; initialAttempts: ManagerAttempt[] }) {
  const [attempts, setAttempts] = useState(initialAttempts);
  const [mode, setMode] = useState<'student' | 'question'>('student');
  const firstPending = attempts.find((a) => a.status === 'NEEDS_GRADING') ?? attempts[0];
  const [attemptId, setAttemptId] = useState(firstPending?.id ?? '');
  const [questionId, setQuestionId] = useState((questions.find((q) => q.type === 'ESSAY') ?? questions[0])?.id ?? '');

  if (!attempts.length) return <EmptyState title="No submitted attempts yet" />;

  const onSaved = (attempt: ManagerAttempt) => (answer: ManagerAnswer, a: { status: ManagerAttempt['status']; score: string | null }) =>
    setAttempts((list) =>
      list.map((x) =>
        x.id === attempt.id
          ? { ...x, status: a.status, score: a.score, answers: [...x.answers.filter((y) => y.questionId !== answer.questionId), answer] }
          : x,
      ),
    );
  const label = (a: ManagerAttempt) => `${a.student.name} — attempt ${a.attemptNumber}`;
  const current = attempts.find((a) => a.id === attemptId) ?? attempts[0];
  const question = questions.find((q) => q.id === questionId) ?? questions[0];
  const pendingCount = attempts.filter((a) => a.status === 'NEEDS_GRADING').length;

  return (
    <Box>
      <Alert severity={pendingCount ? 'warning' : 'success'} sx={{ mb: 2 }}>
        {pendingCount ? `${pendingCount} attempt${pendingCount > 1 ? 's' : ''} need grading.` : 'Everything is graded.'}
      </Alert>
      <Tabs value={mode} onChange={(_e, m) => setMode(m)} aria-label="Grading mode" sx={{ mb: 2 }}>
        <Tab value="student" label="By student" />
        <Tab value="question" label="By question" />
      </Tabs>

      {mode === 'student' ? (
        <Stack spacing={2}>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            <TextField select size="small" label="Attempt" value={current.id} onChange={(e) => setAttemptId(e.target.value)} sx={{ minWidth: 320 }}>
              {attempts.map((a) => (
                <MenuItem key={a.id} value={a.id}>
                  {label(a)} {a.status === 'NEEDS_GRADING' ? '• needs grading' : ''}
                </MenuItem>
              ))}
            </TextField>
            <Chip label={current.status} color={current.status === 'GRADED' ? 'success' : 'warning'} />
            <Typography>
              Score: {pts(current.score)} / {pts(current.maxScore)}
            </Typography>
          </Stack>
          {current.questions.map((q, i) => (
            <Box key={`${current.id}-${q.id}`}>
              <MarkdownView source={q.prompt} />
              <GradeForm
                attempt={current}
                question={q}
                answer={current.answers.find((x) => x.questionId === q.id)}
                onSaved={onSaved(current)}
                heading={`Question ${i + 1} · ${QUESTION_TYPE_LABELS[q.type]}`}
              />
            </Box>
          ))}
        </Stack>
      ) : (
        <Stack spacing={2}>
          <TextField select size="small" label="Question" value={question.id} onChange={(e) => setQuestionId(e.target.value)} sx={{ maxWidth: 480 }}>
            {questions.map((q, i) => (
              <MenuItem key={q.id} value={q.id}>
                Question {i + 1} · {QUESTION_TYPE_LABELS[q.type]}
              </MenuItem>
            ))}
          </TextField>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <MarkdownView source={question.prompt} />
            {question.type === 'ESSAY' && typeof (question.correct as { guidance?: string })?.guidance === 'string' && (
              <Alert severity="info" sx={{ mt: 1 }}>
                Guidance: {(question.correct as { guidance: string }).guidance}
              </Alert>
            )}
          </Paper>
          {attempts.map((a) => (
            <GradeForm key={`${a.id}-${question.id}`} attempt={a} question={question} answer={a.answers.find((x) => x.questionId === question.id)} onSaved={onSaved(a)} heading={label(a)} />
          ))}
        </Stack>
      )}
    </Box>
  );
}
