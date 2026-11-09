'use client';

import { useEffect, useState } from 'react';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { MarkdownEditor } from '@/components/MarkdownEditor/MarkdownEditor';
import { useToast } from '@/components/Toast/useToast';
import { accommodationSchema, INSTRUCTIONS_MAX, quizSettingsSchema, TITLE_MAX } from '@/lib/validators/quiz';
import type { ManagerQuiz } from '@/server/quiz/quiz-service';

export interface AccommodationRow {
  studentId: string;
  name: string;
  extraTimeMinutes: number;
  extraAttempts: number;
}

type FieldErrors = Record<string, string | undefined>;

function zodErrors(issues: { path: (string | number)[]; message: string }[]): FieldErrors {
  return Object.fromEntries(issues.map((i) => [String(i.path[0]), i.message]));
}

/** FR-28: per-student extra time / attempts. Applies to attempts started after saving (A7). */
function AccommodationEditor({ quizId, row }: { quizId: string; row: AccommodationRow }) {
  const { showToast } = useToast();
  const [time, setTime] = useState(String(row.extraTimeMinutes));
  const [attempts, setAttempts] = useState(String(row.extraAttempts));
  const [saved, setSaved] = useState({ time: String(row.extraTimeMinutes), attempts: String(row.extraAttempts) });
  const parsed = accommodationSchema.safeParse({ extraTimeMinutes: time, extraAttempts: attempts });
  const dirty = time !== saved.time || attempts !== saved.attempts;

  const save = async () => {
    if (!parsed.success) return;
    const res = await fetch(`/api/quizzes/${quizId}/accommodations/${row.studentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.data),
    });
    if (!res.ok) {
      showToast({ message: 'Could not save accommodation.', severity: 'error' });
      return;
    }
    setSaved({ time, attempts });
    showToast({ message: `Saved for ${row.name}`, severity: 'success' });
  };

  return (
    <TableRow>
      <TableCell>{row.name}</TableCell>
      <TableCell>
        <TextField
          size="small"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          error={!parsed.success && !!parsed.error.flatten().fieldErrors.extraTimeMinutes}
          slotProps={{ htmlInput: { inputMode: 'numeric', 'aria-label': `Extra minutes for ${row.name}` } }}
          sx={{ width: 100 }}
        />
      </TableCell>
      <TableCell>
        <TextField
          size="small"
          value={attempts}
          onChange={(e) => setAttempts(e.target.value)}
          error={!parsed.success && !!parsed.error.flatten().fieldErrors.extraAttempts}
          slotProps={{ htmlInput: { inputMode: 'numeric', 'aria-label': `Extra attempts for ${row.name}` } }}
          sx={{ width: 100 }}
        />
      </TableCell>
      <TableCell>
        <Button size="small" onClick={save} disabled={!dirty || !parsed.success}>
          Save
        </Button>
      </TableCell>
    </TableRow>
  );
}

/** FR-6 settings for every Quiz field (cross-field rules via quizSettingsSchema) + FR-28 accommodations. */
export function QuizSettingsPanel({
  quiz,
  timezone,
  accommodations,
  onSaved,
}: {
  quiz: ManagerQuiz;
  timezone: string;
  accommodations: AccommodationRow[];
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const toWall = (iso: string) => toZonedTime(iso, timezone);
  const [v, setV] = useState({
    title: quiz.title,
    instructions: quiz.instructions,
    isPractice: quiz.isPractice,
    availableFrom: toWall(quiz.availableFrom) as Date | null,
    availableUntil: toWall(quiz.availableUntil) as Date | null,
    timeLimitMinutes: quiz.timeLimitMinutes == null ? '' : String(quiz.timeLimitMinutes),
    maxAttempts: String(quiz.maxAttempts),
    scoringPolicy: quiz.scoringPolicy,
    shuffleQuestions: quiz.shuffleQuestions,
    shuffleOptions: quiz.shuffleOptions,
    oneQuestionPerPage: quiz.oneQuestionPerPage,
    resultsVisibility: quiz.resultsVisibility,
    showCorrectAnswers: quiz.showCorrectAnswers,
    categoryId: quiz.categoryId ?? '',
  });
  // PRD-11 FR-2: the course's gradebook categories ('' = none).
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    fetch(`/api/courses/${quiz.courseId}/grade-categories`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => setCategories(b?.data?.categories ?? []))
      .catch(() => setCategories([]));
  }, [quiz.courseId]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((s) => ({ ...s, [k]: val }));

  const save = async () => {
    const input = {
      ...v,
      availableFrom: v.availableFrom ? fromZonedTime(v.availableFrom, timezone).toISOString() : undefined,
      availableUntil: v.availableUntil ? fromZonedTime(v.availableUntil, timezone).toISOString() : undefined,
      timeLimitMinutes: v.timeLimitMinutes.trim() === '' ? null : v.timeLimitMinutes,
      categoryId: v.categoryId || null,
    };
    const parsed = quizSettingsSchema.safeParse(input);
    if (!parsed.success) {
      setErrors(zodErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    setSaving(true);
    const res = await fetch(`/api/quizzes/${quiz.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const fe = body?.error?.details?.fieldErrors as Record<string, string[]> | undefined;
      if (fe) setErrors(Object.fromEntries(Object.entries(fe).map(([k, m]) => [k, m[0]])));
      showToast({ message: body?.error?.message ?? 'Could not save settings.', severity: 'error' });
      return;
    }
    showToast({ message: 'Settings saved', severity: 'success' });
    onSaved();
  };

  const picker = (name: string, helper: string) => ({ textField: { fullWidth: true, error: !!errors[name], helperText: errors[name] ?? helper } });
  const sw = (k: 'isPractice' | 'shuffleQuestions' | 'shuffleOptions' | 'oneQuestionPerPage' | 'showCorrectAnswers', label: string) => (
    <FormControlLabel control={<Switch checked={v[k]} onChange={(e) => set(k, e.target.checked)} />} label={label} />
  );

  return (
    <Stack spacing={3}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={2}>
          <Typography variant="h6" component="h2">
            Settings
          </Typography>
          <TextField label="Title" value={v.title} onChange={(e) => set('title', e.target.value)} required fullWidth error={!!errors.title} helperText={errors.title} slotProps={{ htmlInput: { maxLength: TITLE_MAX } }} />
          <MarkdownEditor label="Instructions" value={v.instructions} onChange={(x) => set('instructions', x)} maxLength={INSTRUCTIONS_MAX} minRows={3} error={errors.instructions} />
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <DateTimePicker label="Opens" value={v.availableFrom} onChange={(d) => set('availableFrom', d)} ampm={false} slotProps={picker('availableFrom', `School time (${timezone})`)} />
            <DateTimePicker label="Closes" value={v.availableUntil} onChange={(d) => set('availableUntil', d)} ampm={false} slotProps={picker('availableUntil', `School time (${timezone})`)} />
          </Stack>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <TextField
              label="Time limit (minutes)"
              value={v.timeLimitMinutes}
              onChange={(e) => set('timeLimitMinutes', e.target.value)}
              error={!!errors.timeLimitMinutes}
              helperText={errors.timeLimitMinutes ?? 'Blank = untimed (1–300)'}
              slotProps={{ htmlInput: { inputMode: 'numeric' } }}
            />
            <TextField label="Attempts allowed" value={v.maxAttempts} onChange={(e) => set('maxAttempts', e.target.value)} error={!!errors.maxAttempts} helperText={errors.maxAttempts ?? '1–10'} slotProps={{ htmlInput: { inputMode: 'numeric' } }} />
            <TextField select label="Scoring policy" value={v.scoringPolicy} onChange={(e) => set('scoringPolicy', e.target.value as typeof v.scoringPolicy)} sx={{ minWidth: 180 }} helperText="Across graded attempts">
              <MenuItem value="HIGHEST">Highest</MenuItem>
              <MenuItem value="LATEST">Latest</MenuItem>
              <MenuItem value="AVERAGE">Average</MenuItem>
            </TextField>
            <TextField select label="Results visible" value={v.resultsVisibility} onChange={(e) => set('resultsVisibility', e.target.value as typeof v.resultsVisibility)} sx={{ minWidth: 200 }}>
              <MenuItem value="IMMEDIATELY">Immediately after submit</MenuItem>
              <MenuItem value="AFTER_CLOSE">After the quiz closes</MenuItem>
              <MenuItem value="MANUAL">When I release them</MenuItem>
            </TextField>
            <TextField select label="Gradebook category" value={v.categoryId} onChange={(e) => set('categoryId', e.target.value)} sx={{ minWidth: 180 }} error={!!errors.categoryId} helperText={errors.categoryId}>
              <MenuItem value="">None</MenuItem>
              {categories.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <Stack direction="row" sx={{ flexWrap: 'wrap', columnGap: 2 }} useFlexGap>
            {sw('isPractice', 'Practice quiz (not in gradebook)')}
            {sw('shuffleQuestions', 'Shuffle questions')}
            {sw('shuffleOptions', 'Shuffle options')}
            {sw('oneQuestionPerPage', 'One question per page')}
            {sw('showCorrectAnswers', 'Show correct answers with results')}
          </Stack>
          <Stack direction="row">
            <Button variant="contained" onClick={save} disabled={saving}>
              Save settings
            </Button>
          </Stack>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" component="h2">
          Accommodations
        </Typography>
        <Alert severity="info" sx={{ my: 1 }}>
          Extra time and attempts apply to attempts started after you save — an attempt already in progress keeps its deadline.
        </Alert>
        {accommodations.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No students are enrolled.
          </Typography>
        ) : (
          <TableContainer>
            <Table size="small" aria-label="Accommodations">
              <TableHead>
                <TableRow>
                  <TableCell>Student</TableCell>
                  <TableCell>Extra minutes (0–300)</TableCell>
                  <TableCell>Extra attempts (0–5)</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {accommodations.map((r) => (
                  <AccommodationEditor key={r.studentId} quizId={quiz.id} row={r} />
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
    </Stack>
  );
}
