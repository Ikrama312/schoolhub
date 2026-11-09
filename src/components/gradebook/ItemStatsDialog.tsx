'use client';

import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableRow from '@mui/material/TableRow';
import { Decimal, dec, fixed2 } from '@/server/assignments/grading-math';
import { counted } from '@/server/gradebook/grade-calc';

type Cell = { score: string | null; excused: boolean; missing: boolean };
type Item = { id: string; maxPoints: string; dueAt: string | null; isVisible: boolean; categoryId: string | null };

/** FR-24: average, median, high, low over counted scores (missing past due = 0, excused skipped). */
export function itemStats(item: Item, cells: readonly Cell[], now = new Date()) {
  const calcItem = { ...item, isVisible: true, dueAt: item.dueAt ? new Date(item.dueAt) : null };
  const scores = cells
    .filter((c) => counted(calcItem, c, now))
    .map((c) => (c.score === null ? new Decimal(0) : dec(c.score)))
    .sort((a, b) => a.cmp(b));
  if (!scores.length) return { count: 0, average: null, median: null, high: null, low: null };
  const sum = scores.reduce((s, x) => s.plus(x), new Decimal(0));
  const mid = Math.floor(scores.length / 2);
  const median = scores.length % 2 ? scores[mid] : scores[mid - 1].plus(scores[mid]).div(2);
  return { count: scores.length, average: fixed2(sum.div(scores.length)), median: fixed2(median), high: fixed2(scores.at(-1)!), low: fixed2(scores[0]) };
}

export function ItemStatsDialog({ title, item, cells, onClose }: { title: string; item: Item; cells: readonly Cell[]; onClose: () => void }) {
  const s = itemStats(item, cells);
  const out = (v: string | null) => (v === null ? '—' : `${v.replace(/\.00$/, '')} / ${item.maxPoints.replace(/\.00$/, '')}`);
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Statistics — {title}</DialogTitle>
      <DialogContent>
        <Table size="small" aria-label="Item statistics">
          <TableBody>
            {[
              ['Counted scores', String(s.count)],
              ['Average', out(s.average)],
              ['Median', out(s.median)],
              ['High', out(s.high)],
              ['Low', out(s.low)],
            ].map(([k, v]) => (
              <TableRow key={k}>
                <TableCell component="th" scope="row">
                  {k}
                </TableCell>
                <TableCell align="right">{v}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
