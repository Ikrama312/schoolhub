// PRD-17 pure fee math (system-design §2.2, FR-49). No Prisma client, no I/O: used by the services,
// the client AllocationEditor/InvoiceLinesEditor, the seed and the unit tests. Money is Decimal in,
// 2-dp strings out (ADR-2). Dates are 'yyyy-MM-dd' strings in the school timezone (ADR-13).
import { Decimal, dec, fixed2, ZERO, type DecimalValue } from '@/lib/money';
import type { AutoRule, InvoiceStatusValue } from '@/lib/validators/fees';

// ---------------------------------------------------------------------------
// Invoice totals (FR-15)
// ---------------------------------------------------------------------------

export interface DraftLine {
  description: string;
  amount: string;
  feeItemId?: string | null;
  discountId?: string | null;
  isOptional: boolean;
  isDiscount: boolean;
  isAdjustment: boolean;
  reason?: string | null;
  sortOrder: number;
}

export interface ChargeLine {
  description: string;
  amount: DecimalValue;
  feeItemId?: string | null;
  isOptional?: boolean;
}

export interface DiscountRule {
  id: string;
  name: string;
  kind: 'PERCENT' | 'FIXED';
  value: DecimalValue;
}

export interface InvoiceTotals {
  lines: DraftLine[];
  subtotal: string;
  discountTotal: string;
  total: string;
}

const round2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/**
 * FR-15: base = Σ non-optional charge lines. Every PERCENT discount takes round(base × pct / 100)
 * off the same base (no compounding), then every FIXED discount takes min(value, remaining). No
 * discount takes more than what is left, so the total never goes below 0. Discounts become negative
 * isDiscount lines. Adjustment lines are not charges here; adjustInvoice adds them after issue.
 */
export function computeInvoiceTotals(charges: readonly ChargeLine[], discounts: readonly DiscountRule[]): InvoiceTotals {
  const lines: DraftLine[] = charges.map((c, i) => ({
    description: c.description,
    amount: fixed2(c.amount),
    feeItemId: c.feeItemId ?? null,
    discountId: null,
    isOptional: Boolean(c.isOptional),
    isDiscount: false,
    isAdjustment: false,
    reason: null,
    sortOrder: i,
  }));
  const subtotal = lines.reduce((s, l) => s.plus(l.amount), ZERO);
  const base = lines.filter((l) => !l.isOptional).reduce((s, l) => s.plus(l.amount), ZERO);

  let remaining = subtotal;
  let discountTotal = ZERO;
  const ordered = [...discounts.filter((d) => d.kind === 'PERCENT'), ...discounts.filter((d) => d.kind === 'FIXED')];
  for (const d of ordered) {
    const wanted = d.kind === 'PERCENT' ? round2(base.mul(dec(d.value)).div(100)) : round2(dec(d.value));
    const off = Decimal.min(wanted, remaining);
    if (off.lte(0)) continue;
    remaining = remaining.minus(off);
    discountTotal = discountTotal.plus(off);
    lines.push({
      description: d.kind === 'PERCENT' ? `${d.name} (${dec(d.value).toString()}%)` : d.name,
      amount: fixed2(off.neg()),
      feeItemId: null,
      discountId: d.id,
      isOptional: false,
      isDiscount: true,
      isAdjustment: false,
      reason: null,
      sortOrder: lines.length,
    });
  }
  return { lines, subtotal: fixed2(subtotal), discountTotal: fixed2(discountTotal.neg()), total: fixed2(remaining) };
}

// ---------------------------------------------------------------------------
// Siblings (FR-11, D-4, D-5)
// ---------------------------------------------------------------------------

export interface Sibling {
  id: string;
  enrollmentDate: string;
  dateOfBirth: string;
}

/** D-4: 1-based rank among siblings sharing the primary parent: enrollmentDate asc, older first, then id. */
export function siblingRank(studentId: string, siblings: readonly Sibling[]): number | null {
  const sorted = [...siblings].sort(
    (a, b) =>
      a.enrollmentDate.localeCompare(b.enrollmentDate) ||
      a.dateOfBirth.localeCompare(b.dateOfBirth) ||
      a.id.localeCompare(b.id),
  );
  const index = sorted.findIndex((s) => s.id === studentId);
  return index === -1 ? null : index + 1;
}

/** D-5: only the most specific active rule applies; never both. */
export function siblingRuleFor(rank: number | null, activeRules: Iterable<AutoRule>): AutoRule | null {
  if (!rank || rank < 2) return null;
  const rules = new Set(activeRules);
  if (rank >= 3 && rules.has('SIBLING_3RD_PLUS')) return 'SIBLING_3RD_PLUS';
  return rules.has('SIBLING_2ND') ? 'SIBLING_2ND' : null;
}

// ---------------------------------------------------------------------------
// Allocation (FR-28, FR-29)
// ---------------------------------------------------------------------------

export interface OpenInvoice {
  id: string;
  number: string | null;
  dueDate: string | null;
  balance: DecimalValue;
}

export interface Allocation {
  invoiceId: string;
  amount: string;
}

/** FR-28: oldest dueDate first, then number. Never more than a balance. remainder > 0 ⇒ overpayment. */
export function autoAllocate(amount: DecimalValue, invoices: readonly OpenInvoice[]): { allocations: Allocation[]; remainder: string } {
  const sorted = [...invoices].sort(
    (a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || (a.number ?? '').localeCompare(b.number ?? ''),
  );
  let left = dec(amount);
  const allocations: Allocation[] = [];
  for (const inv of sorted) {
    if (left.lte(0)) break;
    const take = Decimal.min(left, dec(inv.balance));
    if (take.lte(0)) continue;
    allocations.push({ invoiceId: inv.id, amount: fixed2(take) });
    left = left.minus(take);
  }
  return { allocations, remainder: fixed2(left) };
}

/** FR-28: Σ = amount and each 0 < a ≤ balance. Returns an error message, or null when valid. */
export function validateAllocations(
  amount: DecimalValue,
  allocations: readonly { invoiceId: string; amount: DecimalValue }[],
  balances: Readonly<Record<string, DecimalValue>>,
): string | null {
  let sum = ZERO;
  for (const a of allocations) {
    const value = dec(a.amount);
    if (value.lte(0)) return 'Each allocation must be greater than 0';
    const balance = balances[a.invoiceId];
    if (balance === undefined) return 'An allocation refers to an invoice that is not open for this family';
    if (value.gt(dec(balance))) return 'An allocation cannot exceed the invoice balance';
    sum = sum.plus(value);
  }
  if (!sum.eq(dec(amount))) return `Allocations (${fixed2(sum)}) must add up to the payment amount (${fixed2(amount)})`;
  return null;
}

// ---------------------------------------------------------------------------
// Status (FR-24, FR-25)
// ---------------------------------------------------------------------------

export function deriveStatus(
  invoice: { status: InvoiceStatusValue; total: DecimalValue; amountPaid: DecimalValue; dueDate: string | null },
  today: string,
): InvoiceStatusValue {
  if (invoice.status === 'DRAFT' || invoice.status === 'VOID') return invoice.status;
  const paid = dec(invoice.amountPaid);
  if (paid.gte(dec(invoice.total))) return 'PAID';
  if (invoice.dueDate && invoice.dueDate < today) return 'OVERDUE';
  return paid.gt(0) ? 'PARTIALLY_PAID' : 'ISSUED';
}

export const OPEN_STATUSES = ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] as const satisfies readonly InvoiceStatusValue[];
export const isOpen = (status: InvoiceStatusValue) => (OPEN_STATUSES as readonly string[]).includes(status);

// ---------------------------------------------------------------------------
// Dates: reminders (FR-37) and aging (FR-42)
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
const plusDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

export type AutoReminderKind = 'PRE_DUE_3D' | 'DUE_PLUS_1' | 'OVERDUE_14D';

/**
 * FR-37: the latest reminder slot on or before today, for an open invoice. PRE_DUE_3D on due − 3
 * (only while today < due), DUE_PLUS_1 on due + 1, OVERDUE_14D on due + 1 + 14k (k ≥ 1). Older missed
 * slots are not back-filled; scheduledFor is the idempotency key with InvoiceReminder's unique index.
 */
export function reminderSlot(dueDate: string | null, today: string): { kind: AutoReminderKind; scheduledFor: string } | null {
  if (!dueDate) return null;
  const sinceDue = daysBetween(dueDate, today);
  if (sinceDue < -3) return null;
  if (sinceDue < 0) return { kind: 'PRE_DUE_3D', scheduledFor: plusDays(dueDate, -3) };
  if (sinceDue === 0) return null;
  const k = Math.floor((sinceDue - 1) / 14);
  return k === 0
    ? { kind: 'DUE_PLUS_1', scheduledFor: plusDays(dueDate, 1) }
    : { kind: 'OVERDUE_14D', scheduledFor: plusDays(dueDate, 1 + 14 * k) };
}

export const AGING_BUCKETS = ['current', '1-30', '31-60', '61-90', '90+'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export function agingBucket(dueDate: string | null, today: string): AgingBucket {
  const days = dueDate ? daysBetween(dueDate, today) : 0;
  if (days <= 0) return 'current';
  if (days <= 30) return '1-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}
