'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormGroup from '@mui/material/FormGroup';
import FormLabel from '@mui/material/FormLabel';
import LinearProgress from '@mui/material/LinearProgress';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CloudDoneIcon from '@mui/icons-material/CloudDone';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import CloudSyncIcon from '@mui/icons-material/CloudSync';
import FlagIcon from '@mui/icons-material/Flag';
import OutlinedFlagIcon from '@mui/icons-material/OutlinedFlag';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { MarkdownView } from '@/components/MarkdownView/MarkdownView';
import { useToast } from '@/components/Toast/useToast';
import { formatInSchoolTz } from '@/lib/dates';
import { ANSWER_TEXT_MAX, type AnswerResponse } from '@/lib/validators/quiz';
import type { StudentAttempt, StudentQuiz } from '@/server/quiz/serializers';
import { useAutosave } from './useAutosave';

type Resp = AnswerResponse | null;
type Question = StudentAttempt['questions'][number];

const pts = (p: string) => p.replace(/\.00$/, '');
const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export function isAnswered(r: Resp | undefined): boolean {
  if (!r) return false;
  if ('text' in r) return r.text.trim() !== '';
  if ('optionIds' in r) return r.optionIds.length > 0;
  return true;
}

// ---------------------------------------------------------------------------
// Start screen (FR-12)
// ---------------------------------------------------------------------------

export function StartScreen({
  quiz,
  timezone,
  attempts,
}: {
  quiz: StudentQuiz;
  timezone: string;
  attempts: { id: string; attemptNumber: number; submittedAt: string | null }[];
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [confirm, setConfirm] = useState(false);
  const canStart = quiz.isOpen && quiz.attemptsUsed < quiz.attemptLimit;
  const minutes = quiz.timeLimitMinutes ? quiz.timeLimitMinutes + quiz.extraTimeMinutes : null;

  const start = async () => {
    const res = await fetch(`/api/quizzes/${quiz.id}/attempts`, { method: 'POST' });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      showToast({ message: body?.error?.message ?? 'Could not start the quiz.', severity: 'error' });
      setConfirm(false);
      return;
    }
    router.refresh();
  };

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Stack spacing={2}>
        {quiz.instructions && <MarkdownView source={quiz.instructions} />}
        <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 2, rowGap: 0.5, m: 0 }}>
          {[
            ['Questions', String(quiz.questionCount)],
            ['Total points', pts(quiz.totalPoints)],
            ['Time limit', minutes ? `${minutes} minutes${quiz.extraTimeMinutes ? ` (incl. ${quiz.extraTimeMinutes} extra)` : ''}` : 'None'],
            ['Attempts', `${quiz.attemptsUsed} used of ${quiz.attemptLimit}`],
            ['Closes', formatInSchoolTz(quiz.availableUntil, 'EEE d MMM yyyy, HH:mm', timezone)],
          ].map(([k, v]) => (
            <Box key={k} sx={{ display: 'contents' }}>
              <Typography component="dt" variant="body2" color="text.secondary">
                {k}
              </Typography>
              <Typography component="dd" variant="body2" sx={{ m: 0 }}>
                {v}
              </Typography>
            </Box>
          ))}
        </Box>
        {!quiz.isOpen && <Alert severity="info">{new Date(quiz.availableFrom) > new Date() ? `This quiz opens ${formatInSchoolTz(quiz.availableFrom, 'EEE d MMM, HH:mm', timezone)}.` : 'This quiz is closed.'}</Alert>}
        {quiz.isOpen && !canStart && <Alert severity="info">You have used all your attempts.</Alert>}
        {attempts.length > 0 && (
          <Stack spacing={0.5}>
            <Typography variant="subtitle2" component="h2">
              Your attempts
            </Typography>
            {attempts.map((a) => (
              <Link key={a.id} component={NextLink} href={`/quizzes/${quiz.id}/attempts/${a.id}`}>
                Attempt {a.attemptNumber}
                {a.submittedAt ? ` — submitted ${formatInSchoolTz(a.submittedAt, 'd MMM, HH:mm', timezone)}` : ''}
              </Link>
            ))}
          </Stack>
        )}
        <Box>
          <Button variant="contained" disabled={!canStart} onClick={() => setConfirm(true)}>
            Start attempt
          </Button>
        </Box>
      </Stack>
      <ConfirmDialog
        open={confirm}
        title="Start this attempt?"
        description={minutes ? `The ${minutes}-minute timer starts as soon as you start and keeps running if you leave the page.` : 'Your attempt starts now. Answers save automatically.'}
        confirmLabel="Start"
        onConfirm={start}
        onCancel={() => setConfirm(false)}
      />
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// One question (NFR-3: native radio/checkbox inputs inside a fieldset)
// ---------------------------------------------------------------------------

function QuestionField({ q, index, value, onChange }: { q: Question; index: number; value: Resp | undefined; onChange: (r: Resp) => void }) {
  const legendId = `q-${q.id}-legend`;
  const r = (value ?? null) as Record<string, unknown> | null;
  let input: React.ReactNode;
  switch (q.type) {
    case 'SINGLE_CHOICE':
      input = (
        <RadioGroup aria-labelledby={legendId} value={(r?.optionId as string) ?? ''} onChange={(_e, v) => onChange({ optionId: v })}>
          {q.options?.map((o) => <FormControlLabel key={o.id} value={o.id} control={<Radio />} label={o.text} />)}
        </RadioGroup>
      );
      break;
    case 'TRUE_FALSE':
      input = (
        <RadioGroup aria-labelledby={legendId} value={r && typeof r.value === 'boolean' ? String(r.value) : ''} onChange={(_e, v) => onChange({ value: v === 'true' })}>
          <FormControlLabel value="true" control={<Radio />} label="True" />
          <FormControlLabel value="false" control={<Radio />} label="False" />
        </RadioGroup>
      );
      break;
    case 'MULTIPLE_CHOICE': {
      const chosen = new Set((r?.optionIds as string[]) ?? []);
      input = (
        <FormGroup>
          {q.options?.map((o) => (
            <FormControlLabel
              key={o.id}
              label={o.text}
              control={
                <Checkbox
                  checked={chosen.has(o.id)}
                  onChange={(e) => {
                    const next = new Set(chosen);
                    if (e.target.checked) next.add(o.id);
                    else next.delete(o.id);
                    onChange({ optionIds: q.options!.map((x) => x.id).filter((id) => next.has(id)) });
                  }}
                />
              }
            />
          ))}
        </FormGroup>
      );
      break;
    }
    default:
      input = (
        <TextField
          value={(r?.text as string) ?? ''}
          onChange={(e) => onChange({ text: e.target.value })}
          fullWidth
          multiline={q.type === 'ESSAY'}
          minRows={q.type === 'ESSAY' ? 6 : undefined}
          slotProps={{ htmlInput: { maxLength: ANSWER_TEXT_MAX, 'aria-labelledby': legendId } }}
          helperText={q.type === 'ESSAY' ? `${((r?.text as string) ?? '').length} / ${ANSWER_TEXT_MAX}` : undefined}
        />
      );
  }
  return (
    <FormControl component="fieldset" sx={{ width: '100%' }}>
      <FormLabel component="legend" id={legendId} sx={{ mb: 1, color: 'text.primary' }}>
        <Typography variant="subtitle1" component="span" sx={{ fontWeight: 600 }}>
          Question {index + 1}
        </Typography>{' '}
        <Typography variant="body2" component="span" color="text.secondary">
          ({pts(q.points)} {q.points === '1.00' ? 'point' : 'points'})
        </Typography>
      </FormLabel>
      <Box sx={{ mb: 1 }}>
        <MarkdownView source={q.prompt} />
      </Box>
      {input}
    </FormControl>
  );
}

// ---------------------------------------------------------------------------
// Player (FR-13..FR-17, NFR-3)
// ---------------------------------------------------------------------------

const STATUS_LABEL = { saved: 'All answers saved', saving: 'Saving…', offline: 'Offline — answers saved on this device', stopped: 'Submitted' } as const;
// Default-coloured chip + icon: the theme's success/warning fills fail 4.5:1 contrast for chip text (NFR-3).
const STATUS_ICON = { saved: <CloudDoneIcon />, saving: <CloudSyncIcon />, offline: <CloudOffIcon />, stopped: <CloudDoneIcon /> } as const;

export function QuizPlayer({ attempt, mode = 'live', onExitPreview }: { attempt: StudentAttempt; mode?: 'live' | 'preview'; onExitPreview?: () => void }) {
  const router = useRouter();
  const { showToast } = useToast();
  const resultHref = `/quizzes/${attempt.quizId}/attempts/${attempt.id}`;
  const done = useRef(false);
  const goToResult = useCallback(() => {
    if (done.current) return;
    done.current = true;
    router.push(resultHref);
    router.refresh();
  }, [router, resultHref]);

  const { save, flush, status, restored } = useAutosave(attempt.id, mode, goToResult);
  const [responses, setResponses] = useState<Record<string, Resp>>(() => Object.fromEntries(attempt.answers.map((a) => [a.questionId, a.response as Resp])));
  // Queued (unsent) answers win over the server copy after a reload (FR-19, AC-2).
  useEffect(() => {
    if (Object.keys(restored).length) setResponses((r) => ({ ...r, ...restored }));
  }, [restored]);

  const [page, setPage] = useState(0);
  const [flags, setFlags] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Display-only timer corrected for client clock skew (ADR-4).
  const skew = useMemo(() => new Date(attempt.serverNow).getTime() - Date.now(), [attempt.serverNow]);
  const deadline = new Date(attempt.deadlineAt).getTime();
  const [now, setNow] = useState(() => Date.now() + skew);
  const [announce, setAnnounce] = useState('');
  const announced = useRef(new Set<number>());
  const remaining = deadline - now;

  const submit = useCallback(
    async (auto = false) => {
      if (mode === 'preview') {
        showToast({ message: 'Preview finished — nothing was recorded.', severity: 'info' });
        onExitPreview?.();
        return;
      }
      setSubmitting(true);
      await flush();
      if (done.current) return;
      const res = await fetch(`/api/attempts/${attempt.id}/submit`, { method: 'POST' });
      if (!res.ok && !auto) {
        setSubmitting(false);
        showToast({ message: 'Could not submit. Your answers are saved — try again.', severity: 'error' });
        return;
      }
      goToResult();
    },
    [mode, flush, attempt.id, goToResult, showToast, onExitPreview],
  );

  useEffect(() => {
    if (mode === 'preview') return;
    const id = setInterval(() => setNow(Date.now() + skew), 1000);
    return () => clearInterval(id);
  }, [skew, mode]);

  useEffect(() => {
    for (const min of [5, 1]) {
      if (remaining <= min * 60_000 && remaining > (min - 1) * 60_000 && !announced.current.has(min)) {
        announced.current.add(min);
        setAnnounce(`${min} minute${min > 1 ? 's' : ''} remaining`);
      }
    }
    if (remaining <= 0 && mode === 'live' && !done.current && !submitting) void submit(true);
  }, [remaining, mode, submit, submitting]);

  const setAnswer = (qid: string, r: Resp) => {
    setResponses((prev) => ({ ...prev, [qid]: r }));
    save(qid, r);
  };

  const qs = attempt.questions;
  const answeredCount = qs.filter((q) => isAnswered(responses[q.id])).length;
  const unanswered = qs.length - answeredCount;
  const visible = attempt.oneQuestionPerPage ? [qs[page]].filter(Boolean) : qs;
  // Untimed attempts end at availableUntil; only count down once that is within a day.
  const timed = remaining < 24 * 3_600_000;

  return (
    <Box>
      <Paper elevation={2} sx={{ position: 'sticky', top: 0, zIndex: (t) => t.zIndex.appBar - 1, p: 2, mb: 2 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }} useFlexGap>
          <Typography variant="h6" component="h1" sx={{ flex: 1, minWidth: 160 }}>
            {attempt.quizTitle}
            {mode === 'preview' && <Chip size="small" label="Preview" color="info" sx={{ ml: 1 }} />}
          </Typography>
          {timed && (
            <Typography
              variant="h6"
              component="p"
              aria-label={`Time remaining ${mmss(remaining)}`}
              sx={{ fontVariantNumeric: 'tabular-nums', color: remaining < 2 * 60_000 ? 'error.main' : 'text.primary', m: 0 }}
            >
              {mmss(remaining)}
            </Typography>
          )}
          <Chip label={mode === 'preview' ? 'Not recorded' : STATUS_LABEL[status]} icon={mode === 'preview' ? undefined : STATUS_ICON[status]} variant="outlined" size="small" />
          <Button variant="contained" onClick={() => setConfirm(true)} disabled={submitting}>
            Submit
          </Button>
        </Stack>
        <Box role="status" aria-live="assertive" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
          {announce}
        </Box>
        <LinearProgress variant="determinate" value={qs.length ? (answeredCount / qs.length) * 100 : 0} sx={{ mt: 1.5 }} aria-label={`${answeredCount} of ${qs.length} answered`} />
      </Paper>

      {attempt.oneQuestionPerPage && (
        <Box component="nav" aria-label="Question navigator" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
          {qs.map((q, i) => {
            const flagged = flags.has(q.id);
            return (
              <Button
                key={q.id}
                size="small"
                variant={isAnswered(responses[q.id]) ? 'contained' : 'outlined'}
                color={flagged ? 'warning' : 'primary'}
                aria-current={i === page ? 'step' : undefined}
                aria-label={`Question ${i + 1}, ${isAnswered(responses[q.id]) ? 'answered' : 'unanswered'}${flagged ? ', flagged' : ''}`}
                onClick={() => setPage(i)}
                sx={{ minWidth: 40, outline: i === page ? 2 : 0, outlineColor: 'primary.main', outlineOffset: 2 }}
              >
                {i + 1}
              </Button>
            );
          })}
        </Box>
      )}

      <Stack spacing={2}>
        {visible.map((q) => {
          const i = qs.indexOf(q);
          return (
            <Paper key={q.id} variant="outlined" sx={{ p: 2 }}>
              <QuestionField q={q} index={i} value={responses[q.id]} onChange={(r) => setAnswer(q.id, r)} />
              <Box sx={{ mt: 1 }}>
                <Button
                  size="small"
                  startIcon={flags.has(q.id) ? <FlagIcon /> : <OutlinedFlagIcon />}
                  aria-pressed={flags.has(q.id)}
                  onClick={() =>
                    setFlags((f) => {
                      const n = new Set(f);
                      if (n.has(q.id)) n.delete(q.id);
                      else n.add(q.id);
                      return n;
                    })
                  }
                >
                  {flags.has(q.id) ? 'Flagged for review' : 'Flag for review'}
                </Button>
              </Box>
            </Paper>
          );
        })}
      </Stack>

      {attempt.oneQuestionPerPage && (
        <Stack direction="row" spacing={1} sx={{ mt: 2, justifyContent: 'space-between' }}>
          <Button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <Button disabled={page >= qs.length - 1} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </Stack>
      )}

      <ConfirmDialog
        open={confirm}
        title="Submit your answers?"
        description={unanswered ? `You have ${unanswered} unanswered question${unanswered > 1 ? 's' : ''}. You can't change answers after submitting.` : "All questions are answered. You can't change answers after submitting."}
        confirmLabel="Submit"
        onConfirm={async () => {
          setConfirm(false);
          await submit();
        }}
        onCancel={() => setConfirm(false)}
      />
    </Box>
  );
}
