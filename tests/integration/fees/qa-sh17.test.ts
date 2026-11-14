// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DATABASE_URL ??= 'postgresql://unused@localhost/unused';
  process.env.APP_URL ??= 'http://localhost:3000';
  process.env.AUTH_SECRET ??= 'test-secret';
});

// Services take an explicit actor; next-auth is never loaded.
vi.mock('@/server/auth/requireRole', () => ({ requireRole: async () => { throw new Error('no session in this test'); } }));

import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import {
  bulkAssignOptionalFee,
  createDiscount,
  createFeeItem,
  createManualInvoice,
  createPlan,
  deleteDraft,
  generateInvoices,
  getInvoice,
  issue,
  listInvoices,
  listPayments,
  previewInvoices,
  recordPayment,
  remindInvoice,
  replacePlan,
  setStudentDiscounts,
  setStudentOptionalFees,
  updateDiscount,
  updateDraft,
} from '@/server/fees/fees-service';
import { exportInvoicesCsv, getDashboard, outstandingByStudent } from '@/server/fees/reports';

/**
 * QA (SH-17): the paths Dev's suites don't reach. Generation end to end (FR-11 to FR-16), setup guards
 * (FR-6 to FR-10), the draft lifecycle (FR-20), the manual reminder throttle (FR-38), the on-read
 * OVERDUE update (FR-25), parent payment scope (FR-32), CSV (FR-44), dashboard billed (FR-42) and
 * outstanding by student (FR-40). Year 2096 keeps document numbers clear of real data and other suites.
 */
const MARK = 'qa-sh17-gen';
const TODAY = '2096-02-10';
const ids = {} as Record<string, string>;
const students: string[] = [];
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

const mkUser = (n: string, role: 'ADMIN' | 'STUDENT' | 'PARENT') =>
  prisma.user
    .create({ data: { email: `${n}@${MARK}.test`, firstName: n, lastName: 'Qash17gen', role, status: 'ACTIVE', isBursar: role === 'ADMIN' } })
    .then((u) => u.id);

describe.skipIf(!process.env.TEST_DATABASE_URL)('QA SH-17 fees (integration)', () => {
  beforeAll(async () => {
    ids.admin = await mkUser('admin', 'ADMIN');
    ids.parent = await mkUser('parent', 'PARENT');
    ids.other = await mkUser('otherparent', 'PARENT');
    ids.grade = (await prisma.gradeLevel.create({ data: { name: MARK, shortName: MARK, order: 7000 + Math.floor(Math.random() * 900) } })).id;
    ids.year = (await prisma.academicYear.create({ data: { name: MARK, startDate: new Date('2095-09-01'), endDate: new Date('2096-07-01') } })).id;
    ids.term = (await prisma.term.create({ data: { academicYearId: ids.year, name: 'S1', order: 1, startDate: new Date('2095-09-01'), endDate: new Date('2096-01-31') } })).id;
    ids.section = (await prisma.section.create({ data: { academicYearId: ids.year, gradeLevelId: ids.grade, name: MARK } })).id;
    // Three siblings with the same primary parent, ranked by enrollment date (D-4), plus one with no parent.
    for (let i = 0; i < 4; i++) {
      const s = await mkUser(`s${i}`, 'STUDENT');
      students.push(s);
      await prisma.studentProfile.create({
        data: { userId: s, admissionNumber: `${MARK}-${i}`, dateOfBirth: new Date('2084-01-01'), gradeLevelId: ids.grade, enrollmentDate: new Date(`2095-0${i + 1}-01`) },
      });
      await prisma.sectionMember.create({ data: { sectionId: ids.section, studentId: s, academicYearId: ids.year } });
      if (i < 3) await prisma.parentStudentLink.create({ data: { parentId: ids.parent, studentId: s, relationship: 'MOTHER', isPrimary: true } });
    }
  });

  // Every filter is an id list or a MARK name looked up from the DB. Prisma treats `{ id: undefined }` as
  // "match all", so ids from a half-finished beforeAll must never reach a deleteMany.
  afterAll(async () => {
    const users = (await prisma.user.findMany({ where: { email: { endsWith: `@${MARK}.test` } }, select: { id: true } })).map((u) => u.id);
    const years = (await prisma.academicYear.findMany({ where: { name: MARK }, select: { id: true } })).map((y) => y.id);
    await prisma.paymentAllocation.deleteMany({ where: { invoice: { studentId: { in: users } } } });
    await prisma.payment.deleteMany({ where: { recordedById: { in: users } } });
    await prisma.invoice.deleteMany({ where: { studentId: { in: users } } });
    await prisma.studentDiscount.deleteMany({ where: { studentId: { in: users } } });
    await prisma.studentOptionalFee.deleteMany({ where: { studentId: { in: users } } });
    await prisma.feePlan.deleteMany({ where: { academicYearId: { in: years } } });
    await prisma.discount.deleteMany({ where: { name: { startsWith: MARK } } });
    await prisma.feeItem.deleteMany({ where: { code: { startsWith: 'QAGEN-SH17' } } });
    await prisma.section.deleteMany({ where: { name: MARK, academicYearId: { in: years } } }); // members cascade
    await prisma.term.deleteMany({ where: { academicYearId: { in: years } } });
    await prisma.documentSequence.deleteMany({ where: { year: 2096 } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: users } } });
    await prisma.notification.deleteMany({ where: { userId: { in: users } } });
    await prisma.parentStudentLink.deleteMany({ where: { studentId: { in: users } } });
    await prisma.studentProfile.deleteMany({ where: { userId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.academicYear.deleteMany({ where: { id: { in: years } } });
    await prisma.gradeLevel.deleteMany({ where: { name: MARK } });
    await prisma.$disconnect();
  });

  it('setup: items, plan PUT replaces lines, discount and assignment guards (FR-6 to FR-10)', async () => {
    const item = (code: string, name: string, amount: string, isOptional = false) =>
      createFeeItem(admin(), { name, code: `QAGEN-SH17-${code}`, description: null, defaultAmount: amount, isOptional });
    ids.tuition = (await item('TUI', 'Tuition', '2000.00')).id;
    ids.lab = (await item('LAB', 'Lab', '150.00')).id;
    ids.bus = (await item('BUS', 'Bus', '300.00', true)).id;

    const plan = await createPlan(admin(), {
      name: MARK, academicYearId: ids.year, termId: ids.term, gradeLevelId: ids.grade, dueDays: 30,
      lines: [{ feeItemId: ids.tuition, amount: '1.00' }],
    });
    const replaced = await replacePlan(admin(), plan.id, {
      name: MARK, academicYearId: ids.year, termId: ids.term, gradeLevelId: ids.grade, dueDays: 30,
      lines: [{ feeItemId: ids.tuition, amount: '2000.00' }, { feeItemId: ids.lab, amount: '150.00' }],
    });
    expect(replaced.lines.map((l) => l.amount)).toEqual(['2000.00', '150.00']);
    expect(replaced.total).toBe('2150.00');

    ids.merit = (await createDiscount(admin(), { name: `${MARK} Merit`, kind: 'PERCENT', value: '10.00', autoRule: null })).id;
    ids.sib2 = (await createDiscount(admin(), { name: `${MARK} Sib2`, kind: 'PERCENT', value: '5.00', autoRule: 'SIBLING_2ND' })).id;
    ids.sib3 = (await createDiscount(admin(), { name: `${MARK} Sib3`, kind: 'FIXED', value: '100.00', autoRule: 'SIBLING_3RD_PLUS' })).id;
    expect(await code(updateDiscount(admin(), ids.merit, { value: '100.01' }))).toBe('VALIDATION_ERROR');

    // Only optional items can be optional fees; only manual discounts can be assigned (FR-9, FR-10).
    expect(await code(setStudentOptionalFees(admin(), students[0], { academicYearId: ids.year, fees: [{ feeItemId: ids.lab, amount: '1.00' }] }))).toBe('VALIDATION_ERROR');
    expect(await code(setStudentDiscounts(admin(), students[0], { academicYearId: ids.year, discounts: [{ discountId: ids.sib2 }] }))).toBe('VALIDATION_ERROR');

    expect(await bulkAssignOptionalFee(admin(), { sectionId: ids.section, academicYearId: ids.year, feeItemId: ids.bus, amount: '300.00' })).toEqual({ assigned: 4, updated: 0 });
    // Keep the bus fee for s0 only, so the other rows stay simple.
    for (const s of students.slice(1)) await setStudentOptionalFees(admin(), s, { academicYearId: ids.year, fees: [] });
    await setStudentDiscounts(admin(), students[0], { academicYearId: ids.year, discounts: [{ discountId: ids.merit, note: 'Scholarship' }] });
  });

  it('preview applies plan, optional fee, manual and sibling discounts in the right order (FR-11, FR-12, FR-15)', async () => {
    const { rows } = await previewInvoices({ academicYearId: ids.year, termId: ids.term, gradeLevelIds: [ids.grade] });
    const row = (i: number) => rows.find((r) => r.studentId === students[i])!;
    const mine = (i: number, discountId: string) => row(i).lines.find((l) => l.discountId === discountId)?.amount;

    // AC1: 10% merit on the non-optional 2150 only: 2150 + 300 - 215 = 2235.00.
    expect([row(0).siblingRank, row(0).subtotal, row(0).total, mine(0, ids.merit)]).toEqual([1, '2450.00', '2235.00', '-215.00']);
    expect(mine(0, ids.sib2)).toBeUndefined();
    // AC2: second sibling gets 5% of 2150 = -107.50, and is never also given the 3rd-plus rule (D-5).
    expect([row(1).siblingRank, mine(1, ids.sib2), mine(1, ids.sib3)]).toEqual([2, '-107.50', undefined]);
    expect([row(2).siblingRank, mine(2, ids.sib3), mine(2, ids.sib2)]).toEqual([3, '-100.00', undefined]);
    // No primary parent → no sibling rank or auto discount.
    expect([row(3).siblingRank, row(3).total]).toEqual([null, '2150.00']);
    for (const r of rows) for (const l of r.lines.filter((x) => x.isDiscount)) expect(Number(l.amount)).toBeLessThan(0);
  });

  it('create-and-issue numbers, dates and notifies, then a re-run skips everyone (FR-13, FR-14, FR-16)', async () => {
    // A manual invoice must not cause a skip.
    await createManualInvoice(admin(), { studentId: students[3], academicYearId: ids.year, termId: ids.term, lines: [{ description: 'Trip', amount: '10.00' }], dueDays: 30, issue: false });

    const out = await generateInvoices(admin(), { academicYearId: ids.year, termId: ids.term, gradeLevelIds: [ids.grade], issue: true }, { today: TODAY });
    expect([out.created, out.issued, out.skipped.length]).toEqual([4, 4, 0]);
    const invs = await prisma.invoice.findMany({ where: { id: { in: out.invoiceIds } } });
    for (const inv of invs) {
      expect(inv.number).toMatch(/^INV-2096-\d{6}$/);
      expect(inv.status).toBe('ISSUED');
      expect(inv.issueDate!.toISOString().slice(0, 10)).toBe(TODAY);
      expect(inv.dueDate!.toISOString().slice(0, 10)).toBe('2096-03-11'); // leap year: Feb 10 + 30 days
    }
    expect(new Set(invs.map((i) => i.number)).size).toBe(4);
    expect(await prisma.notification.count({ where: { userId: ids.parent, type: 'fees.invoice_issued' } })).toBe(3);
    expect(await prisma.auditLog.count({ where: { entityId: { in: out.invoiceIds }, action: 'invoice.issue' } })).toBe(4);

    const again = await previewInvoices({ academicYearId: ids.year, termId: ids.term, gradeLevelIds: [ids.grade] });
    expect(again.rows.every((r) => r.skipped === 'ALREADY_INVOICED')).toBe(true);
    const rerun = await generateInvoices(admin(), { academicYearId: ids.year, termId: ids.term, gradeLevelIds: [ids.grade], issue: true }, { today: TODAY });
    expect([rerun.created, rerun.skipped.length]).toEqual([0, 4]);
    ids.s0invoice = invs.find((i) => i.studentId === students[0])!.id;
  });

  it('draft lifecycle: edit, issue, and delete only while DRAFT (FR-20)', async () => {
    const draft = await createManualInvoice(admin(), { studentId: students[1], academicYearId: ids.year, termId: null, lines: [{ description: 'Trip', amount: '50.00' }], dueDays: 10, issue: false });
    expect([draft.status, draft.number]).toEqual(['DRAFT', null]);
    const edited = await updateDraft(admin(), draft.id, { lines: [{ description: 'Trip', amount: '75.50' }, { description: 'Lunch', amount: '4.50' }] });
    expect(edited.total).toBe('80.00');
    const issued = await issue(admin(), draft.id, { today: TODAY });
    expect(issued.number).toMatch(/^INV-2096-/);
    expect(await code(updateDraft(admin(), draft.id, { notes: 'late edit' }))).toBe('CONFLICT');
    expect(await code(deleteDraft(admin(), draft.id))).toBe('CONFLICT');
    expect(await code(issue(admin(), draft.id, { today: TODAY }))).toBe('CONFLICT');

    const throwaway = await createManualInvoice(admin(), { studentId: students[1], academicYearId: ids.year, termId: null, lines: [{ description: 'X', amount: '1.00' }], dueDays: 10, issue: false });
    await deleteDraft(admin(), throwaway.id);
    expect(await prisma.invoice.findUnique({ where: { id: throwaway.id } })).toBeNull();
  });

  it('manual reminder is throttled to once per 24 h (FR-38)', async () => {
    const t0 = new Date('2096-02-12T10:00:00Z');
    expect((await remindInvoice(admin(), ids.s0invoice, { now: t0 })).recipients).toBe(1);
    expect(await code(remindInvoice(admin(), ids.s0invoice, { now: new Date(t0.getTime() + 23 * 3600_000) }))).toBe('RATE_LIMITED');
    expect(await code(remindInvoice(admin(), ids.s0invoice, { now: new Date(t0.getTime() + 25 * 3600_000) }))).toBe('OK');
    // Automatic reminders rely on this unique key, so the same slot cannot be recorded twice (FR-37).
    const slot = { invoiceId: ids.s0invoice, kind: 'DUE_PLUS_1' as const, scheduledFor: new Date('2096-03-12') };
    await prisma.invoiceReminder.create({ data: slot });
    await expect(prisma.invoiceReminder.create({ data: slot })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('a past-due ISSUED invoice reads as OVERDUE (FR-25)', async () => {
    // Created directly with a past due date so the real-clock sweep only touches a row that is truly overdue.
    const stale = await prisma.invoice.create({
      data: { studentId: students[2], academicYearId: ids.year, status: 'ISSUED', issueDate: new Date('2000-01-01'), dueDate: new Date('2000-01-31'), dueDays: 30, subtotal: '5.00', discountTotal: '0.00', total: '5.00', createdById: ids.admin },
    });
    expect((await getInvoice(admin(), stale.id)).status).toBe('OVERDUE');
    const listed = await listInvoices(admin(), { studentId: students[2], overdue: true, sort: { field: 'issueDate', dir: 'desc' } }, { page: 1, pageSize: 25, skip: 0, take: 25 });
    expect(listed.rows.map((r) => r.id)).toEqual([stale.id]);
  });

  it('payments are scoped to the family for parents (FR-32), and reports add up (FR-40, FR-42, FR-44)', async () => {
    const { payment } = await recordPayment(
      admin(),
      { payerParentId: ids.parent, amount: '235.00', method: 'CHEQUE', reference: 'CHQ-1', receivedAt: new Date('2096-02-15T12:00:00Z'), payerName: 'QA', allocations: [{ invoiceId: ids.s0invoice, amount: '235.00' }] },
      { today: TODAY },
    );
    expect(payment.receiptNumber).toMatch(/^RCT-2096-\d{6}$/);
    const page = { page: 1, pageSize: 25, skip: 0, take: 25 };
    const sort = { field: 'receivedAt' as const, dir: 'desc' as const };
    expect((await listPayments({ id: ids.parent, role: 'PARENT' }, { sort }, page)).rows.map((r) => r.id)).toEqual([payment.id]);
    expect((await listPayments({ id: ids.other, role: 'PARENT' }, { sort }, page)).rows).toEqual([]);

    const { byStudent } = await outstandingByStudent(students);
    expect(byStudent.get(students[0])).toBe('2000.00');

    // Billed for the term = Σ the 4 issued plan invoices (drafts excluded). Summed from the DB because a
    // seeded auto discount (e.g. the seed's Sibling 5%) also applies to these students.
    const issuedTotals = await prisma.invoice.aggregate({ where: { termId: ids.term, status: { notIn: ['DRAFT', 'VOID'] } }, _sum: { total: true } });
    const dash = await getDashboard(ids.term);
    expect([dash.termId, dash.kpis.billed, dash.kpis.collected]).toEqual([ids.term, issuedTotals._sum.total!.toFixed(2), '235.00']);
    expect(dash.trend).toHaveLength(12);

    const res = await exportInvoicesCsv({ q: 'Qash17gen', termId: ids.term });
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    const lines = (await res.text()).split('\r\n');
    expect(lines[0]).toBe('Number,Student,Grade,Section,Term,Status,Issue date,Due date,Total,Paid,Balance,Currency');
    expect(lines).toHaveLength(1 + 5); // 4 plan invoices + the manual term invoice (still DRAFT)
    expect(lines.some((l) => l.includes('2235.00,235.00,2000.00'))).toBe(true);
  });
});
