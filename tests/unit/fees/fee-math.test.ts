import { describe, expect, it } from 'vitest';
import {
  agingBucket,
  autoAllocate,
  computeInvoiceTotals,
  deriveStatus,
  reminderSlot,
  siblingRank,
  siblingRuleFor,
  validateAllocations,
} from '@/server/fees/fee-math';
import { schoolDateOf } from '@/lib/dates';

// PRD-17 FR-49. Dates are school-tz strings; the tz is pinned to America/New_York where an instant is involved.
const TZ = 'America/New_York';

const charges = [
  { description: 'Tuition', amount: '2000.00' },
  { description: 'Lab fee', amount: '150.00' },
  { description: 'Bus service', amount: '300.00', isOptional: true },
];
const merit = { id: 'd-merit', name: 'Merit scholarship', kind: 'PERCENT' as const, value: '10' };
const sibling = { id: 'd-sib', name: 'Sibling', kind: 'PERCENT' as const, value: '5' };

describe('computeInvoiceTotals (FR-15)', () => {
  it('AC1: percent discount on the non-optional base only → 2235.00', () => {
    const t = computeInvoiceTotals(charges, [merit]);
    expect(t.subtotal).toBe('2450.00');
    expect(t.discountTotal).toBe('-215.00');
    expect(t.total).toBe('2235.00');
    const line = t.lines.find((l) => l.isDiscount)!;
    expect(line).toMatchObject({ amount: '-215.00', discountId: 'd-merit', isDiscount: true });
  });

  it('AC2: sibling 5% line is −107.50', () => {
    const t = computeInvoiceTotals(charges, [sibling]);
    expect(t.lines.find((l) => l.isDiscount)?.amount).toBe('-107.50');
    expect(t.total).toBe('2342.50');
  });

  it('percents apply to the same base (no compounding), then fixed', () => {
    const fixed = { id: 'f', name: 'Bursary', kind: 'FIXED' as const, value: '100' };
    // listed fixed first on purpose: order is percent then fixed regardless of input order
    const t = computeInvoiceTotals(charges, [fixed, merit, sibling]);
    expect(t.lines.filter((l) => l.isDiscount).map((l) => l.amount)).toEqual(['-215.00', '-107.50', '-100.00']);
    expect(t.total).toBe('2027.50');
  });

  it('clamps at 0', () => {
    const big = { id: 'b', name: 'Full', kind: 'FIXED' as const, value: '99999' };
    const t = computeInvoiceTotals([{ description: 'Tuition', amount: '100' }], [merit, big]);
    expect(t.total).toBe('0.00');
    expect(t.discountTotal).toBe('-100.00');
  });

  it('rounds half-up to 2 dp', () => {
    const t = computeInvoiceTotals([{ description: 'x', amount: '0.10' }], [{ id: 'p', name: 'p', kind: 'PERCENT', value: '25' }]);
    // 0.10 × 25% = 0.025 → 0.03
    expect(t.lines[1].amount).toBe('-0.03');
    expect(t.total).toBe('0.07');
  });
});

describe('siblings (FR-11, D-4, D-5)', () => {
  const kids = [
    { id: 'c', enrollmentDate: '2024-09-01', dateOfBirth: '2014-01-01' },
    { id: 'a', enrollmentDate: '2022-09-01', dateOfBirth: '2012-05-01' },
    { id: 'b', enrollmentDate: '2024-09-01', dateOfBirth: '2013-01-01' },
  ];
  it('orders by enrollment date, then older first', () => {
    expect(siblingRank('a', kids)).toBe(1);
    expect(siblingRank('b', kids)).toBe(2);
    expect(siblingRank('c', kids)).toBe(3);
    expect(siblingRank('zz', kids)).toBeNull();
  });
  it('applies only the most specific rule', () => {
    expect(siblingRuleFor(1, ['SIBLING_2ND', 'SIBLING_3RD_PLUS'])).toBeNull();
    expect(siblingRuleFor(2, ['SIBLING_2ND', 'SIBLING_3RD_PLUS'])).toBe('SIBLING_2ND');
    expect(siblingRuleFor(3, ['SIBLING_2ND', 'SIBLING_3RD_PLUS'])).toBe('SIBLING_3RD_PLUS');
    expect(siblingRuleFor(3, ['SIBLING_2ND'])).toBe('SIBLING_2ND');
    expect(siblingRuleFor(2, ['SIBLING_3RD_PLUS'])).toBeNull();
  });
});

describe('allocation (FR-28, FR-29)', () => {
  const open = [
    { id: 'new', number: 'INV-2026-000003', dueDate: '2026-12-01', balance: '500.00' },
    { id: 'old', number: 'INV-2026-000001', dueDate: '2026-10-01', balance: '300.00' },
    { id: 'mid', number: 'INV-2026-000002', dueDate: '2026-10-01', balance: '200.00' },
  ];
  it('allocates oldest due first, then by number', () => {
    expect(autoAllocate('400', open)).toEqual({
      allocations: [
        { invoiceId: 'old', amount: '300.00' },
        { invoiceId: 'mid', amount: '100.00' },
      ],
      remainder: '0.00',
    });
  });
  it('reports the overpayment remainder', () => {
    expect(autoAllocate('1000.01', open).remainder).toBe('0.01');
  });
  it('validates sum and per-invoice balance', () => {
    const balances = { old: '300.00', mid: '200.00' };
    expect(validateAllocations('400', [{ invoiceId: 'old', amount: '300' }, { invoiceId: 'mid', amount: '100' }], balances)).toBeNull();
    expect(validateAllocations('400', [{ invoiceId: 'old', amount: '400' }], balances)).toMatch(/exceed/);
    expect(validateAllocations('400', [{ invoiceId: 'old', amount: '300' }], balances)).toMatch(/add up/);
    expect(validateAllocations('10', [{ invoiceId: 'zzz', amount: '10' }], balances)).toMatch(/not open/);
  });
});

describe('deriveStatus (FR-24)', () => {
  const inv = (amountPaid: string, dueDate = '2026-11-10') => ({ status: 'ISSUED' as const, total: '100.00', amountPaid, dueDate });
  it('transitions', () => {
    expect(deriveStatus(inv('0'), '2026-11-10')).toBe('ISSUED');
    expect(deriveStatus(inv('40'), '2026-11-10')).toBe('PARTIALLY_PAID');
    expect(deriveStatus(inv('100'), '2026-11-11')).toBe('PAID');
    expect(deriveStatus(inv('40'), '2026-11-11')).toBe('OVERDUE');
    expect(deriveStatus(inv('0'), '2026-11-11')).toBe('OVERDUE');
    expect(deriveStatus({ ...inv('0'), status: 'OVERDUE' }, '2026-11-01')).toBe('ISSUED'); // recompute re-derives from the dates, not the stored status
    expect(deriveStatus({ ...inv('0'), status: 'VOID' }, '2026-12-01')).toBe('VOID');
    expect(deriveStatus({ ...inv('0'), status: 'DRAFT' }, '2026-12-01')).toBe('DRAFT');
    expect(deriveStatus({ status: 'ISSUED', total: '0.00', amountPaid: '0.00', dueDate: '2026-12-01' }, '2026-11-10')).toBe('PAID');
  });
  it('uses the school-tz date, not UTC', () => {
    // 02:00 UTC on Nov 11 is still Nov 10 in New York, so an invoice due Nov 10 is not overdue yet.
    const today = schoolDateOf(new Date('2026-11-11T02:00:00Z'), TZ);
    expect(today).toBe('2026-11-10');
    expect(deriveStatus(inv('0'), today)).toBe('ISSUED');
  });
});

describe('reminderSlot (FR-37)', () => {
  const due = '2026-11-20';
  it('follows the schedule', () => {
    expect(reminderSlot(due, '2026-11-16')).toBeNull();
    expect(reminderSlot(due, '2026-11-17')).toEqual({ kind: 'PRE_DUE_3D', scheduledFor: '2026-11-17' });
    expect(reminderSlot(due, '2026-11-19')).toEqual({ kind: 'PRE_DUE_3D', scheduledFor: '2026-11-17' });
    expect(reminderSlot(due, '2026-11-20')).toBeNull();
    expect(reminderSlot(due, '2026-11-21')).toEqual({ kind: 'DUE_PLUS_1', scheduledFor: '2026-11-21' });
    expect(reminderSlot(due, '2026-12-04')).toEqual({ kind: 'DUE_PLUS_1', scheduledFor: '2026-11-21' });
    expect(reminderSlot(due, '2026-12-05')).toEqual({ kind: 'OVERDUE_14D', scheduledFor: '2026-12-05' });
    expect(reminderSlot(due, '2026-12-20')).toEqual({ kind: 'OVERDUE_14D', scheduledFor: '2026-12-19' });
    expect(reminderSlot(null, '2026-12-20')).toBeNull();
  });
});

describe('agingBucket (FR-42)', () => {
  it('buckets days past due', () => {
    expect(agingBucket('2026-11-10', '2026-11-10')).toBe('current');
    expect(agingBucket('2026-11-10', '2026-11-11')).toBe('1-30');
    expect(agingBucket('2026-11-10', '2026-12-10')).toBe('1-30');
    expect(agingBucket('2026-11-10', '2026-12-11')).toBe('31-60');
    expect(agingBucket('2026-11-10', '2027-02-08')).toBe('61-90');
    expect(agingBucket('2026-11-10', '2027-02-09')).toBe('90+');
  });
});
