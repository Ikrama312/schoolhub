'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
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
import { formatMoney } from '@/lib/money';
import { sendJson, type SetupData } from './SetupTabs';

type Discount = SetupData['discounts'][number];
const RULE_LABELS = { SIBLING_2ND: 'Automatic: 2nd and later sibling', SIBLING_3RD_PLUS: 'Automatic: 3rd and later sibling' } as const;
const BLANK = { name: '', kind: 'PERCENT' as 'PERCENT' | 'FIXED', value: '', autoRule: '' };

/** FR-8 / FR-11: percent (0–100) or fixed discounts, manual or a sibling auto rule. */
export function DiscountsTab({ data }: { data: SetupData }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [editing, setEditing] = useState<Discount | 'new' | null>(null);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);

  const open = (d: Discount | 'new') => {
    setForm(d === 'new' ? BLANK : { name: d.name, kind: d.kind, value: d.value, autoRule: d.autoRule ?? '' });
    setEditing(d);
  };

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await action();
      showToast({ message: done, severity: 'success' });
      setEditing(null);
      router.refresh();
    } catch (e) {
      showToast({ message: (e as Error).message, severity: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const body = () => ({ ...form, autoRule: form.autoRule || null });
  const value = (d: Discount) => (d.kind === 'PERCENT' ? `${Number(d.value)} %` : formatMoney(d.value, data.currency));

  return (
    <Stack spacing={2}>
      {data.canWrite && (
        <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => open('new')}>
            New discount
          </Button>
        </Stack>
      )}
      {data.discounts.length === 0 ? (
        <EmptyState title="No discounts" description="Add scholarships or sibling discounts." />
      ) : (
        <Table size="small" aria-label="Discounts">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Value</TableCell>
              <TableCell>Applies</TableCell>
              {data.canWrite && <TableCell />}
            </TableRow>
          </TableHead>
          <TableBody>
            {data.discounts.map((d) => (
              <TableRow key={d.id}>
                <TableCell>{d.name}</TableCell>
                <TableCell>{value(d)}</TableCell>
                <TableCell>{d.autoRule ? <Chip size="small" color="info" label={RULE_LABELS[d.autoRule]} /> : 'Manual (per student)'}</TableCell>
                {data.canWrite && (
                  <TableCell align="right">
                    <Button size="small" onClick={() => open(d)}>
                      Edit
                    </Button>
                    <Button size="small" color="error" disabled={busy} onClick={() => run(() => sendJson(`/api/fees/discounts/${d.id}/archive`, 'POST'), `${d.name} archived.`)}>
                      Archive
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={editing !== null} onClose={busy ? undefined : () => setEditing(null)} fullWidth maxWidth="sm" aria-labelledby="discount-title">
        <DialogTitle id="discount-title">{editing === 'new' ? 'New discount' : 'Edit discount'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} slotProps={{ htmlInput: { maxLength: 100 } }} />
            <Stack direction="row" spacing={2}>
              <TextField select label="Kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as 'PERCENT' | 'FIXED' })} sx={{ minWidth: 160 }}>
                <MenuItem value="PERCENT">Percent</MenuItem>
                <MenuItem value="FIXED">Fixed amount</MenuItem>
              </TextField>
              <TextField
                label={form.kind === 'PERCENT' ? 'Percent (0–100)' : `Amount (${data.currency})`}
                required
                value={form.value}
                onChange={(e) => setForm({ ...form, value: e.target.value.trim() })}
                slotProps={{ htmlInput: { inputMode: 'decimal' } }}
              />
            </Stack>
            <TextField select label="Applies" value={form.autoRule} onChange={(e) => setForm({ ...form, autoRule: e.target.value })} helperText="Percent discounts use the non-optional fees; fixed discounts apply after them.">
              <MenuItem value="">Manual (assigned per student)</MenuItem>
              <MenuItem value="SIBLING_2ND">{RULE_LABELS.SIBLING_2ND}</MenuItem>
              <MenuItem value="SIBLING_3RD_PLUS">{RULE_LABELS.SIBLING_3RD_PLUS}</MenuItem>
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={busy}
            onClick={() =>
              run(
                () => (editing === 'new' ? sendJson('/api/fees/discounts', 'POST', body()) : sendJson(`/api/fees/discounts/${(editing as Discount).id}`, 'PATCH', body())),
                'Discount saved.',
              )
            }
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
