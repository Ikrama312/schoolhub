'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useToast } from '@/components/Toast/useToast';
import { AllocationEditor, allocationState, suggestAllocations, type OpenInvoiceRow } from '@/components/fees/AllocationEditor';
import { formatMoney } from '@/lib/money';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type PaymentMethodValue } from '@/lib/validators/fees';

export interface PayerOption {
  id: string;
  name: string;
  children: string[];
}

interface Family {
  parent: { id: string; name: string };
  invoices: OpenInvoiceRow[];
  outstanding: string;
  currency: string;
}

/**
 * PRD-17 FR-26 to FR-30: pick a parent (searchable by parent or child name), load the family's open
 * invoices, allocate oldest first (editable), save, then open the receipt. The server re-checks everything.
 */
export function RecordPaymentForm({ payers, initialParentId }: { payers: PayerOption[]; initialParentId?: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [payer, setPayer] = useState<PayerOption | null>(payers.find((p) => p.id === initialParentId) ?? null);
  const [family, setFamily] = useState<Family | null>(null);
  const [amount, setAmount] = useState('');
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [edited, setEdited] = useState(false);
  const [method, setMethod] = useState<PaymentMethodValue>('CASH');
  const [reference, setReference] = useState('');
  const [receivedAt, setReceivedAt] = useState<Date | null>(new Date());
  const [payerName, setPayerName] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setFamily(null);
    setAllocations({});
    setEdited(false);
    if (!payer) return;
    setPayerName(payer.name);
    let cancelled = false;
    fetch(`/api/fees/families/${payer.id}/open-invoices`)
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (cancelled) return;
        if (!ok) throw new Error(j?.error?.message ?? 'Could not load open invoices.');
        setFamily(j.data);
      })
      .catch((e: Error) => showToast({ message: e.message, severity: 'error' }));
    return () => {
      cancelled = true;
    };
  }, [payer, showToast]);

  // Re-suggest oldest-first allocations whenever the amount changes, until the bursar edits them.
  useEffect(() => {
    if (family && !edited) setAllocations(suggestAllocations(amount, family.invoices));
  }, [amount, family, edited]);

  const state = family ? allocationState(amount, family.invoices, allocations) : null;

  async function save() {
    if (!family || !state || state.error || !receivedAt) return;
    setBusy(true);
    try {
      const res = await fetch('/api/fees/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payerParentId: family.parent.id,
          amount,
          method,
          reference: reference || undefined,
          receivedAt: receivedAt.toISOString(),
          payerName,
          notes: notes || undefined,
          allocations: state.allocations,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? 'Could not record the payment.');
      showToast({ message: `Payment recorded: ${json.data.payment.receiptNumber}`, severity: 'success' });
      router.push(json.data.receiptUrl);
    } catch (e) {
      showToast({ message: (e as Error).message, severity: 'error' });
      setBusy(false);
    }
  }

  return (
    <Stack spacing={3}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Autocomplete
          options={payers}
          value={payer}
          onChange={(_e, v) => setPayer(v)}
          getOptionLabel={(p) => `${p.name}${p.children.length ? ` — ${p.children.join(', ')}` : ''}`}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          renderInput={(params) => <TextField {...params} label="Parent or student" helperText="Search by parent or child name" />}
        />
      </Paper>

      {family && (
        <>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="h6" component="h2">
              Open invoices · outstanding {formatMoney(family.outstanding, family.currency)}
            </Typography>
            {family.invoices.length === 0 ? (
              <Alert severity="info" sx={{ mt: 1 }}>
                This family has no open invoices.
              </Alert>
            ) : (
              <AllocationEditor
                amount={amount}
                invoices={family.invoices}
                value={allocations}
                onChange={(v) => {
                  setEdited(true);
                  setAllocations(v);
                }}
                currency={family.currency}
                outstanding={family.outstanding}
              />
            )}
          </Paper>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack spacing={2}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Amount"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.trim())}
                  slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                />
                <TextField select label="Method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethodValue)} sx={{ minWidth: 180 }}>
                  {PAYMENT_METHODS.map((m) => (
                    <MenuItem key={m} value={m}>
                      {PAYMENT_METHOD_LABELS[m]}
                    </MenuItem>
                  ))}
                </TextField>
                <DateTimePicker label="Received" ampm={false} value={receivedAt} onChange={(d) => setReceivedAt(d && !Number.isNaN(d.getTime()) ? d : null)} disableFuture />
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField label="Payer name" required value={payerName} onChange={(e) => setPayerName(e.target.value)} sx={{ flex: 1 }} slotProps={{ htmlInput: { maxLength: 200 } }} />
                <TextField
                  label="Reference"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  helperText="Cheque or transfer reference. Never enter card numbers."
                  sx={{ flex: 1 }}
                  slotProps={{ htmlInput: { maxLength: 100 } }}
                />
              </Stack>
              <TextField label="Notes" multiline minRows={2} value={notes} onChange={(e) => setNotes(e.target.value)} slotProps={{ htmlInput: { maxLength: 1000 } }} />
              <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
                <Button variant="contained" onClick={save} disabled={busy || !state || Boolean(state.error) || !receivedAt || !payerName.trim()}>
                  Save and open receipt
                </Button>
              </Stack>
            </Stack>
          </Paper>
        </>
      )}
    </Stack>
  );
}
