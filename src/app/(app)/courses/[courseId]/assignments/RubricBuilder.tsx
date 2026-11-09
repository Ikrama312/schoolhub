'use client';

import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import { rubricTotal } from '@/server/assignments/grading-math';
import { rubricSumMessage } from '@/lib/validators/assignments';

export interface LevelDraft {
  label: string;
  points: string;
  description: string;
}
export interface CriterionDraft {
  /** Stable client key for dnd-kit and React. */
  key: string;
  /** Existing criterion id (kept on PATCH so saved rubric scores stay valid). */
  id?: string;
  title: string;
  description: string;
  maxPoints: string;
  levels: LevelDraft[];
}

const isNum = (v: string) => /^\d+(\.\d{1,2})?$/.test(v.trim());
let seq = 0;
export const newCriterion = (): CriterionDraft => ({
  key: `new-${Date.now()}-${seq++}`,
  title: '',
  description: '',
  maxPoints: '10',
  levels: [
    { label: 'Excellent', points: '10', description: '' },
    { label: 'Developing', points: '5', description: '' },
  ],
});

/** Live FR-11 check: same message the server returns. Null when it adds up (or can't be computed yet). */
export function rubricSumError(criteria: CriterionDraft[], maxPoints: string): string | null {
  if (criteria.length === 0 || !isNum(maxPoints) || criteria.some((c) => !isNum(c.maxPoints))) return null;
  const sum = rubricTotal(criteria);
  return sum.eq(maxPoints) ? null : rubricSumMessage(sum.toString(), String(Number(maxPoints)));
}

function CriterionCard({
  c,
  index,
  count,
  onChange,
  onMove,
  onRemove,
}: {
  c: CriterionDraft;
  index: number;
  count: number;
  onChange: (c: CriterionDraft) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, setActivatorNodeRef } = useSortable({ id: c.key });
  const style = transform ? { transform: `translate3d(0, ${transform.y}px, 0)`, transition } : { transition };
  const setLevel = (i: number, patch: Partial<LevelDraft>) =>
    onChange({ ...c, levels: c.levels.map((l, j) => (j === i ? { ...l, ...patch } : l)) });

  return (
    <Paper ref={setNodeRef} variant="outlined" sx={{ p: 2 }} style={style}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <Stack sx={{ alignItems: 'center' }}>
          <IconButton ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Drag criterion ${index + 1}`} size="small" sx={{ cursor: 'grab' }}>
            <DragIndicatorIcon fontSize="small" />
          </IconButton>
          {/* NFR-17 keyboard fallback for drag-and-drop. */}
          <IconButton aria-label={`Move criterion ${index + 1} up`} size="small" disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUpwardIcon fontSize="small" />
          </IconButton>
          <IconButton aria-label={`Move criterion ${index + 1} down`} size="small" disabled={index === count - 1} onClick={() => onMove(1)}>
            <ArrowDownwardIcon fontSize="small" />
          </IconButton>
        </Stack>
        <Stack spacing={1.5} sx={{ flex: 1 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <TextField label={`Criterion ${index + 1} title`} value={c.title} onChange={(e) => onChange({ ...c, title: e.target.value })} size="small" fullWidth required slotProps={{ htmlInput: { maxLength: 150 } }} />
            <TextField
              label="Max points"
              value={c.maxPoints}
              onChange={(e) => onChange({ ...c, maxPoints: e.target.value })}
              size="small"
              sx={{ width: { sm: 140 } }}
              error={!isNum(c.maxPoints)}
              slotProps={{ htmlInput: { inputMode: 'decimal' } }}
            />
          </Stack>
          <TextField label="Description" value={c.description} onChange={(e) => onChange({ ...c, description: e.target.value })} size="small" fullWidth slotProps={{ htmlInput: { maxLength: 1000 } }} />
          <Typography variant="caption" color="text.secondary">
            Levels
          </Typography>
          {c.levels.map((l, i) => (
            <Stack key={i} direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <TextField label="Level" value={l.label} onChange={(e) => setLevel(i, { label: e.target.value })} size="small" slotProps={{ htmlInput: { maxLength: 100 } }} />
              <TextField
                label="Points"
                value={l.points}
                onChange={(e) => setLevel(i, { points: e.target.value })}
                size="small"
                sx={{ width: { sm: 110 } }}
                error={!isNum(l.points) || (isNum(c.maxPoints) && Number(l.points) > Number(c.maxPoints))}
                slotProps={{ htmlInput: { inputMode: 'decimal' } }}
              />
              <TextField label="Level description" value={l.description} onChange={(e) => setLevel(i, { description: e.target.value })} size="small" sx={{ flex: 1 }} />
              <IconButton aria-label={`Remove level ${l.label || i + 1}`} onClick={() => onChange({ ...c, levels: c.levels.filter((_, j) => j !== i) })} disabled={c.levels.length <= 1}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Stack>
          ))}
          <Box>
            <Button size="small" startIcon={<AddIcon />} onClick={() => onChange({ ...c, levels: [...c.levels, { label: '', points: '0', description: '' }] })} disabled={c.levels.length >= 10}>
              Add level
            </Button>
          </Box>
        </Stack>
        <Tooltip title="Remove criterion">
          <IconButton aria-label={`Remove criterion ${index + 1}`} onClick={onRemove}>
            <DeleteOutlineIcon />
          </IconButton>
        </Tooltip>
      </Stack>
    </Paper>
  );
}

/** FR-11 rubric builder: add / reorder (drag or Up/Down) / remove criteria, live sum check. */
export function RubricBuilder({ value, onChange, maxPoints }: { value: CriterionDraft[]; onChange: (v: CriterionDraft[]) => void; maxPoints: string }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const sumError = rubricSumError(value, maxPoints);

  const move = (from: number, to: number) => onChange(arrayMove(value, from, to));
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    move(value.findIndex((c) => c.key === active.id), value.findIndex((c) => c.key === over.id));
  };

  return (
    <Stack spacing={2}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={value.map((c) => c.key)} strategy={verticalListSortingStrategy}>
          {value.map((c, i) => (
            <CriterionCard
              key={c.key}
              c={c}
              index={i}
              count={value.length}
              onChange={(next) => onChange(value.map((x) => (x.key === c.key ? next : x)))}
              onMove={(dir) => move(i, i + dir)}
              onRemove={() => onChange(value.filter((x) => x.key !== c.key))}
            />
          ))}
        </SortableContext>
      </DndContext>
      {sumError && (
        <Alert severity="error" role="alert">
          {sumError}
        </Alert>
      )}
      <Box>
        <Button startIcon={<AddIcon />} onClick={() => onChange([...value, newCriterion()])} disabled={value.length >= 20}>
          Add criterion
        </Button>
      </Box>
    </Stack>
  );
}
