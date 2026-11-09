'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { MarkdownEditor } from '@/components/MarkdownEditor/MarkdownEditor';
import { MarkdownView } from '@/components/MarkdownView/MarkdownView';
import { FileList } from '@/components/FileList/FileList';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { useToast } from '@/components/Toast/useToast';
import { formatInSchoolTz } from '@/lib/dates';
import { FEEDBACK_MAX } from '@/lib/validators/assignments';
import { computeFinalScore, defaultPenalty, maxRawScore, rubricTotal, type ChipStatus } from '@/server/assignments/grading-math';
import type { AssignmentDto, RosterRow, SubmissionDto } from '@/server/assignments/assignments-service';

const CHIP: Record<ChipStatus, { label: string; color: 'default' | 'info' | 'warning' | 'success' | 'primary' | 'secondary' }> = {
  NOT_SUBMITTED: { label: 'Not submitted', color: 'default' },
  SUBMITTED: { label: 'Submitted', color: 'info' },
  LATE: { label: 'Late', color: 'warning' },
  GRADED: { label: 'Graded', color: 'primary' },
  RETURNED: { label: 'Returned', color: 'success' },
  EXEMPT: { label: 'Exempt', color: 'secondary' },
};
const isNum = (v: string) => /^\d+(\.\d{1,2})?$/.test(v.trim());
const pts = (s: string) => String(Number(s));

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init?.body ? { ...init, headers: { 'content-type': 'application/json' } } : init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message ?? 'Request failed');
  return json.data as T;
}

async function fetchRoster(assignmentId: string): Promise<RosterRow[]> {
  const rows: RosterRow[] = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`/api/assignments/${assignmentId}/submissions?page=${page}&pageSize=100`);
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message ?? 'Could not load the roster');
    rows.push(...json.data);
    if (rows.length >= json.meta.total || json.data.length === 0) return rows;
  }
}

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

export interface GradingWorkspaceProps {
  assignment: AssignmentDto;
  initialRoster: RosterRow[];
  timezone: string;
}

/** FR-28..FR-36 grading screen; NFR-3 Map cache + next/prev prefetch; FR-33 keyboard shortcuts. */
export function GradingWorkspace({ assignment: a, initialRoster, timezone }: GradingWorkspaceProps) {
  const { showToast } = useToast();
  const [roster, setRoster] = useState(initialRoster);
  const [filter, setFilter] = useState<ChipStatus | ''>('');
  const [sort, setSort] = useState<'name' | 'submittedAt'>('name');
  const [selectedId, setSelectedId] = useState<string | null>(initialRoster[0]?.student.id ?? null);
  const cache = useRef(new Map<string, SubmissionDto>());
  const [submission, setSubmission] = useState<SubmissionDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState<'current' | number>('current');
  const [levels, setLevels] = useState<Record<string, number | null>>({});
  const [raw, setRaw] = useState('');
  const [penalty, setPenalty] = useState('0');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmReturnAll, setConfirmReturnAll] = useState(false);

  const visible = useMemo(() => {
    const rows = roster.filter((r) => !filter || r.chipStatus === filter);
    if (sort === 'submittedAt') return [...rows].sort((x, y) => (x.submission?.submittedAt ?? '￿').localeCompare(y.submission?.submittedAt ?? '￿'));
    return rows;
  }, [roster, filter, sort]);
  const index = visible.findIndex((r) => r.student.id === selectedId);
  const row = index >= 0 ? visible[index] : null;
  const criteria = a.rubric ?? [];

  const load = useCallback(async (submissionId: string) => {
    const hit = cache.current.get(submissionId);
    if (hit) return hit;
    const data = await api<SubmissionDto>(`/api/submissions/${submissionId}`);
    cache.current.set(submissionId, data);
    return data;
  }, []);

  // Load the selection (from cache when prefetched), then prefetch neighbours (NFR-3).
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setAttempt('current');
    const subId = row?.submission?.id;
    if (!subId) {
      setSubmission(null);
      return;
    }
    const cached = cache.current.get(subId);
    if (cached) setSubmission(cached);
    else setLoading(true);
    load(subId)
      .then((s) => !cancelled && setSubmission(s))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    for (const n of [visible[index + 1], visible[index - 1]]) {
      if (n?.submission?.id) void load(n.submission.id).catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.submission?.id, row?.submission?.gradedAt, load]);

  // Reset the form for the selected submission (prefilled penalty per FR-30).
  useEffect(() => {
    const s = submission && submission.id === row?.submission?.id ? submission : null;
    const scores = s?.rubricScores ?? [];
    setLevels(
      Object.fromEntries(
        criteria.map((c) => {
          const score = scores.find((x) => x.criterionId === c.id);
          const i = score ? c.levels.findIndex((l) => Number(l.points) === Number(score.points)) : -1;
          return [c.id, i >= 0 ? i : null];
        }),
      ),
    );
    setRaw(s?.rawScore ? pts(s.rawScore) : '');
    setPenalty(
      s?.penaltyPercent != null
        ? pts(s.penaltyPercent)
        : s
          ? defaultPenalty(s.lateDays, a.latePenaltyPercentPerDay, a.maxLatePenaltyPercent).toString()
          : '0',
    );
    setFeedback(s?.feedback ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submission, row?.student.id]);

  // FR-30 auto-sum, in Decimal (NFR-1). Null until every criterion has a level.
  const rubricRaw =
    criteria.length && criteria.every((c) => levels[c.id] != null)
      ? rubricTotal(criteria.map((c) => ({ maxPoints: c.levels[levels[c.id]!].points }))).toFixed(2)
      : null;
  const effectiveRaw = criteria.length ? rubricRaw : isNum(raw) ? raw : null;
  const maxRaw = maxRawScore(a.maxPoints, a.allowExtraCredit);
  const rawTooHigh = !criteria.length && effectiveRaw !== null && maxRaw.lt(effectiveRaw);
  const penaltyOk = isNum(penalty) && Number(penalty) <= 100;
  const finalPreview = effectiveRaw && penaltyOk ? computeFinalScore(effectiveRaw, row?.submission ? penalty : 0).toFixed(2) : null;
  const canSave = !!effectiveRaw && penaltyOk && !rawTooHigh && !busy;

  const select = (i: number) => {
    const next = visible[i];
    if (next) setSelectedId(next.student.id);
  };

  async function refreshRoster() {
    setRoster(await fetchRoster(a.id));
  }

  function gradeBody() {
    return {
      rawScore: criteria.length ? undefined : raw,
      rubricScores: criteria.length ? criteria.map((c) => ({ criterionId: c.id, points: c.levels[levels[c.id]!].points })) : undefined,
      feedback: feedback || undefined,
    };
  }

  async function save(returnIt: boolean, advance = false) {
    if (!row || !canSave) return;
    setBusy(true);
    setError(null);
    try {
      let saved: SubmissionDto;
      if (row.submission) {
        saved = await api<SubmissionDto>(`/api/submissions/${row.submission.id}/grade`, {
          method: 'PUT',
          body: JSON.stringify({ ...gradeBody(), penaltyPercent: penalty, return: returnIt }),
        });
      } else {
        saved = await api<SubmissionDto>(`/api/assignments/${a.id}/grade-offline`, {
          method: 'POST',
          body: JSON.stringify({ ...gradeBody(), studentId: row.student.id, return: returnIt }),
        });
      }
      cache.current.set(saved.id, saved);
      setSubmission(saved);
      showToast({ message: returnIt ? 'Saved and returned' : 'Grade saved', severity: 'success' });
      await refreshRoster();
      if (advance) select(index + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function returnAll() {
    try {
      const res = await api<{ returned: string[]; skipped: unknown[] }>(`/api/assignments/${a.id}/return`, { method: 'POST', body: JSON.stringify({}) });
      res.returned.forEach((id) => cache.current.delete(id));
      showToast({ message: `Returned ${res.returned.length} submission${res.returned.length === 1 ? '' : 's'}`, severity: 'success' });
      await refreshRoster();
    } catch (e) {
      showToast({ message: (e as Error).message, severity: 'error' });
    } finally {
      setConfirmReturnAll(false);
    }
  }

  async function toggleExempt(exempt: boolean) {
    if (!row) return;
    try {
      await api(`/api/assignments/${a.id}/exemptions/${row.student.id}`, exempt ? { method: 'PUT', body: JSON.stringify({}) } : { method: 'DELETE' });
      await refreshRoster();
    } catch (e) {
      showToast({ message: (e as Error).message, severity: 'error' });
    }
  }

  // FR-33: J / K navigate (not while typing); Ctrl/Cmd+Enter saves and moves on (always).
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        void saveRef.current(false, true);
        return;
      }
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        select(index + 1);
      } else if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        select(index - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const shown = attempt === 'current' ? submission : submission?.history?.find((h) => h.attemptNumber === attempt) ?? null;
  const gradedCount = roster.filter((r) => r.chipStatus === 'GRADED').length;

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 2, alignItems: { sm: 'center' } }}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }} id="shortcut-hint">
          Shortcuts: <b>J</b> next · <b>K</b> previous · <b>Ctrl+Enter</b> save &amp; next
        </Typography>
        <Button variant="outlined" onClick={() => setConfirmReturnAll(true)} disabled={gradedCount === 0}>
          Return all graded ({gradedCount})
        </Button>
      </Stack>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Paper variant="outlined">
            <Stack direction="row" spacing={1} sx={{ p: 1.5 }}>
              <TextField select size="small" label="Status" value={filter} onChange={(e) => setFilter(e.target.value as ChipStatus | '')} sx={{ flex: 1 }}>
                <MenuItem value="">All</MenuItem>
                {(Object.keys(CHIP) as ChipStatus[]).map((k) => (
                  <MenuItem key={k} value={k}>
                    {CHIP[k].label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField select size="small" label="Sort" value={sort} onChange={(e) => setSort(e.target.value as 'name' | 'submittedAt')} sx={{ flex: 1 }}>
                <MenuItem value="name">Name</MenuItem>
                <MenuItem value="submittedAt">Submission time</MenuItem>
              </TextField>
            </Stack>
            <Divider />
            <List dense sx={{ maxHeight: { md: '70vh' }, overflowY: 'auto' }} aria-label="Students">
              {visible.map((r, i) => (
                <ListItemButton key={r.student.id} selected={i === index} onClick={() => setSelectedId(r.student.id)}>
                  <ListItemText
                    primary={r.student.name}
                    secondary={r.submission?.finalScore != null ? `${pts(r.submission.finalScore)}/${pts(a.maxPoints)}` : undefined}
                  />
                  <Chip size="small" label={CHIP[r.chipStatus].label} color={CHIP[r.chipStatus].color} />
                </ListItemButton>
              ))}
              {visible.length === 0 && <Typography sx={{ p: 2 }} color="text.secondary">No students match.</Typography>}
            </List>
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, md: 8 }}>
          {!row ? (
            <Paper variant="outlined" sx={{ p: 3 }}>
              <Typography color="text.secondary">Select a student.</Typography>
            </Paper>
          ) : (
            <Stack spacing={2}>
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1, flexWrap: 'wrap' }} useFlexGap>
                  <Typography variant="h6" component="h2" sx={{ flex: 1 }}>
                    {row.student.name}
                  </Typography>
                  <FormControlLabel
                    control={<Switch checked={row.exempt} onChange={(e) => void toggleExempt(e.target.checked)} />}
                    label="Exempt"
                  />
                </Stack>
                {loading && <CircularProgress size={20} />}
                {row.submission && submission && (
                  <Stack spacing={1.5}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }} useFlexGap>
                      <Typography variant="body2" color="text.secondary">
                        {submission.attemptNumber === 0
                          ? 'Graded without a submission'
                          : `Submitted ${formatInSchoolTz(submission.submittedAt, 'EEE d MMM yyyy, HH:mm', timezone)} · attempt ${submission.attemptNumber}`}
                      </Typography>
                      {submission.isLate && <Chip size="small" color="warning" label={`${submission.lateDays} day${submission.lateDays === 1 ? '' : 's'} late`} />}
                      {!!submission.history?.length && (
                        <TextField select size="small" label="Attempt" value={attempt} onChange={(e) => setAttempt(e.target.value === 'current' ? 'current' : Number(e.target.value))} sx={{ minWidth: 160 }}>
                          <MenuItem value="current">Current (attempt {submission.attemptNumber})</MenuItem>
                          {submission.history.map((h) => (
                            <MenuItem key={h.attemptNumber} value={h.attemptNumber}>
                              Attempt {h.attemptNumber} · {formatInSchoolTz(h.submittedAt, 'd MMM HH:mm', timezone)}
                            </MenuItem>
                          ))}
                        </TextField>
                      )}
                    </Stack>
                    {shown?.text ? <MarkdownView source={shown.text} /> : submission.attemptNumber > 0 && <Typography color="text.secondary">No text.</Typography>}
                    {shown && <FileList files={shown.files} preview />}
                  </Stack>
                )}
                {!row.submission && !row.exempt && <Alert severity="info">Not submitted. You can grade without a submission below.</Alert>}
                {row.exempt && <Alert severity="info">Exempt: excluded from missing lists, reminders and gradebook calculations.</Alert>}
              </Paper>

              {!row.exempt && (
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                    {row.submission ? 'Grade' : 'Grade without submission'}
                  </Typography>
                  <Stack spacing={2}>
                    {criteria.map((c) => (
                      <Box key={c.id}>
                        <Typography variant="body2" id={`crit-${c.id}`} sx={{ fontWeight: 600 }}>
                          {c.title} <Typography component="span" variant="caption" color="text.secondary">(max {pts(c.maxPoints)})</Typography>
                        </Typography>
                        <ToggleButtonGroup
                          exclusive
                          size="small"
                          value={levels[c.id] ?? null}
                          onChange={(_e, v: number | null) => setLevels((prev) => ({ ...prev, [c.id]: v }))}
                          aria-labelledby={`crit-${c.id}`}
                          sx={{ flexWrap: 'wrap', mt: 0.5 }}
                        >
                          {c.levels.map((l, i) => (
                            <ToggleButton key={i} value={i}>
                              {l.label} · {pts(l.points)}
                            </ToggleButton>
                          ))}
                        </ToggleButtonGroup>
                      </Box>
                    ))}
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                      {criteria.length ? (
                        <TextField label="Raw score (rubric total)" value={effectiveRaw ? pts(effectiveRaw) : ''} size="small" slotProps={{ htmlInput: { readOnly: true } }} />
                      ) : (
                        <TextField
                          label={`Raw score (max ${pts(maxRaw.toString())})`}
                          value={raw}
                          onChange={(e) => setRaw(e.target.value)}
                          size="small"
                          error={rawTooHigh || (raw !== '' && !isNum(raw))}
                          helperText={rawTooHigh ? 'Above the maximum' : undefined}
                          slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                        />
                      )}
                      {row.submission && (
                        <TextField
                          label="Late penalty %"
                          value={penalty}
                          onChange={(e) => setPenalty(e.target.value)}
                          size="small"
                          error={!penaltyOk}
                          slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                        />
                      )}
                      <TextField label="Final score" value={finalPreview ? `${pts(finalPreview)} / ${pts(a.maxPoints)}` : ''} size="small" slotProps={{ htmlInput: { readOnly: true } }} />
                    </Stack>
                    <MarkdownEditor label="Feedback" value={feedback} onChange={setFeedback} maxLength={FEEDBACK_MAX} minRows={4} />
                    {error && <Alert severity="error">{error}</Alert>}
                    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }} useFlexGap>
                      <Button variant="outlined" onClick={() => void save(false)} disabled={!canSave} aria-describedby="shortcut-hint">
                        Save
                      </Button>
                      <Button variant="contained" onClick={() => void save(true)} disabled={!canSave}>
                        Save &amp; return
                      </Button>
                    </Stack>
                  </Stack>
                </Paper>
              )}
            </Stack>
          )}
        </Grid>
      </Grid>
      <ConfirmDialog
        open={confirmReturnAll}
        title="Return all graded work?"
        description={`${gradedCount} graded submission${gradedCount === 1 ? '' : 's'} will become visible to students and parents, and they will be notified.`}
        confirmLabel="Return"
        onConfirm={returnAll}
        onCancel={() => setConfirmReturnAll(false)}
      />
    </Box>
  );
}
