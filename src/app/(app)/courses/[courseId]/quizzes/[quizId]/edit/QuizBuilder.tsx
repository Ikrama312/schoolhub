'use client';

import { useState } from 'react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import LockIcon from '@mui/icons-material/Lock';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { useToast } from '@/components/Toast/useToast';
import type { ManagerQuiz } from '@/server/quiz/quiz-service';
import type { StudentAttempt } from '@/server/quiz/serializers';
import { QuizPlayer } from '@/app/(app)/quizzes/[quizId]/take/QuizPlayer';
import { QuestionList } from './QuestionList';
import { QuizSettingsPanel, type AccommodationRow } from './QuizSettingsPanel';

const STATUS_COLOR = { DRAFT: 'default', PUBLISHED: 'success', CLOSED: 'info' } as const;

/** A10: a non-recording attempt built from the manager quiz — no correct answers are passed to the player. */
function previewAttempt(quiz: ManagerQuiz): StudentAttempt {
  const now = new Date();
  const ms = quiz.timeLimitMinutes ? quiz.timeLimitMinutes * 60_000 : 60 * 60_000;
  return {
    id: `preview-${quiz.id}`,
    quizId: quiz.id,
    quizTitle: quiz.title,
    attemptNumber: 1,
    status: 'IN_PROGRESS',
    startedAt: now.toISOString(),
    deadlineAt: new Date(now.getTime() + ms).toISOString(),
    serverNow: now.toISOString(),
    oneQuestionPerPage: quiz.oneQuestionPerPage,
    questions: quiz.questions.map((q) => ({ id: q.id, type: q.type, prompt: q.prompt, points: q.points, options: q.options })),
    answers: [],
  };
}

type Action = 'publish' | 'close' | 'delete' | 'regrade' | 'release' | null;

/** FR-6..FR-10 builder shell: running total, publish check, lock banner + Regrade, preview, settings. */
export function QuizBuilder({ quiz, timezone, accommodations }: { quiz: ManagerQuiz; timezone: string; accommodations: AccommodationRow[] }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [tab, setTab] = useState<'questions' | 'settings'>('questions');
  const [preview, setPreview] = useState(false);
  const [action, setAction] = useState<Action>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const refresh = () => router.refresh();
  const base = `/courses/${quiz.courseId}/quizzes/${quiz.id}`;

  const call = async (url: string, method: string, body?: unknown) => {
    const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => null);
    return { ok: res.ok, json };
  };

  const run = async (a: Exclude<Action, null>) => {
    setAction(null);
    if (a === 'publish' || a === 'close') {
      const { ok, json } = await call(`/api/quizzes/${quiz.id}`, 'PATCH', { status: a === 'publish' ? 'PUBLISHED' : 'CLOSED' });
      if (!ok) {
        setProblems(json?.error?.details?.problems ?? []);
        showToast({ message: json?.error?.message ?? 'Could not update the quiz.', severity: 'error' });
        return;
      }
      setProblems([]);
      showToast({ message: a === 'publish' ? 'Quiz published — students have been notified.' : 'Quiz closed.', severity: 'success' });
    } else if (a === 'delete') {
      const { ok, json } = await call(`/api/quizzes/${quiz.id}`, 'DELETE');
      if (!ok) return showToast({ message: json?.error?.message ?? 'Could not delete.', severity: 'error' });
      router.push(`/courses/${quiz.courseId}/quizzes`);
      return;
    } else if (a === 'regrade') {
      const { ok, json } = await call(`/api/quizzes/${quiz.id}/regrade`, 'POST');
      if (!ok) return showToast({ message: json?.error?.message ?? 'Regrade failed.', severity: 'error' });
      showToast({ message: `Regraded ${json.data.attemptCount} attempts (${json.data.changedAnswerCount} answers changed).`, severity: 'success' });
    } else if (a === 'release') {
      const { ok, json } = await call(`/api/quizzes/${quiz.id}/release-results`, 'POST');
      if (!ok) return showToast({ message: json?.error?.message ?? 'Could not release results.', severity: 'error' });
      showToast({ message: 'Results released to students and parents.', severity: 'success' });
    }
    refresh();
  };

  const shownProblems = problems.length ? problems : quiz.status === 'DRAFT' ? quiz.publishProblems : [];
  const confirmText: Record<Exclude<Action, null>, { title: string; description: string; label: string; destructive?: boolean }> = {
    publish: { title: 'Publish this quiz?', description: 'Enrolled students are notified and can take it during its window.', label: 'Publish' },
    close: { title: 'Close this quiz?', description: 'No new attempts can be started. This cannot be undone.', label: 'Close quiz' },
    delete: { title: 'Delete this quiz?', description: 'The quiz and its questions are removed permanently.', label: 'Delete', destructive: true },
    regrade: { title: 'Regrade all attempts?', description: 'Auto-graded answers are recomputed from the current accepted answers. Hand-graded answers are kept.', label: 'Regrade' },
    release: { title: 'Release results?', description: 'Students and their parents can see scores and are notified.', label: 'Release' },
  };

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 2 }} useFlexGap>
        <Chip label={quiz.status} color={STATUS_COLOR[quiz.status]} />
        <Typography variant="body1" sx={{ flex: 1 }} aria-live="polite">
          {quiz.questions.length} questions · <strong>{quiz.totalPoints.replace(/\.00$/, '')} points</strong> total
        </Typography>
        <Button startIcon={<VisibilityIcon />} onClick={() => setPreview(true)} disabled={!quiz.questions.length}>
          Preview as student
        </Button>
        {quiz.attemptCount > 0 && (
          <>
            <Button component={NextLink} href={`${base}/grade`}>
              Grade
            </Button>
            <Button component={NextLink} href={`${base}/analytics`}>
              Analytics
            </Button>
          </>
        )}
        {quiz.resultsVisibility === 'MANUAL' && quiz.status !== 'DRAFT' && !quiz.resultsReleasedAt && (
          <Button variant="outlined" onClick={() => setAction('release')}>
            Release results
          </Button>
        )}
        {quiz.status === 'DRAFT' && (
          <Button variant="contained" onClick={() => setAction('publish')} disabled={quiz.publishProblems.length > 0}>
            Publish
          </Button>
        )}
        {quiz.status === 'PUBLISHED' && (
          <Button variant="outlined" onClick={() => setAction('close')}>
            Close quiz
          </Button>
        )}
        {!quiz.locked && (
          <Button color="error" onClick={() => setAction('delete')}>
            Delete
          </Button>
        )}
      </Stack>

      {shownProblems.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <AlertTitle>Before you can publish</AlertTitle>
          <Box component="ul" sx={{ m: 0, pl: 2 }}>
            {shownProblems.map((p) => (
              <Box component="li" key={p}>{p}</Box>
            ))}
          </Box>
        </Alert>
      )}
      {quiz.locked && (
        <Alert
          severity="info"
          icon={<LockIcon />}
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={() => setAction('regrade')}>
              Regrade
            </Button>
          }
        >
          {quiz.attemptCount} attempt{quiz.attemptCount > 1 ? 's' : ''} exist. You can still edit question text, explanations and accepted answers; adding, removing, reordering
          or re-scoring questions is blocked. Use Regrade after editing accepted answers.
        </Alert>
      )}

      <Tabs value={tab} onChange={(_e, t) => setTab(t)} aria-label="Quiz builder sections" sx={{ mb: 2 }}>
        <Tab value="questions" label="Questions" />
        <Tab value="settings" label="Settings" />
      </Tabs>
      {tab === 'questions' ? (
        <QuestionList quizId={quiz.id} questions={quiz.questions} locked={quiz.locked} onChanged={refresh} />
      ) : (
        <QuizSettingsPanel quiz={quiz} timezone={timezone} accommodations={accommodations} onSaved={refresh} />
      )}

      <Dialog fullScreen open={preview} onClose={() => setPreview(false)} aria-labelledby="quiz-preview-title">
        <DialogTitle id="quiz-preview-title" sx={{ display: 'flex', alignItems: 'center' }}>
          <Box sx={{ flex: 1 }}>Preview as student — nothing is recorded</Box>
          <IconButton aria-label="Close preview" onClick={() => setPreview(false)}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>{preview && <QuizPlayer attempt={previewAttempt(quiz)} mode="preview" onExitPreview={() => setPreview(false)} />}</DialogContent>
      </Dialog>

      {action && (
        <ConfirmDialog
          open
          title={confirmText[action].title}
          description={confirmText[action].description}
          confirmLabel={confirmText[action].label}
          destructive={confirmText[action].destructive}
          onConfirm={() => run(action)}
          onCancel={() => setAction(null)}
        />
      )}
    </Box>
  );
}
