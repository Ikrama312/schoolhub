'use client';

import { useEffect, useState } from 'react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { useToast } from '@/components/Toast/useToast';
import { QUESTION_TYPES, QUESTION_TYPE_LABELS, type QuestionType } from '@/lib/validators/quiz';
import type { ManagerQuestion } from '@/server/quiz/serializers';
import { defaultQuestion, draftError, QuestionEditor, toDraft, type QuestionDraft } from './QuestionEditor';

export const LOCK_TOOLTIP = 'Students have started this quiz — questions can’t be added, removed, reordered or re-scored.';

async function api(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error?.message ?? 'Request failed');
  return json?.data;
}

/** Locked: send only the fields FR-10 allows. */
function patchBody(d: QuestionDraft, locked: boolean) {
  if (!locked) return d;
  return { prompt: d.prompt, explanation: d.explanation, ...(d.type === 'SHORT_ANSWER' ? { correct: { accepted: d.correct.accepted }, caseSensitive: d.caseSensitive } : {}) };
}

/** Wrap a possibly-disabled control so its tooltip still shows (MUI Tooltip needs a live child). */
function LockTip({ locked, children }: { locked: boolean; children: React.ReactElement }) {
  return locked ? (
    <Tooltip title={LOCK_TOOLTIP}>
      <span>{children}</span>
    </Tooltip>
  ) : (
    children
  );
}

function QuestionCard({
  q,
  index,
  count,
  locked,
  onMove,
  onChanged,
}: {
  q: ManagerQuestion;
  index: number;
  count: number;
  locked: boolean;
  onMove: (dir: -1 | 1) => void;
  onChanged: () => void;
}) {
  const { showToast } = useToast();
  const { attributes, listeners, setNodeRef, transform, transition, setActivatorNodeRef } = useSortable({ id: q.id, disabled: locked });
  const style = transform ? { transform: `translate3d(0, ${transform.y}px, 0)`, transition } : { transition };
  const [draft, setDraft] = useState<QuestionDraft>(() => toDraft(q));
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const serverKey = JSON.stringify(q);
  // Reset only when this question's server copy changes, so other cards' unsaved edits survive a refresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setDraft(toDraft(q)), [serverKey]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(q));
  const error = draftError(draft);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      showToast({ message: done, severity: 'success' });
      onChanged();
    } catch (e) {
      showToast({ message: (e as Error).message, severity: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper ref={setNodeRef} variant="outlined" sx={{ p: 2 }} style={style}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <Stack sx={{ alignItems: 'center' }}>
          <LockTip locked={locked}>
            <IconButton ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Drag question ${index + 1}`} size="small" sx={{ cursor: 'grab' }} disabled={locked}>
              <DragIndicatorIcon fontSize="small" />
            </IconButton>
          </LockTip>
          <LockTip locked={locked}>
            <IconButton aria-label={`Move question ${index + 1} up`} size="small" disabled={locked || index === 0} onClick={() => onMove(-1)}>
              <ArrowUpwardIcon fontSize="small" />
            </IconButton>
          </LockTip>
          <LockTip locked={locked}>
            <IconButton aria-label={`Move question ${index + 1} down`} size="small" disabled={locked || index === count - 1} onClick={() => onMove(1)}>
              <ArrowDownwardIcon fontSize="small" />
            </IconButton>
          </LockTip>
        </Stack>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 2 }}>
            <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600, flex: 1 }}>
              Question {index + 1}
            </Typography>
            <Chip size="small" label={QUESTION_TYPE_LABELS[q.type]} />
            <Chip size="small" variant="outlined" label={`${q.points.replace(/\.00$/, '')} pts`} />
            <LockTip locked={locked}>
              <IconButton aria-label={`Duplicate question ${index + 1}`} disabled={locked || busy} onClick={() => run(() => api(`/api/quizzes/${q.quizId}/questions`, 'POST', toDraft(q)), 'Question duplicated')}>
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </LockTip>
            <LockTip locked={locked}>
              <IconButton aria-label={`Delete question ${index + 1}`} disabled={locked || busy} onClick={() => setConfirmDelete(true)}>
                <DeleteOutlinedIcon fontSize="small" />
              </IconButton>
            </LockTip>
          </Stack>
          <QuestionEditor draft={draft} onChange={setDraft} locked={locked} index={index} />
          {dirty && error && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
          <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
            <Button variant="contained" size="small" disabled={!dirty || !!error || busy} onClick={() => run(() => api(`/api/questions/${q.id}`, 'PATCH', patchBody(draft, locked)), 'Question saved')}>
              Save question
            </Button>
            <Button size="small" disabled={!dirty || busy} onClick={() => setDraft(toDraft(q))}>
              Discard changes
            </Button>
          </Stack>
        </Box>
      </Stack>
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete question ${index + 1}?`}
        destructive
        confirmLabel="Delete"
        onConfirm={async () => {
          setConfirmDelete(false);
          await run(() => api(`/api/questions/${q.id}`, 'DELETE'), 'Question deleted');
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </Paper>
  );
}

/** FR-7 question list: add (type picker), inline edit, duplicate, delete, drag or Up/Down reorder; FR-10 lock. */
export function QuestionList({ quizId, questions, locked, onChanged }: { quizId: string; questions: ManagerQuestion[]; locked: boolean; onChanged: () => void }) {
  const { showToast } = useToast();
  const [order, setOrder] = useState(questions);
  const [type, setType] = useState<QuestionType>('SINGLE_CHOICE');
  useEffect(() => setOrder(questions), [questions]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const move = async (from: number, to: number) => {
    const next = arrayMove(order, from, to);
    setOrder(next);
    try {
      await api(`/api/quizzes/${quizId}/questions/reorder`, 'POST', { questionIds: next.map((q) => q.id) });
      onChanged();
    } catch (e) {
      setOrder(questions);
      showToast({ message: (e as Error).message, severity: 'error' });
    }
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    void move(order.findIndex((q) => q.id === active.id), order.findIndex((q) => q.id === over.id));
  };
  const add = async () => {
    try {
      await api(`/api/quizzes/${quizId}/questions`, 'POST', defaultQuestion(type));
      onChanged();
    } catch (e) {
      showToast({ message: (e as Error).message, severity: 'error' });
    }
  };

  return (
    <Stack spacing={2}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={order.map((q) => q.id)} strategy={verticalListSortingStrategy}>
          {order.map((q, i) => (
            <QuestionCard key={q.id} q={q} index={i} count={order.length} locked={locked} onMove={(dir) => void move(i, i + dir)} onChanged={onChanged} />
          ))}
        </SortableContext>
      </DndContext>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <TextField select size="small" label="Question type" value={type} onChange={(e) => setType(e.target.value as QuestionType)} sx={{ minWidth: 200 }} disabled={locked}>
          {QUESTION_TYPES.map((t) => (
            <MenuItem key={t} value={t}>
              {QUESTION_TYPE_LABELS[t]}
            </MenuItem>
          ))}
        </TextField>
        <LockTip locked={locked}>
          <Button variant="outlined" startIcon={<AddIcon />} onClick={add} disabled={locked}>
            Add question
          </Button>
        </LockTip>
      </Stack>
    </Stack>
  );
}
