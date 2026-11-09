'use client';

import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import { MarkdownEditor } from '@/components/MarkdownEditor/MarkdownEditor';
import { FileUpload } from '@/components/FileUpload/FileUpload';
import { PROMPT_MAX, questionSchema, type QuestionType, type QuizOption } from '@/lib/validators/quiz';
import type { ManagerQuestion } from '@/server/quiz/serializers';

/** Builder-side question shape (points as text while editing). */
export interface QuestionDraft {
  type: QuestionType;
  prompt: string;
  points: string;
  options: QuizOption[] | null;
  correct: Record<string, unknown>;
  explanation: string | null;
  caseSensitive: boolean;
}

export const newOptionId = () => Math.random().toString(36).slice(2, 10);

/** NFR-9 defaults: SINGLE_CHOICE with two options, first marked correct. */
export function defaultQuestion(type: QuestionType): QuestionDraft {
  const options = [
    { id: newOptionId(), text: 'Option 1' },
    { id: newOptionId(), text: 'Option 2' },
  ];
  const base = { type, prompt: 'New question', points: '1', explanation: null, caseSensitive: false };
  switch (type) {
    case 'SINGLE_CHOICE':
      return { ...base, options, correct: { optionId: options[0].id } };
    case 'MULTIPLE_CHOICE':
      return { ...base, options, correct: { optionIds: [options[0].id] } };
    case 'TRUE_FALSE':
      return { ...base, options: null, correct: { value: true } };
    case 'SHORT_ANSWER':
      return { ...base, options: null, correct: { accepted: ['answer'] } };
    default:
      return { ...base, options: null, correct: {} };
  }
}

export const toDraft = (q: ManagerQuestion): QuestionDraft => ({
  type: q.type,
  prompt: q.prompt,
  points: q.points.replace(/\.00$/, ''),
  options: q.options,
  correct: (q.correct ?? {}) as Record<string, unknown>,
  explanation: q.explanation,
  caseSensitive: q.caseSensitive,
});

/** First validation message for a draft, or null (same schema as the API, FR-2). */
export function draftError(d: QuestionDraft): string | null {
  const r = questionSchema.safeParse(d);
  return r.success ? null : r.error.issues[0]?.message ?? 'Invalid question';
}

/**
 * FR-7 per-type editor. When `locked` (FR-10) only prompt, explanation and — for short answers —
 * accepted answers / case sensitivity stay editable.
 */
export function QuestionEditor({
  draft,
  onChange,
  locked,
  index,
}: {
  draft: QuestionDraft;
  onChange: (d: QuestionDraft) => void;
  locked: boolean;
  index: number;
}) {
  const [uploadError, setUploadError] = useState<string | null>(null);
  const set = (patch: Partial<QuestionDraft>) => onChange({ ...draft, ...patch });
  const setCorrect = (correct: Record<string, unknown>) => set({ correct });
  const isChoice = draft.type === 'SINGLE_CHOICE' || draft.type === 'MULTIPLE_CHOICE';
  const options = draft.options ?? [];
  const correctIds = new Set(draft.type === 'SINGLE_CHOICE' ? [draft.correct.optionId as string] : ((draft.correct.optionIds as string[]) ?? []));
  const accepted = (draft.correct.accepted as string[]) ?? [];

  const addOptionAfter = (i: number) => {
    if (options.length >= 8) return;
    const next = [...options];
    next.splice(i + 1, 0, { id: newOptionId(), text: '' });
    set({ options: next });
  };
  const removeOption = (id: string) => {
    const next = options.filter((o) => o.id !== id);
    if (draft.type === 'SINGLE_CHOICE') onChange({ ...draft, options: next, correct: { optionId: correctIds.has(id) ? next[0]?.id ?? '' : draft.correct.optionId } });
    else onChange({ ...draft, options: next, correct: { optionIds: [...correctIds].filter((c) => c !== id) } });
  };
  const toggleCorrect = (id: string, on: boolean) => {
    if (draft.type === 'SINGLE_CHOICE') setCorrect({ optionId: id });
    else setCorrect({ optionIds: options.map((o) => o.id).filter((x) => (x === id ? on : correctIds.has(x))) });
  };

  return (
    <Stack spacing={2}>
      <MarkdownEditor label={`Question ${index + 1} text`} value={draft.prompt} onChange={(prompt) => set({ prompt })} maxLength={PROMPT_MAX} minRows={3} />
      <Box>
        {/* FR-39: images upload with context 'quiz' and are embedded in the prompt Markdown. */}
        <FileUpload
          context="quiz"
          max={1}
          value={[]}
          label="Add image"
          onChange={(files) => {
            const f = files[0];
            if (!f) return;
            if (!f.mimeType.startsWith('image/')) {
              setUploadError('Only images can be embedded in a question.');
              return;
            }
            setUploadError(null);
            set({ prompt: `${draft.prompt}\n\n![${f.filename}](/api/files/${f.id}?inline=1)` });
          }}
        />
        {uploadError && <Alert severity="error">{uploadError}</Alert>}
      </Box>

      <TextField
        label="Points"
        value={draft.points}
        onChange={(e) => set({ points: e.target.value })}
        disabled={locked}
        size="small"
        sx={{ width: 140 }}
        slotProps={{ htmlInput: { inputMode: 'decimal' } }}
        helperText="0.5–100, steps of 0.5"
      />

      {isChoice && (
        <Stack spacing={1}>
          <Typography variant="subtitle2" component="p">
            Options — mark the correct {draft.type === 'SINGLE_CHOICE' ? 'one' : 'ones'}
          </Typography>
          <RadioGroup value={draft.type === 'SINGLE_CHOICE' ? (draft.correct.optionId as string) ?? '' : ''} onChange={(_e, v) => toggleCorrect(v, true)}>
            {options.map((o, i) => (
              <Stack key={o.id} direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
                {draft.type === 'SINGLE_CHOICE' ? (
                  <Radio value={o.id} disabled={locked} slotProps={{ input: { 'aria-label': `Option ${i + 1} is correct` } }} />
                ) : (
                  <Checkbox
                    checked={correctIds.has(o.id)}
                    onChange={(e) => toggleCorrect(o.id, e.target.checked)}
                    disabled={locked}
                    slotProps={{ input: { 'aria-label': `Option ${i + 1} is correct` } }}
                  />
                )}
                <TextField
                  label={`Option ${i + 1}`}
                  value={o.text}
                  size="small"
                  fullWidth
                  disabled={locked}
                  onChange={(e) => set({ options: options.map((x) => (x.id === o.id ? { ...x, text: e.target.value } : x)) })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addOptionAfter(i);
                    }
                  }}
                  slotProps={{ htmlInput: { maxLength: 1000 } }}
                />
                <IconButton aria-label={`Remove option ${i + 1}`} onClick={() => removeOption(o.id)} disabled={locked || options.length <= 2}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Stack>
            ))}
          </RadioGroup>
          <Box>
            <Button size="small" startIcon={<AddIcon />} onClick={() => addOptionAfter(options.length - 1)} disabled={locked || options.length >= 8}>
              Add option
            </Button>
          </Box>
        </Stack>
      )}

      {draft.type === 'TRUE_FALSE' && (
        <RadioGroup row value={String(draft.correct.value ?? true)} onChange={(_e, v) => setCorrect({ value: v === 'true' })} aria-label="Correct answer">
          <FormControlLabel value="true" control={<Radio disabled={locked} />} label="True is correct" />
          <FormControlLabel value="false" control={<Radio disabled={locked} />} label="False is correct" />
        </RadioGroup>
      )}

      {draft.type === 'SHORT_ANSWER' && (
        <Stack spacing={1}>
          <Typography variant="subtitle2" component="p">
            Accepted answers (spaces are trimmed; teacher can override)
          </Typography>
          {accepted.map((a, i) => (
            <Stack key={i} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <TextField
                label={`Accepted answer ${i + 1}`}
                value={a}
                size="small"
                fullWidth
                onChange={(e) => setCorrect({ accepted: accepted.map((x, j) => (j === i ? e.target.value : x)) })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && accepted.length < 10) {
                    e.preventDefault();
                    setCorrect({ accepted: [...accepted.slice(0, i + 1), '', ...accepted.slice(i + 1)] });
                  }
                }}
                slotProps={{ htmlInput: { maxLength: 500 } }}
              />
              <IconButton aria-label={`Remove accepted answer ${i + 1}`} onClick={() => setCorrect({ accepted: accepted.filter((_, j) => j !== i) })} disabled={accepted.length <= 1}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Stack>
          ))}
          <Box>
            <Button size="small" startIcon={<AddIcon />} onClick={() => setCorrect({ accepted: [...accepted, ''] })} disabled={accepted.length >= 10}>
              Add accepted answer
            </Button>
          </Box>
          <FormControlLabel control={<Switch checked={draft.caseSensitive} onChange={(e) => set({ caseSensitive: e.target.checked })} />} label="Case sensitive" />
        </Stack>
      )}

      {draft.type === 'ESSAY' && (
        <TextField
          label="Grading guidance (teachers only)"
          value={(draft.correct.guidance as string) ?? ''}
          onChange={(e) => setCorrect(e.target.value ? { guidance: e.target.value } : {})}
          disabled={locked}
          multiline
          minRows={2}
          fullWidth
        />
      )}

      <TextField
        label="Explanation (shown with correct answers)"
        value={draft.explanation ?? ''}
        onChange={(e) => set({ explanation: e.target.value || null })}
        multiline
        minRows={2}
        fullWidth
      />
    </Stack>
  );
}
