'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
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

type Item = SetupData['items'][number];
const BLANK = { name: '', code: '', description: '', defaultAmount: '', isOptional: false };

/** FR-6: fee items with a unique code; archive instead of delete. */
export function FeeItemsTab({ data }: { data: SetupData }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);

  const open = (item: Item | 'new') => {
    setForm(item === 'new' ? BLANK : { name: item.name, code: item.code, description: item.description ?? '', defaultAmount: item.defaultAmount, isOptional: item.isOptional });
    setEditing(item);
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

  const save = () =>
    run(
      () =>
        editing === 'new'
          ? sendJson('/api/fees/items', 'POST', { ...form, description: form.description || null })
          : sendJson(`/api/fees/items/${(editing as Item).id}`, 'PATCH', { ...form, description: form.description || null }),
      'Fee item saved.',
    );

  return (
    <Stack spacing={2}>
      {data.canWrite && (
        <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => open('new')}>
            New fee item
          </Button>
        </Stack>
      )}
      {data.items.length === 0 ? (
        <EmptyState title="No fee items" description="Create items such as Tuition or Bus service, then use them in fee plans." />
      ) : (
        <Table size="small" aria-label="Fee items">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Code</TableCell>
              <TableCell align="right">Default amount</TableCell>
              <TableCell>Type</TableCell>
              {data.canWrite && <TableCell />}
            </TableRow>
          </TableHead>
          <TableBody>
            {data.items.map((i) => (
              <TableRow key={i.id}>
                <TableCell>{i.name}</TableCell>
                <TableCell>{i.code}</TableCell>
                <TableCell align="right">{formatMoney(i.defaultAmount, data.currency)}</TableCell>
                <TableCell>{i.isOptional ? <Chip size="small" label="Optional" /> : 'Standard'}</TableCell>
                {data.canWrite && (
                  <TableCell align="right">
                    <Button size="small" onClick={() => open(i)}>
                      Edit
                    </Button>
                    <Button size="small" color="error" disabled={busy} onClick={() => run(() => sendJson(`/api/fees/items/${i.id}/archive`, 'POST'), `${i.name} archived.`)}>
                      Archive
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={editing !== null} onClose={busy ? undefined : () => setEditing(null)} fullWidth maxWidth="sm" aria-labelledby="fee-item-title">
        <DialogTitle id="fee-item-title">{editing === 'new' ? 'New fee item' : 'Edit fee item'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} slotProps={{ htmlInput: { maxLength: 100 } }} />
            <TextField
              label="Code"
              required
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              helperText="Unique; letters, digits, - and _"
              slotProps={{ htmlInput: { maxLength: 30 } }}
            />
            <TextField label="Description" multiline value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} slotProps={{ htmlInput: { maxLength: 500 } }} />
            <TextField
              label="Default amount"
              required
              value={form.defaultAmount}
              onChange={(e) => setForm({ ...form, defaultAmount: e.target.value.trim() })}
              slotProps={{ htmlInput: { inputMode: 'decimal' } }}
            />
            <FormControlLabel
              control={<Switch checked={form.isOptional} onChange={(e) => setForm({ ...form, isOptional: e.target.checked })} />}
              label="Optional (assigned per student, e.g. Bus service)"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="contained" onClick={save} disabled={busy}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
