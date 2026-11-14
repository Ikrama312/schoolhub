'use client';

import { useState } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { UserPicker, type UserPickerOption } from '@/components/UserPicker/UserPicker';
import { InvoiceLinesEditor, type EditorLine, type FeeItemOption } from '@/components/fees/InvoiceLinesEditor';
import { useToast } from '@/components/Toast/useToast';

export interface ManualInvoiceOptions {
  academicYearId: string;
  terms: { id: string; name: string }[];
  feeItems: FeeItemOption[];
  currency: string;
}

const EMPTY: EditorLine[] = [{ description: '', amount: '', feeItemId: null }];

/** PRD-17 FR-23: one-off invoice with free-form lines (bursar). Validation is the shared Zod schema on the server. */
export function ManualInvoiceDialog({
  open,
  onClose,
  options,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  options: ManualInvoiceOptions;
  onCreated: (id: string) => void;
}) {
  const { showToast } = useToast();
  const [student, setStudent] = useState<UserPickerOption | null>(null);
  const [termId, setTermId] = useState('');
  const [lines, setLines] = useState<EditorLine[]>(EMPTY);
  const [dueDays, setDueDays] = useState('30');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(issue: boolean) {
    if (!student) {
      showToast({ message: 'Choose a student.', severity: 'error' });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/fees/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: student.id,
          academicYearId: options.academicYearId,
          termId: termId || null,
          lines: lines.map((l) => ({ description: l.description, amount: l.amount, feeItemId: l.feeItemId || undefined })),
          dueDays: Number(dueDays),
          notes: notes || undefined,
          issue,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? 'Could not create the invoice.');
      showToast({ message: issue ? `Invoice ${json.data.number} issued.` : 'Draft invoice created.', severity: 'success' });
      setStudent(null);
      setLines(EMPTY);
      onClose();
      onCreated(json.data.id);
    } catch (e) {
      showToast({ message: (e as Error).message, severity: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="md" aria-labelledby="manual-invoice-title">
      <DialogTitle id="manual-invoice-title">New manual invoice</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <UserPicker label="Student" role="STUDENT" value={student} onChange={(v) => setStudent(v as UserPickerOption | null)} />
          <Stack direction="row" spacing={2}>
            <TextField select label="Term" value={termId} onChange={(e) => setTermId(e.target.value)} sx={{ minWidth: 180 }}>
              <MenuItem value="">No term (annual / one-off)</MenuItem>
              {options.terms.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField label="Due in (days)" type="number" value={dueDays} onChange={(e) => setDueDays(e.target.value)} slotProps={{ htmlInput: { min: 0, max: 365 } }} />
          </Stack>
          <InvoiceLinesEditor value={lines} onChange={setLines} currency={options.currency} feeItems={options.feeItems} />
          <TextField label="Notes" multiline minRows={2} value={notes} onChange={(e) => setNotes(e.target.value)} slotProps={{ htmlInput: { maxLength: 1000 } }} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={() => save(false)} disabled={busy}>
          Save draft
        </Button>
        <Button variant="contained" onClick={() => save(true)} disabled={busy}>
          Create and issue
        </Button>
      </DialogActions>
    </Dialog>
  );
}
