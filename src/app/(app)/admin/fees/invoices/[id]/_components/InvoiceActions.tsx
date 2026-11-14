'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { useToast } from '@/components/Toast/useToast';
import { InvoiceLinesEditor, type EditorLine, type FeeItemOption } from '@/components/fees/InvoiceLinesEditor';
import { formatMoney } from '@/lib/money';
import type { InvoiceDetail } from '@/server/fees/fees-service';

type Pending = null | 'edit' | 'issue' | 'delete' | 'adjust' | 'void' | 'remind';
const OPEN = ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'];

/**
 * PRD-17 FR-20 to FR-22, FR-38: status-dependent actions. Buttons are cosmetic; every action is
 * re-checked by the server (bursar flag, state → 409, throttle → 429).
 */
export function InvoiceActions({ invoice: inv, canWrite, feeItems }: { invoice: InvoiceDetail; canWrite: boolean; feeItems: FeeItemOption[] }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [lines, setLines] = useState<EditorLine[]>([]);
  const [dueDays, setDueDays] = useState(String(inv.dueDays));
  const [notes, setNotes] = useState(inv.notes ?? '');

  const open = (p: Pending) => {
    setReason('');
    setAmount('');
    if (p === 'edit') setLines(inv.lines.filter((l) => !l.isDiscount && !l.isAdjustment).map((l) => ({ description: l.description, amount: l.amount, feeItemId: l.feeItemId })));
    setPending(p);
  };

  async function call(path: string, method: string, body?: unknown, done?: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/fees/invoices/${inv.id}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? 'The action failed.');
      if (done) showToast({ message: done, severity: 'success' });
      setPending(null);
      if (method === 'DELETE') router.push('/admin/fees/invoices');
      else router.refresh();
    } catch (e) {
      showToast({ message: (e as Error).message, severity: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const primary = inv.parents.find((p) => p.isPrimary) ?? inv.parents[0];
  const reasonOk = reason.trim().length >= 3;

  return (
    <>
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
        <Button component={Link} href={`/fees/invoices/${inv.id}/print`} variant="outlined">
          Print
        </Button>
        {canWrite && inv.status === 'DRAFT' && (
          <>
            <Button onClick={() => open('edit')}>Edit lines</Button>
            <Button color="error" onClick={() => open('delete')}>
              Delete draft
            </Button>
            <Button variant="contained" onClick={() => open('issue')}>
              Issue
            </Button>
          </>
        )}
        {canWrite && OPEN.includes(inv.status) && (
          <>
            {primary && (
              <Button variant="contained" component={Link} href={`/admin/fees/payments/new?parentId=${primary.id}`}>
                Record payment
              </Button>
            )}
            <Button onClick={() => open('adjust')}>Add adjustment</Button>
            <Button onClick={() => open('remind')}>Send reminder</Button>
            <Button color="error" onClick={() => open('void')}>
              Void
            </Button>
          </>
        )}
      </Stack>

      <ConfirmDialog
        open={pending === 'issue'}
        title="Issue this invoice?"
        description="It gets a number, the due date starts counting and parents are notified."
        confirmLabel="Issue"
        onConfirm={() => call('/issue', 'POST', undefined, 'Invoice issued.')}
        onCancel={() => setPending(null)}
      />
      <ConfirmDialog
        open={pending === 'delete'}
        destructive
        title="Delete this draft?"
        description="Drafts have no number and can be deleted. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => call('', 'DELETE', undefined, 'Draft deleted.')}
        onCancel={() => setPending(null)}
      />
      <ConfirmDialog
        open={pending === 'remind'}
        title="Send a reminder?"
        description={`Every linked parent gets a reminder for the balance of ${formatMoney(inv.balance, inv.currency)}. One manual reminder per 24 hours.`}
        confirmLabel="Send"
        onConfirm={() => call('/remind', 'POST', undefined, 'Reminder sent.')}
        onCancel={() => setPending(null)}
      />

      <Dialog open={pending === 'void' || pending === 'adjust'} onClose={busy ? undefined : () => setPending(null)} fullWidth maxWidth="sm" aria-labelledby="invoice-reason-title">
        <DialogTitle id="invoice-reason-title">{pending === 'void' ? 'Void invoice' : 'Add adjustment'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {pending === 'adjust' && (
              <TextField
                label="Amount to take off"
                value={amount}
                onChange={(e) => setAmount(e.target.value.trim())}
                helperText={`At most ${formatMoney(inv.balance, inv.currency)} (the total cannot drop below what is already paid).`}
                slotProps={{ htmlInput: { inputMode: 'decimal' } }}
              />
            )}
            <TextField label="Reason" required multiline minRows={2} value={reason} onChange={(e) => setReason(e.target.value)} slotProps={{ htmlInput: { maxLength: 500 } }} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPending(null)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color={pending === 'void' ? 'error' : 'primary'}
            disabled={busy || !reasonOk || (pending === 'adjust' && !/^\d+(\.\d{1,2})?$/.test(amount))}
            onClick={() =>
              pending === 'void'
                ? call('/void', 'POST', { reason }, 'Invoice voided.')
                : call('/adjust', 'POST', { amount, reason }, 'Adjustment added.')
            }
          >
            {pending === 'void' ? 'Void invoice' : 'Add adjustment'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={pending === 'edit'} onClose={busy ? undefined : () => setPending(null)} fullWidth maxWidth="md" aria-labelledby="invoice-edit-title">
        <DialogTitle id="invoice-edit-title">Edit draft</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <InvoiceLinesEditor value={lines} onChange={setLines} currency={inv.currency} feeItems={feeItems} />
            <TextField label="Due in (days)" type="number" value={dueDays} onChange={(e) => setDueDays(e.target.value)} slotProps={{ htmlInput: { min: 0, max: 365 } }} />
            <TextField label="Notes" multiline minRows={2} value={notes} onChange={(e) => setNotes(e.target.value)} slotProps={{ htmlInput: { maxLength: 1000 } }} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPending(null)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={busy}
            onClick={() =>
              call(
                '',
                'PATCH',
                {
                  lines: lines.map((l) => ({ description: l.description, amount: l.amount, feeItemId: l.feeItemId || undefined })),
                  dueDays: Number(dueDays),
                  notes: notes || null,
                },
                'Draft saved. Discounts were recalculated.',
              )
            }
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
