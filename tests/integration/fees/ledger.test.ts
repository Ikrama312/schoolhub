// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DATABASE_URL ??= 'postgresql://unused@localhost/unused';
  process.env.APP_URL ??= 'http://localhost:3000';
  process.env.AUTH_SECRET ??= 'test-secret';
});

// Services take an explicit actor here; stub the session module so next-auth is never loaded.
vi.mock('@/server/auth/requireRole', () => ({ requireRole: async () => { throw new Error('no session in this test'); } }));

import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import { adjustInvoice, createManualInvoice, getInvoice, recordPayment, reversePayment, voidInvoice } from '@/server/fees/fees-service';
import { deriveStatus } from '@/server/fees/fee-math';
import { dec, fixed2 } from '@/lib/money';

/**
 * PRD-17 FR-31 / FR-50 / NFR-1: reversal recompute, overpayment refusal, void/adjust guards, and a
 * seeded-random sequence of payments and reversals that checks amountPaid = Σ non-reversed allocations.
 */
const MARK = 'qa-sh17-ledger';
const TODAY = '2098-03-01';
const ids = {} as Record<string, string>;
const students: string[] = [];
const invoices: string[] = [];
const admin = () => ({ id: ids.admin, role: 'ADMIN' as const });

async function code(p: Promise<unknown>) {
  try {
    await p;
    return 'OK';
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
}

/** mulberry32: a fixed-seed PRNG so a failure replays exactly. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function checkIntegrity() {
  for (const id of invoices) {
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id } });
    const agg = await prisma.paymentAllocation.aggregate({ where: { invoiceId: id, payment: { reversedAt: null } }, _sum: { amount: true } });
    expect(fixed2(inv.amountPaid)).toBe(fixed2(agg._sum.amount ?? 0));
    expect(dec(inv.amountPaid).lte(inv.total)).toBe(true);
    if (inv.status !== 'VOID') {
      expect(inv.status).toBe(deriveStatus({ status: inv.status, total: inv.total, amountPaid: inv.amountPaid, dueDate: inv.dueDate!.toISOString().slice(0, 10) }, TODAY));
    }
  }
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('fee ledger (integration)', () => {
  beforeAll(async () => {
    const mk = (n: string, role: 'ADMIN' | 'STUDENT' | 'PARENT') =>
      prisma.user.create({ data: { email: `${n}@${MARK}.test`, firstName: 'QA', lastName: n, role, status: 'ACTIVE', isBursar: role === 'ADMIN' } }).then((u) => u.id);
    ids.admin = await mk('admin', 'ADMIN');
    ids.parent = await mk('parent', 'PARENT');
    ids.grade = (await prisma.gradeLevel.create({ data: { name: MARK, shortName: MARK, order: 8000 + Math.floor(Math.random() * 900) } })).id;
    ids.year = (await prisma.academicYear.create({ data: { name: MARK, startDate: new Date('2097-09-01'), endDate: new Date('2098-07-01') } })).id;
    for (let i = 0; i < 2; i++) {
      const s = await mk(`s${i}`, 'STUDENT');
      students.push(s);
      await prisma.studentProfile.create({ data: { userId: s, admissionNumber: `${MARK}-${i}`, dateOfBirth: new Date('2014-01-01'), gradeLevelId: ids.grade, enrollmentDate: new Date('2097-09-01') } });
      await prisma.parentStudentLink.create({ data: { parentId: ids.parent, studentId: s, relationship: 'FATHER', isPrimary: true } });
    }
    for (const [studentId, amount] of [[students[0], '500.00'], [students[1], '300.00'], [students[0], '200.00']]) {
      const inv = await createManualInvoice(
        admin(),
        { studentId, academicYearId: ids.year, termId: null, lines: [{ description: 'Fees', amount }], dueDays: 30, issue: true },
        { today: TODAY },
      );
      invoices.push(inv.id);
    }
  });

  afterAll(async () => {
    const users = (await prisma.user.findMany({ where: { email: { endsWith: `@${MARK}.test` } }, select: { id: true } })).map((u) => u.id);
    await prisma.paymentAllocation.deleteMany({ where: { invoice: { studentId: { in: users } } } });
    await prisma.payment.deleteMany({ where: { recordedById: { in: users } } });
    await prisma.invoice.deleteMany({ where: { studentId: { in: users } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: users } } });
    await prisma.notification.deleteMany({ where: { userId: { in: users } } });
    await prisma.studentProfile.deleteMany({ where: { userId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.academicYear.deleteMany({ where: { name: MARK } });
    await prisma.gradeLevel.deleteMany({ where: { name: MARK } });
    await prisma.$disconnect();
  });

  const pay = (amount: string, allocations?: { invoiceId: string; amount: string }[]) =>
    recordPayment(admin(), { payerParentId: ids.parent, amount, method: 'BANK_TRANSFER', receivedAt: new Date('2098-03-01T15:00:00Z'), payerName: 'QA', allocations }, { today: TODAY });

  it('refuses an overpayment with the formatted outstanding balance and saves nothing (FR-29)', async () => {
    const before = await prisma.payment.count({ where: { recordedById: ids.admin } });
    await expect(pay('1000.01')).rejects.toThrow("Amount exceeds the family's outstanding balance of $1,000.00");
    expect(await prisma.payment.count({ where: { recordedById: ids.admin } })).toBe(before);
  });

  it('allocates oldest first, reverses with recompute, and refuses a second reverse (FR-31)', async () => {
    const { payment } = await pay('600.00');
    expect(payment.allocations.map((a) => a.amount)).toEqual(['500.00', '100.00']);
    expect((await getInvoice(admin(), invoices[0])).status).toBe('PAID');
    expect((await getInvoice(admin(), invoices[1])).status).toBe('PARTIALLY_PAID');
    expect(await code(voidInvoice(admin(), invoices[0], 'paid already'))).toBe('CONFLICT');

    const reversed = await reversePayment(admin(), payment.id, 'Bounced transfer', { today: TODAY });
    expect(reversed.reversed).toBe(true);
    const inv0 = await getInvoice(admin(), invoices[0]);
    expect([inv0.status, inv0.amountPaid]).toEqual(['ISSUED', '0.00']);
    expect(await code(reversePayment(admin(), payment.id, 'again', { today: TODAY }))).toBe('CONFLICT');
    await checkIntegrity();
  });

  it('rejects allocations above a balance or not summing to the amount (FR-28)', async () => {
    expect(await code(pay('50.00', [{ invoiceId: invoices[2], amount: '40.00' }]))).toBe('VALIDATION_ERROR');
    expect(await code(pay('250.00', [{ invoiceId: invoices[2], amount: '250.00' }]))).toBe('VALIDATION_ERROR');
  });

  it('adjust cannot go below amountPaid (D-10)', async () => {
    await pay('100.00', [{ invoiceId: invoices[2], amount: '100.00' }]);
    expect(await code(adjustInvoice(admin(), invoices[2], { amount: '100.01', reason: 'too much', description: 'Adjustment' }, { today: TODAY }))).toBe('VALIDATION_ERROR');
    const adjusted = await adjustInvoice(admin(), invoices[2], { amount: '100.00', reason: 'Sibling goodwill', description: 'Adjustment' }, { today: TODAY });
    expect([adjusted.total, adjusted.status]).toEqual(['100.00', 'PAID']);
    expect(adjusted.lines.at(-1)).toMatchObject({ amount: '-100.00', isAdjustment: true, reason: 'Sibling goodwill' });
    await checkIntegrity();
  });

  it('keeps amountPaid = Σ non-reversed allocations across a random pay/reverse sequence (NFR-1)', async () => {
    const rand = rng(17);
    const live: string[] = [];
    for (let step = 0; step < 25; step++) {
      const outstanding = (await prisma.invoice.findMany({ where: { id: { in: invoices }, status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] } } }))
        .reduce((s, i) => s.plus(dec(i.total).minus(i.amountPaid)), dec(0));
      if (live.length && (rand() < 0.4 || outstanding.lte(0))) {
        const [id] = live.splice(Math.floor(rand() * live.length), 1);
        await reversePayment(admin(), id, 'random reverse', { today: TODAY });
      } else if (outstanding.gt(0)) {
        const amount = fixed2(Decimal_min(outstanding, dec(Math.floor(rand() * 30000) / 100 + 0.01)));
        live.push((await pay(amount)).payment.id);
      }
      await checkIntegrity();
    }
  });
});

const Decimal_min = (a: ReturnType<typeof dec>, b: ReturnType<typeof dec>) => (a.lt(b) ? a : b);
