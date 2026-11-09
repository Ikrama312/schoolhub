'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import {
  DataGrid,
  GridColumnMenu,
  type GridColDef,
  type GridColumnGroupingModel,
  type GridColumnMenuProps,
  type GridEventListener,
} from '@mui/x-data-grid';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import AddIcon from '@mui/icons-material/Add';
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';
import BarChartIcon from '@mui/icons-material/BarChart';
import DownloadIcon from '@mui/icons-material/Download';
import EditNoteIcon from '@mui/icons-material/EditNote';
import QuizOutlinedIcon from '@mui/icons-material/QuizOutlined';
import RuleIcon from '@mui/icons-material/Rule';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import TuneIcon from '@mui/icons-material/Tune';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import { useToast } from '@/components/Toast/useToast';
import { formatInSchoolTz } from '@/lib/dates';
import type { GradebookPayload } from '@/server/gradebook/gradebook-service';
import type { StudentTermResult } from '@/server/gradebook/grade-calc';
import { AddManualItemDialog } from './AddManualItemDialog';
import { ItemStatsDialog } from './ItemStatsDialog';
import { TermOverrideDialog } from './TermOverrideDialog';

/**
 * PRD-11 teacher gradebook (FR-18–FR-25, NFR-8). MIT DataGrid only: column groups, cell editing
 * via processRowUpdate, built-in row/column virtualisation, no pinned columns (Pro-only).
 *
 * Keys on a MANUAL cell: digits start editing (Enter/Tab commit and move), E = excused,
 * M = missing, Delete/Backspace = clear. Saves are optimistic with a per-cell error state.
 */

type Item = GradebookPayload['items'][number];
type Row = GradebookPayload['rows'][number];
type Cell = Row['cells'][string];
type GridRow = { id: string; name: string; [itemId: string]: unknown };

const SOURCE_ICON = { ASSIGNMENT: AssignmentOutlinedIcon, QUIZ: QuizOutlinedIcon, MANUAL: EditNoteIcon } as const;
const SOURCE_LABEL = { ASSIGNMENT: 'Assignment', QUIZ: 'Quiz', MANUAL: 'Manual item' } as const;
const pts = (v: string) => String(Number(v));

interface MenuActions {
  items: Map<string, Item>;
  toggleVisible: (item: Item) => void;
  markMissing: (item: Item) => void;
  showStats: (item: Item) => void;
}
const MenuContext = createContext<MenuActions | null>(null);

/** FR-24 column menu: hide/show to students, set ungraded to missing, statistics. */
function GradebookColumnMenu(props: GridColumnMenuProps) {
  const actions = useContext(MenuContext);
  const item = actions?.items.get(props.colDef.field);
  if (!actions || !item) return <GridColumnMenu {...props} />;
  const pastDue = !!item.dueAt && new Date(item.dueAt).getTime() < Date.now();
  const run = (fn: (i: Item) => void) => (e: React.MouseEvent) => {
    props.hideMenu(e);
    fn(item);
  };
  return (
    <GridColumnMenu
      {...props}
      slots={{
        columnMenuVisibilityItem: () => (
          <MenuItem onClick={run(actions.toggleVisible)}>
            <ListItemIcon>{item.isVisible ? <VisibilityOffOutlinedIcon fontSize="small" /> : <VisibilityOutlinedIcon fontSize="small" />}</ListItemIcon>
            <ListItemText>{item.isVisible ? 'Hide from students' : 'Show to students'}</ListItemText>
          </MenuItem>
        ),
        columnMenuMissingItem: () => (
          <MenuItem onClick={run(actions.markMissing)} disabled={!pastDue}>
            <ListItemIcon>
              <RuleIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText secondary={pastDue ? undefined : 'After the due date'}>Set ungraded to missing</ListItemText>
          </MenuItem>
        ),
        columnMenuStatsItem: () => (
          <MenuItem onClick={run(actions.showStats)}>
            <ListItemIcon>
              <BarChartIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Item statistics</ListItemText>
          </MenuItem>
        ),
      }}
      slotProps={{ columnMenuVisibilityItem: { displayOrder: 1 }, columnMenuMissingItem: { displayOrder: 2 }, columnMenuStatsItem: { displayOrder: 3 } }}
    />
  );
}

function cellText(c: Cell) {
  if (c.excused) return 'EX';
  if (c.score !== null) return pts(c.score);
  if (c.missing) return 'M';
  return '—';
}

export function GradebookGrid({ initial, timezone }: { initial: GradebookPayload; timezone: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [data, setData] = useState(initial);
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [stats, setStats] = useState<Item | null>(null);
  const [override, setOverride] = useState<Row | null>(null);
  const courseId = data.course.id;

  const reload = useCallback(
    async (termId = data.term.id) => {
      const res = await fetch(`/api/courses/${courseId}/gradebook?termId=${encodeURIComponent(termId)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return showToast({ message: json?.error?.message ?? 'Could not load the gradebook.', severity: 'error' });
      setData(json.data);
      setCellErrors({});
    },
    [courseId, data.term.id, showToast],
  );

  const patchRow = (studentId: string, fn: (r: Row) => Row) => setData((d) => ({ ...d, rows: d.rows.map((r) => (r.student.id === studentId ? fn(r) : r)) }));

  /** Optimistic single-cell save (FR-20). */
  const saveCell = useCallback(
    async (studentId: string, item: Item, body: { score?: string | null; excused?: boolean; missing?: boolean }) => {
      const key = `${studentId}:${item.id}`;
      const prev = data.rows.find((r) => r.student.id === studentId)?.cells[item.id];
      if (!prev) return;
      patchRow(studentId, (r) => ({ ...r, cells: { ...r.cells, [item.id]: { ...prev, ...body } } }));
      setCellErrors(({ [key]: _gone, ...rest }) => rest);
      const res = await fetch(`/api/grade-items/${item.id}/grades/${studentId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = json?.error?.message ?? 'Could not save.';
        patchRow(studentId, (r) => ({ ...r, cells: { ...r.cells, [item.id]: prev } }));
        setCellErrors((e) => ({ ...e, [key]: message }));
        showToast({ message, severity: 'error' });
        return;
      }
      patchRow(studentId, (r) => ({ ...r, cells: { ...r.cells, [item.id]: { ...r.cells[item.id], ...json.data.grade } }, result: json.data.result }));
    },
    [data.rows, showToast],
  );

  const items = useMemo(() => new Map(data.items.map((i) => [i.id, i])), [data.items]);
  const menuActions: MenuActions = useMemo(
    () => ({
      items,
      showStats: setStats,
      toggleVisible: async (item) => {
        const res = await fetch(`/api/grade-items/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isVisible: !item.isVisible }) });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return showToast({ message: json?.error?.message ?? 'Could not update the item.', severity: 'error' });
        showToast({ message: item.isVisible ? 'Hidden from students' : 'Shown to students', severity: 'success' });
        await reload();
      },
      markMissing: async (item) => {
        const res = await fetch(`/api/grade-items/${item.id}/mark-missing`, { method: 'POST' });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return showToast({ message: json?.error?.message ?? 'Could not mark missing.', severity: 'error' });
        showToast({ message: `${json.data.updatedCount} marked missing`, severity: 'success' });
        await reload();
      },
    }),
    [items, reload, showToast],
  );

  const catResult = (r: StudentTermResult, id: string | null) => r.categories.find((c) => c.id === id)?.percent ?? null;
  const hasUncategorised = data.rows.some((r) => r.result.categories.some((c) => c.id === null));

  const columns: GridColDef<GridRow>[] = useMemo(() => {
    const itemCols: GridColDef<GridRow>[] = data.items.map((item) => {
      const Icon = SOURCE_ICON[item.source];
      return {
        field: item.id,
        type: 'number',
        width: 120,
        sortable: false,
        editable: true,
        headerAlign: 'center',
        align: 'center',
        description: `${item.title} — ${SOURCE_LABEL[item.source]}${item.isVisible ? '' : ' (hidden from students)'}`,
        valueGetter: (_v, row) => {
          const s = (row.cells as Row['cells'])[item.id]?.score;
          return s === null || s === undefined ? null : Number(s);
        },
        renderHeader: () => (
          <Stack sx={{ lineHeight: 1.2, py: 0.5, opacity: item.isVisible ? 1 : 0.6, minWidth: 0 }}>
            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', minWidth: 0 }}>
              <Icon fontSize="inherit" aria-label={SOURCE_LABEL[item.source]} />
              {!item.isVisible && <VisibilityOffOutlinedIcon fontSize="inherit" aria-label="Hidden from students" />}
              <Typography variant="caption" sx={{ fontWeight: 600 }} noWrap>
                {item.title}
              </Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary" noWrap>
              {item.dueAt ? formatInSchoolTz(item.dueAt, 'd MMM', timezone) : 'No date'} · /{pts(item.maxPoints)}
            </Typography>
          </Stack>
        ),
        renderCell: ({ row }) => {
          const cell = (row.cells as Row['cells'])[item.id];
          const err = cellErrors[`${row.id}:${item.id}`];
          const text = cellText(cell);
          return (
            <Tooltip title={err ?? cell.comment ?? ''}>
              <Box
                sx={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, color: text === 'M' ? 'error.main' : undefined, fontWeight: text === 'M' ? 700 : undefined, outline: err ? '2px solid' : undefined, outlineColor: 'error.main' }}
                data-testid={`cell-${row.id}-${item.id}`}
              >
                {text}
                {cell.isLate && <AccessTimeIcon fontSize="inherit" aria-label="Late" />}
              </Box>
            </Tooltip>
          );
        },
      };
    });

    const catCol = (id: string | null, name: string): GridColDef<GridRow> => ({
      field: `cat:${id ?? 'none'}`,
      headerName: `${name} %`,
      width: 120,
      sortable: false,
      align: 'center',
      headerAlign: 'center',
      valueGetter: (_v, row) => catResult(row.result as StudentTermResult, id) ?? '—',
    });

    return [
      {
        field: 'name',
        headerName: 'Student',
        width: 200,
        renderCell: ({ row }) => (
          <Stack direction="row" sx={{ alignItems: 'center', width: '100%' }}>
            <Typography variant="body2" noWrap sx={{ flex: 1 }}>
              {row.name}
            </Typography>
            <Tooltip title="Override term grade / comment">
              <IconButton size="small" aria-label={`Override term grade for ${row.name}`} onClick={() => setOverride(data.rows.find((r) => r.student.id === row.id) ?? null)}>
                <TuneIcon fontSize="inherit" />
              </IconButton>
            </Tooltip>
          </Stack>
        ),
      },
      ...itemCols,
      ...data.categories.map((c) => catCol(c.id, c.name)),
      ...(hasUncategorised ? [catCol(null, 'Uncategorised')] : []),
      {
        field: 'term',
        headerName: 'Term',
        width: 130,
        sortable: false,
        align: 'center',
        headerAlign: 'center',
        renderCell: ({ row }) => {
          const r = row.result as StudentTermResult;
          return (
            <Typography variant="body2" sx={{ fontWeight: 700 }} data-testid={`term-${row.id}`}>
              {r.percent === null ? '—' : `${r.percent}% ${r.letter ?? ''}`}
              {r.overridden ? ' *' : ''}
            </Typography>
          );
        },
      },
    ];
  }, [data.items, data.categories, data.rows, cellErrors, hasUncategorised, timezone]);

  const grouping: GridColumnGroupingModel = useMemo(() => {
    const known = new Set(data.categories.map((c) => c.id));
    const groups = data.categories.map((c) => ({ groupId: c.id, headerName: `${c.name} (${pts(c.weightPercent)}%)`, children: data.items.filter((i) => i.categoryId === c.id).map((i) => ({ field: i.id })) }));
    const loose = data.items.filter((i) => !i.categoryId || !known.has(i.categoryId)).map((i) => ({ field: i.id }));
    if (loose.length) groups.push({ groupId: 'uncategorised', headerName: 'Uncategorised', children: loose });
    groups.push({ groupId: 'averages', headerName: 'Averages', children: [...data.categories.map((c) => ({ field: `cat:${c.id}` })), ...(hasUncategorised ? [{ field: 'cat:none' }] : []), { field: 'term' }] });
    return groups.filter((g) => g.children.length);
  }, [data.categories, data.items, hasUncategorised]);

  const gridRows: GridRow[] = useMemo(
    () => data.rows.map((r) => ({ id: r.student.id, name: `${r.student.lastName}, ${r.student.firstName}`, cells: r.cells, result: r.result })),
    [data.rows],
  );

  const onCellKeyDown: GridEventListener<'cellKeyDown'> = (params, event) => {
    const item = items.get(params.field);
    if (!item || item.source !== 'MANUAL' || params.cellMode !== 'view') return;
    const k = event.key;
    let body: { score: null; excused: boolean; missing: boolean } | null = null;
    if (k === 'e' || k === 'E') body = { score: null, excused: true, missing: false };
    else if (k === 'm' || k === 'M') body = { score: null, excused: false, missing: true };
    else if (k === 'Delete' || k === 'Backspace') body = { score: null, excused: false, missing: false };
    if (!body) return;
    event.defaultMuiPrevented = true;
    event.preventDefault();
    void saveCell(String(params.id), item, body);
  };

  const processRowUpdate = (newRow: GridRow, oldRow: GridRow) => {
    for (const item of data.items) {
      // Only the edited field is set on newRow; every other value comes from valueGetter.
      if (!Object.prototype.hasOwnProperty.call(newRow, item.id)) continue;
      const next = newRow[item.id] as number | null;
      const prev = (oldRow.cells as Row['cells'])[item.id]?.score;
      const prevNum = prev === null || prev === undefined ? null : Number(prev);
      if (next === prevNum) continue;
      if (next === null || Number.isNaN(next)) {
        void saveCell(newRow.id, item, { score: null, excused: false, missing: false });
      } else if (next < 0 || next > Number(item.maxPoints)) {
        const key = `${newRow.id}:${item.id}`;
        setCellErrors((e) => ({ ...e, [key]: `Enter 0–${pts(item.maxPoints)}` }));
        showToast({ message: `Score must be between 0 and ${pts(item.maxPoints)}.`, severity: 'error' });
        return oldRow;
      } else {
        void saveCell(newRow.id, item, { score: String(Math.round(next * 100) / 100), excused: false, missing: false });
      }
    }
    return oldRow; // state is owned by saveCell (optimistic), the grid re-reads it from rows
  };

  const onCellClick: GridEventListener<'cellClick'> = (params) => {
    const item = items.get(params.field);
    if (!item || item.source === 'MANUAL' || !item.sourceId) return;
    const cell = (params.row.cells as Row['cells'])[item.id];
    if (item.source === 'ASSIGNMENT') router.push(`/courses/${courseId}/assignments/${item.sourceId}/grade?studentId=${params.id}`);
    else if (cell.attemptId) router.push(`/quizzes/${item.sourceId}/attempts/${cell.attemptId}`);
  };

  const csvHref = `/api/courses/${courseId}/gradebook?termId=${encodeURIComponent(data.term.id)}&format=csv`;
  const letters = data.scale?.bands.map((b) => b.letter) ?? [];

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
        <TextField select size="small" label="Term" value={data.term.id} onChange={(e) => void reload(e.target.value)} sx={{ minWidth: 200 }}>
          {data.terms.map((t) => (
            <MenuItem key={t.id} value={t.id}>
              {t.name}
              {t.isCurrent ? ' (current)' : ''}
            </MenuItem>
          ))}
        </TextField>
        <Box sx={{ flex: 1 }} />
        <Button startIcon={<AddIcon />} variant="contained" onClick={() => setAddOpen(true)}>
          Add manual item
        </Button>
        <Button startIcon={<DownloadIcon />} component="a" href={csvHref}>
          Export CSV
        </Button>
        <Button startIcon={<SettingsOutlinedIcon />} component={NextLink} href={`/courses/${courseId}/gradebook/settings`}>
          Settings
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary">
        Scale: {data.scale?.name ?? 'none set'}. Manual cells: type a score, E = excused, M = missing, Delete = clear. Click a synced score to open its source. * = overridden.
      </Typography>
      <MenuContext.Provider value={menuActions}>
        <Box sx={{ height: '70vh', minHeight: 360 }}>
          <DataGrid
            rows={gridRows}
            columns={columns}
            columnGroupingModel={grouping}
            columnHeaderHeight={64}
            isCellEditable={(p) => items.get(p.field)?.source === 'MANUAL'}
            processRowUpdate={processRowUpdate}
            onProcessRowUpdateError={(e) => showToast({ message: e instanceof Error ? e.message : 'Could not save.', severity: 'error' })}
            onCellKeyDown={onCellKeyDown}
            onCellClick={onCellClick}
            slots={{ columnMenu: GradebookColumnMenu }}
            disableRowSelectionOnClick
            hideFooter
            aria-label={`Gradebook for ${data.course.name}, ${data.term.name}`}
          />
        </Box>
      </MenuContext.Provider>

      <AddManualItemDialog
        open={addOpen}
        courseId={courseId}
        timezone={timezone}
        categories={data.categories}
        terms={data.terms}
        defaultTermId={data.term.id}
        onClose={() => setAddOpen(false)}
        onCreated={() => {
          setAddOpen(false);
          showToast({ message: 'Item added', severity: 'success' });
          void reload();
        }}
      />
      {stats && <ItemStatsDialog title={stats.title} item={stats} cells={data.rows.map((r) => r.cells[stats.id])} onClose={() => setStats(null)} />}
      {override && (
        <TermOverrideDialog
          courseId={courseId}
          termId={data.term.id}
          student={override.student}
          result={override.result}
          letters={letters}
          onClose={() => setOverride(null)}
          onSaved={(result) => {
            patchRow(override.student.id, (r) => ({ ...r, result }));
            setOverride(null);
            showToast({ message: 'Term grade saved', severity: 'success' });
          }}
        />
      )}
    </Stack>
  );
}
