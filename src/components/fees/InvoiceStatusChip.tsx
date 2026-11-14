import Chip from '@mui/material/Chip';
import type { InvoiceStatusValue } from '@/lib/validators/fees';

/** PRD-17 FR-17: status badge. VOID is greyed out; OVERDUE uses the error colour. */
const COLOR = {
  DRAFT: 'default',
  ISSUED: 'info',
  PARTIALLY_PAID: 'warning',
  PAID: 'success',
  OVERDUE: 'error',
  VOID: 'default',
} as const;

export const INVOICE_STATUS_LABELS: Record<InvoiceStatusValue, string> = {
  DRAFT: 'Draft',
  ISSUED: 'Issued',
  PARTIALLY_PAID: 'Partially paid',
  PAID: 'Paid',
  OVERDUE: 'Overdue',
  VOID: 'Void',
};

export function InvoiceStatusChip({ status, size = 'small' }: { status: InvoiceStatusValue; size?: 'small' | 'medium' }) {
  return (
    <Chip
      size={size}
      label={INVOICE_STATUS_LABELS[status]}
      color={COLOR[status]}
      variant={status === 'VOID' || status === 'DRAFT' ? 'outlined' : 'filled'}
    />
  );
}
