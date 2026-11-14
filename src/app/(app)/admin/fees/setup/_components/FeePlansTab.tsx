'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import AddIcon from '@mui/icons-material/Add';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { useToast } from '@/components/Toast/useToast';
import { InvoiceLinesEditor, type EditorLine } from '@/components/fees/InvoiceLinesEditor';
import { formatMoney } from '@/lib/money';
import { sendJson, type SetupData } from './SetupTabs';

type Plan = SetupData['plans'][number];
const ANNUAL = 'annual';

/** FR-7: one plan per term (or annual) and grade, with a line editor, live total and dueDays. PUT replaces all lines. */
export function FeePlansTab({ data }: { data: SetupData }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const [name, setName] = useState('');
  const [termId, setTermId] = useState(ANNUAL);
  const [gradeLevelId, setGradeLevelId] = useState('');
  const [dueDays, setDueDays] = useState('30');
  const [lines, setLines] = useState<EditorLine[]>([]);
  const [busy, setBusy] = useState(false);

  const open = (p: Plan | 'new') => {
    if (p === 'new') {
      setName('');
      setTermId(data.terms[0]?.id ?? ANNUAL);
      setGradeLevelId(data.grades[0]?.id ?? '');
      setDueDays('30');
      setLines([{ description: '', amount: '', feeItemId: null }]);
    } else {
      setName(p.name);
      setTermId(p.termId ?? ANNUAL);
      setGradeLevelId(p.gradeLevelId);
      setDueDays(String(p.dueDays));
      setLines(p.lines.map((l) => ({ description: l.feeItemName, amount: l.amount, feeItemId: l.feeItemId })));
    }
    setEditing(p);
  };

  async function save() {
    if (!data.academicYear) return;
    setBusy(true);
    const body = {
      name,
      academicYearId: editing === 'new' ? data.academicYear.id : (editing as Plan).academicYearId,
      termId: termId === ANNUAL ? null : termId,
      gradeLevelId,
      dueDays: Number(dueDays),
      lines: lines.map((l) => ({ feeItemId: l.feeItemId, amount: l.amount })),
    };
    try {
      await (editing === 'new' ? sendJson('/api/fees/plans', 'POST', body) : sendJson(`/api/fees/plans/${(editing as Plan).id}`, 'PUT', body));
      showToast({ message: 'Fee plan saved.', severity: 'success' });
      setEditing(null);
      router.refresh();
    } catch (e) {
      showToast({ message: (e as Error).message, severity: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const feeItems = data.items.filter((i) => !i.isOptional);

  return (
    <Stack spacing={2}>
      {data.canWrite && data.academicYear && (
        <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => open('new')}>
            New fee plan
          </Button>
        </Stack>
      )}
      {data.plans.length === 0 ? (
        <EmptyState title="No fee plans" description="A plan sets the fees for one grade in one term (or the whole year)." />
      ) : (
        <Table size="small" aria-label="Fee plans">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Grade</TableCell>
              <TableCell>Term</TableCell>
              <TableCell>Lines</TableCell>
              <TableCell align="right">Due in</TableCell>
              <TableCell align="right">Total</TableCell>
              {data.canWrite && <TableCell />}
            </TableRow>
          </TableHead>
          <TableBody>
            {data.plans.map((p) => (
              <TableRow key={p.id}>
                <TableCell>{p.name}</TableCell>
                <TableCell>{p.gradeLevelName}</TableCell>
                <TableCell>{p.termName ?? 'Annual'}</TableCell>
                <TableCell>{p.lines.map((l) => l.feeItemName).join(', ')}</TableCell>
                <TableCell align="right">{p.dueDays} days</TableCell>
                <TableCell align="right">{formatMoney(p.total, data.currency)}</TableCell>
                {data.canWrite && (
                  <TableCell align="right">
                    <Button size="small" onClick={() => open(p)}>
                      Edit
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={editing !== null} onClose={busy ? undefined : () => setEditing(null)} fullWidth maxWidth="md" aria-labelledby="fee-plan-title">
        <DialogTitle id="fee-plan-title">{editing === 'new' ? 'New fee plan' : 'Edit fee plan'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label="Name" required value={name} onChange={(e) => setName(e.target.value)} slotProps={{ htmlInput: { maxLength: 100 } }} />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField select label="Term" value={termId} onChange={(e) => setTermId(e.target.value)} sx={{ minWidth: 180 }}>
                {data.terms.map((t) => (
                  <MenuItem key={t.id} value={t.id}>
                    {t.name}
                  </MenuItem>
                ))}
                <MenuItem value={ANNUAL}>Annual</MenuItem>
              </TextField>
              <TextField select label="Grade" value={gradeLevelId} onChange={(e) => setGradeLevelId(e.target.value)} sx={{ minWidth: 180 }}>
                {data.grades.map((g) => (
                  <MenuItem key={g.id} value={g.id}>
                    {g.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField label="Due in (days)" type="number" value={dueDays} onChange={(e) => setDueDays(e.target.value)} slotProps={{ htmlInput: { min: 0, max: 365 } }} />
            </Stack>
            <InvoiceLinesEditor value={lines} onChange={setLines} currency={data.currency} feeItems={feeItems} requireItem />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="contained" onClick={save} disabled={busy || !name.trim() || !gradeLevelId}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
