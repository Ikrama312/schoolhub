'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import { useToast } from '@/components/Toast/useToast';

/** PRD-17 FR-31: bursar reverses a payment with a reason. A second reverse gets 409 from the server. */
export function ReversePaymentButton({ paymentId, receiptNumber }: { paymentId: string; receiptNumber: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function reverse() {
    setBusy(true);
    try {
      const res = await fetch(`/api/fees/payments/${paymentId}/reverse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? 'Could not reverse the payment.');
      showToast({ message: `Payment ${receiptNumber} reversed.`, severity: 'success' });
      setOpen(false);
      router.refresh();
    } catch (e) {
      showToast({ message: (e as Error).message, severity: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button color="error" variant="outlined" onClick={() => setOpen(true)}>
        Reverse payment
      </Button>
      <Dialog open={open} onClose={busy ? undefined : () => setOpen(false)} fullWidth maxWidth="sm" aria-labelledby="reverse-title">
        <DialogTitle id="reverse-title">Reverse payment {receiptNumber}?</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            The payment stays on record as reversed and its amounts are removed from the invoices it paid.
          </DialogContentText>
          <TextField label="Reason" required fullWidth multiline minRows={2} value={reason} onChange={(e) => setReason(e.target.value)} slotProps={{ htmlInput: { maxLength: 500 } }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={reverse} disabled={busy || reason.trim().length < 3}>
            Reverse
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
