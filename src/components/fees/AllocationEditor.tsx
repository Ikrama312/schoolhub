'use client';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import { autoAllocate, validateAllocations } from '@/server/fees/fee-math';
import { dec, formatMoney } from '@/lib/money';
import type { InvoiceStatusValue } from '@/lib/validators/fees';
import { InvoiceStatusChip } from './InvoiceStatusChip';

export interface OpenInvoiceRow {
  id: string;
  number: string | null;
  studentName: string;
  dueDate: string | null;
  status: InvoiceStatusValue;
  balance: string;
}

const isMoney = (v: string) => /^\d+(\.\d{1,2})?$/.test(v);

/** Map of invoiceId → amount ('' = not allocated) from the oldest-first suggestion (FR-28). */
export function suggestAllocations(amount: string, invoices: OpenInvoiceRow[]): Record<string, string> {
  if (!isMoney(amount)) return {};
  return Object.fromEntries(autoAllocate(amount, invoices).allocations.map((a) => [a.invoiceId, a.amount]));
}

/** The allocations to send, and the error the server would give for them (same fee-math rules). */
export function allocationState(amount: string, invoices: OpenInvoiceRow[], value: Record<string, string>) {
  const allocations = Object.entries(value)
    .filter(([, a]) => a !== '' && a !== '0' && a !== '0.00')
    .map(([invoiceId, a]) => ({ invoiceId, amount: a }));
  if (!isMoney(amount)) return { allocations, error: 'Enter the payment amount first' };
  if (allocations.some((a) => !isMoney(a.amount))) return { allocations, error: 'Allocations must be numbers with at most 2 decimals' };
  return { allocations, error: validateAllocations(amount, allocations, Object.fromEntries(invoices.map((i) => [i.id, i.balance]))) };
}

/**
 * PRD-17 FR-28/FR-29: open family invoices with an editable allocation column, pre-filled oldest
 * due first. The client check mirrors the server (fee-math), which re-validates under row locks.
 */
export function AllocationEditor({
  amount,
  invoices,
  value,
  onChange,
  currency,
  outstanding,
}: {
  amount: string;
  invoices: OpenInvoiceRow[];
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  currency: string;
  outstanding: string;
}) {
  const overpaid = isMoney(amount) && dec(amount).gt(outstanding);
  const { error } = allocationState(amount, invoices, value);

  return (
    <Stack spacing={1.5}>
      <Table size="small" aria-label="Open invoices">
        <TableHead>
          <TableRow>
            <TableCell>Invoice</TableCell>
            <TableCell>Student</TableCell>
            <TableCell>Due</TableCell>
            <TableCell>Status</TableCell>
            <TableCell align="right">Balance</TableCell>
            <TableCell align="right">Allocate</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {invoices.map((inv) => (
            <TableRow key={inv.id}>
              <TableCell>{inv.number}</TableCell>
              <TableCell>{inv.studentName}</TableCell>
              <TableCell>{inv.dueDate}</TableCell>
              <TableCell>
                <InvoiceStatusChip status={inv.status} />
              </TableCell>
              <TableCell align="right">{formatMoney(inv.balance, currency)}</TableCell>
              <TableCell align="right">
                <TextField
                  size="small"
                  sx={{ width: 120 }}
                  value={value[inv.id] ?? ''}
                  onChange={(e) => onChange({ ...value, [inv.id]: e.target.value.trim() })}
                  slotProps={{ htmlInput: { inputMode: 'decimal', 'aria-label': `Allocation to ${inv.number}` } }}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Stack direction="row" spacing={1}>
        <Button size="small" onClick={() => onChange(suggestAllocations(amount, invoices))} disabled={!isMoney(amount)}>
          Auto-allocate (oldest first)
        </Button>
        <Button size="small" onClick={() => onChange({})}>
          Clear
        </Button>
      </Stack>
      {overpaid ? (
        <Alert severity="error">Amount exceeds the family&apos;s outstanding balance of {formatMoney(outstanding, currency)}</Alert>
      ) : (
        error && isMoney(amount) && <Alert severity="warning">{error}</Alert>
      )}
    </Stack>
  );
}
