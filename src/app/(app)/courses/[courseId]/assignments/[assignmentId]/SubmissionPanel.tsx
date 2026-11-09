'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { MarkdownEditor } from '@/components/MarkdownEditor/MarkdownEditor';
import { MarkdownView } from '@/components/MarkdownView/MarkdownView';
import { FileUpload, type FileRef } from '@/components/FileUpload/FileUpload';
import { FileList } from '@/components/FileList/FileList';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { useToast } from '@/components/Toast/useToast';
import { formatInSchoolTz } from '@/lib/dates';
import { SUBMISSION_TEXT_MAX } from '@/lib/validators/assignments';
import type { AssignmentDto, SubmissionDto } from '@/server/assignments/assignments-service';

const pts = (s: string | null) => (s === null ? '—' : String(Number(s)));

/** Server-clock offset for display only (FR-19); the server re-checks every deadline (NFR-2). */
function useServerNow(serverNow: string, tickMs: number) {
  const [offset] = useState(() => Date.parse(serverNow) - Date.now());
  const [now, setNow] = useState(() => Date.parse(serverNow));
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + offset), tickMs);
    return () => clearInterval(t);
  }, [offset, tickMs]);
  return now;
}

/** FR-19: "Due in 5 h 12 min" when under 48 h remain. */
export function DueCountdown({ dueAt, serverNow }: { dueAt: string; serverNow: string }) {
  const now = useServerNow(serverNow, 30_000);
  const left = Date.parse(dueAt) - now;
  if (left <= 0 || left > 48 * 3_600_000) return null;
  const h = Math.floor(left / 3_600_000);
  const m = Math.floor((left % 3_600_000) / 60_000);
  return <Chip color="warning" label={`Due in ${h} h ${m} min`} aria-live="polite" />;
}

/** FR-26: score, rubric breakdown, penalty and feedback after return. */
export function ReturnedResults({ assignment, submission }: { assignment: AssignmentDto; submission: SubmissionDto }) {
  return (
    <Stack spacing={2}>
      <Typography variant="h4" component="p">
        {pts(submission.finalScore)} <Typography component="span" variant="h6" color="text.secondary">/ {pts(assignment.maxPoints)}</Typography>
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Raw score {pts(submission.rawScore)}
        {submission.penaltyPercent && Number(submission.penaltyPercent) > 0 ? ` · late penalty ${pts(submission.penaltyPercent)} %` : ''}
      </Typography>
      {assignment.rubric && submission.rubricScores && (
        <Table size="small" aria-label="Rubric scores">
          <TableHead>
            <TableRow>
              <TableCell>Criterion</TableCell>
              <TableCell align="right">Points</TableCell>
              <TableCell>Comment</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {assignment.rubric.map((c) => {
              const s = submission.rubricScores?.find((r) => r.criterionId === c.id);
              return (
                <TableRow key={c.id}>
                  <TableCell>{c.title}</TableCell>
                  <TableCell align="right">
                    {s ? pts(s.points) : '—'} / {pts(c.maxPoints)}
                  </TableCell>
                  <TableCell>{s?.comment ?? ''}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {submission.feedback && (
        <Box>
          <Typography variant="subtitle2" gutterBottom>
            Feedback
          </Typography>
          <MarkdownView source={submission.feedback} />
        </Box>
      )}
    </Stack>
  );
}

export interface SubmissionPanelProps {
  assignment: AssignmentDto;
  submission: SubmissionDto | null;
  exempt: boolean;
  userId: string;
  /** PARENT view: results only, no editor (FR-18). */
  readOnly: boolean;
  timezone: string;
  serverNow: string;
}

/** FR-20..FR-27 student submission panel. */
export function SubmissionPanel({ assignment: a, submission: initialSubmission, exempt, userId, readOnly, timezone, serverNow }: SubmissionPanelProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const now = useServerNow(serverNow, 60_000);
  const [submission, setSubmission] = useState(initialSubmission);
  const [editing, setEditing] = useState(!initialSubmission);
  const draftKey = `assignment:${a.id}:${userId}`;
  const [text, setText] = useState('');
  const [files, setFiles] = useState<FileRef[]>(initialSubmission?.files ?? []);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // FR-20: draft text lives in localStorage only.
  useEffect(() => {
    setText(window.localStorage.getItem(draftKey) ?? initialSubmission?.text ?? '');
  }, [draftKey, initialSubmission?.text]);
  const changeText = (v: string) => {
    setText(v);
    window.localStorage.setItem(draftKey, v);
  };

  const takesText = a.submissionType === 'ONLINE_TEXT' || a.submissionType === 'TEXT_AND_FILE';
  const takesFiles = a.submissionType === 'FILE_UPLOAD' || a.submissionType === 'TEXT_AND_FILE';
  const due = Date.parse(a.dueAt);
  const open = now <= due || (a.allowLate && (!a.lateCutoffAt || now <= Date.parse(a.lateCutoffAt)));
  const canSubmit =
    (a.submissionType === 'ONLINE_TEXT' && text.trim().length > 0) ||
    (a.submissionType === 'FILE_UPLOAD' && files.length > 0) ||
    (a.submissionType === 'TEXT_AND_FILE' && (text.trim().length > 0 || files.length > 0));

  async function doSubmit() {
    setError(null);
    const res = await fetch(`/api/assignments/${a.id}/submissions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: takesText ? text : undefined, fileIds: takesFiles ? files.map((f) => f.id) : [] }),
    });
    const json = await res.json().catch(() => ({}));
    setConfirm(false);
    if (!res.ok) {
      setError(json?.error?.message ?? 'Could not submit.');
      return;
    }
    window.localStorage.removeItem(draftKey);
    setSubmission(json.data as SubmissionDto);
    setEditing(false);
    showToast({ message: 'Submitted', severity: 'success' });
    router.refresh();
  }

  const body = (() => {
    if (submission?.status === 'RETURNED') return <ReturnedResults assignment={a} submission={submission} />;
    if (exempt) return <Alert severity="info">{readOnly ? 'This student is' : 'You are'} exempt from this assignment.</Alert>;
    if (a.submissionType === 'NO_SUBMISSION' && !submission) return <Alert severity="info">No online submission. This assignment is graded by your teacher.</Alert>;

    const receipt = submission && (
      <Stack spacing={1.5}>
        <Typography>
          {submission.attemptNumber === 0
            ? 'Graded without a submission'
            : `Submitted ${formatInSchoolTz(submission.submittedAt, 'EEE d MMM yyyy, HH:mm', timezone)} (attempt ${submission.attemptNumber})`}
          {submission.isLate && <Chip size="small" color="warning" label={`Late · ${submission.lateDays} day${submission.lateDays === 1 ? '' : 's'}`} sx={{ ml: 1 }} />}
        </Typography>
        <Alert severity="info">Submitted — awaiting grading</Alert>
        {submission.text && (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <MarkdownView source={submission.text} />
          </Paper>
        )}
        <FileList files={submission.files} />
      </Stack>
    );

    if (readOnly) return receipt ?? <Typography color="text.secondary">Not submitted yet.</Typography>;
    if (!editing) {
      return (
        <Stack spacing={2}>
          {receipt}
          {open && a.submissionType !== 'NO_SUBMISSION' && (
            <Box>
              <Button variant="outlined" onClick={() => setEditing(true)}>
                Resubmit
              </Button>
            </Box>
          )}
        </Stack>
      );
    }
    if (!open) return <Alert severity="warning">The deadline has passed and late submissions are closed.</Alert>;
    return (
      <Stack spacing={2}>
        {now > due && <Alert severity="warning">This will be marked late.</Alert>}
        {takesText && <MarkdownEditor label="Your answer" value={text} onChange={changeText} maxLength={SUBMISSION_TEXT_MAX} />}
        {takesFiles && <FileUpload context="submission" max={a.maxFileCount} value={files} onChange={setFiles} />}
        {error && <Alert severity="error">{error}</Alert>}
        <Stack direction="row" spacing={1}>
          <Button variant="contained" disabled={!canSubmit} onClick={() => setConfirm(true)}>
            Submit
          </Button>
          {submission && <Button onClick={() => setEditing(false)}>Cancel</Button>}
        </Stack>
      </Stack>
    );
  })();

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="h6" component="h2" gutterBottom>
        {readOnly ? 'Submission' : 'Your work'}
      </Typography>
      <Divider sx={{ mb: 2 }} />
      {body}
      <ConfirmDialog
        open={confirm}
        title={submission ? 'Resubmit your work?' : 'Submit your work?'}
        description={submission ? 'Your previous attempt will be replaced. Your teacher can still see earlier attempts.' : 'You can resubmit until the deadline, unless your work has been returned.'}
        confirmLabel="Submit"
        onConfirm={doSubmit}
        onCancel={() => setConfirm(false)}
      />
    </Paper>
  );
}
