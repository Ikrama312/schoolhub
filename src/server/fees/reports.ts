// PRD-17 reads shared by lists, totals and CSV (FR-17, FR-18, FR-39 to FR-44). Aggregates stay
// Decimal end to end and leave as 2-dp strings (ADR-2). Every entry point refreshes OVERDUE first (FR-25).
import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { toCsv } from '@/server/csv';
import type { AccessUser } from '@/server/auth/student-access';
import { addDateDays, formatInSchoolTz, schoolDateOf, schoolMidnight } from '@/lib/dates';
import { Decimal, dec, fixed2, ZERO } from '@/lib/money';
import type { InvoiceFilters, PaymentFilters } from '@/lib/validators/fees';
import { agingBucket, AGING_BUCKETS, daysBetween, OPEN_STATUSES, type AgingBucket } from './fee-math';
import { feeSettings, fromDbDate } from './ledger';
import { markOverdue, parentsOf } from './maintenance';
import { parentStudentIds } from './access';

/** Settings + the on-read OVERDUE sweep (FR-25). */
export async function freshFeeSettings(now: Date = new Date()) {
  const s = await feeSettings(now);
  await markOverdue(s.today);
  return s;
}

const fullName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`;
const balanceOf = (i: { total: Prisma.Decimal; amountPaid: Prisma.Decimal }) => dec(i.total).minus(i.amountPaid);

// ---------------------------------------------------------------------------
// Invoices: where builder, row shape
// ---------------------------------------------------------------------------

export function invoiceWhere(filters: InvoiceFilters, scope: 'ALL' | string[]): Prisma.InvoiceWhereInput {
  const and: Prisma.InvoiceWhereInput[] = [];
  if (scope !== 'ALL') and.push({ studentId: { in: scope }, status: { not: 'DRAFT' } });
  if (filters.status) and.push({ status: filters.status });
  if (filters.overdue) and.push({ status: 'OVERDUE' });
  if (filters.termId) and.push({ termId: filters.termId });
  if (filters.academicYearId) and.push({ academicYearId: filters.academicYearId });
  if (filters.studentId) and.push({ studentId: filters.studentId });
  if (filters.gradeLevelId) and.push({ student: { studentProfile: { gradeLevelId: filters.gradeLevelId } } });
  if (filters.sectionId) and.push({ student: { sectionMemberships: { some: { sectionId: filters.sectionId } } } });
  if (filters.q) {
    const contains = { contains: filters.q, mode: 'insensitive' as const };
    and.push({ OR: [{ number: contains }, { student: { firstName: contains } }, { student: { lastName: contains } }] });
  }
  return { AND: and };
}

export const invoiceRowSelect = {
  id: true,
  number: true,
  studentId: true,
  academicYearId: true,
  termId: true,
  feePlanId: true,
  status: true,
  issueDate: true,
  dueDate: true,
  total: true,
  amountPaid: true,
  term: { select: { name: true } },
  student: {
    select: {
      firstName: true,
      lastName: true,
      studentProfile: { select: { gradeLevel: { select: { name: true } } } },
      sectionMemberships: { select: { academicYearId: true, section: { select: { name: true } } } },
    },
  },
} satisfies Prisma.InvoiceSelect;
type InvoiceRowData = Prisma.InvoiceGetPayload<{ select: typeof invoiceRowSelect }>;

export function serializeInvoiceRow(i: InvoiceRowData) {
  return {
    id: i.id,
    number: i.number,
    studentId: i.studentId,
    studentName: fullName(i.student),
    gradeLevelName: i.student.studentProfile?.gradeLevel.name ?? null,
    sectionName: i.student.sectionMemberships.find((m) => m.academicYearId === i.academicYearId)?.section.name ?? null,
    termId: i.termId,
    termName: i.term?.name ?? null,
    status: i.status,
    issueDate: fromDbDate(i.issueDate),
    dueDate: fromDbDate(i.dueDate),
    total: fixed2(i.total),
    amountPaid: fixed2(i.amountPaid),
    balance: fixed2(balanceOf(i)),
    isPlanInvoice: i.feePlanId !== null,
  };
}
export type InvoiceRow = ReturnType<typeof serializeInvoiceRow>;

const INVOICE_ORDER: Record<string, (dir: 'asc' | 'desc') => Prisma.InvoiceOrderByWithRelationInput[]> = {
  dueDate: (dir) => [{ dueDate: { sort: dir, nulls: 'last' } }],
  issueDate: (dir) => [{ issueDate: { sort: dir, nulls: 'first' } }, { createdAt: dir }],
  number: (dir) => [{ number: { sort: dir, nulls: 'last' } }],
  total: (dir) => [{ total: dir }],
  studentName: (dir) => [{ student: { lastName: dir } }, { student: { firstName: dir } }],
};
export const invoiceOrderBy = (sort: { field: string; dir: 'asc' | 'desc' }) => [...INVOICE_ORDER[sort.field](sort.dir), { id: 'asc' as const }];

/** FR-18: billed / paid / outstanding over the whole filtered set (DRAFT and VOID excluded). */
export async function invoiceTotals(where: Prisma.InvoiceWhereInput) {
  const agg = await prisma.invoice.aggregate({
    where: { AND: [where, { status: { notIn: ['DRAFT', 'VOID'] } }] },
    _sum: { total: true, amountPaid: true },
  });
  const billed = dec(agg._sum.total ?? 0);
  const paid = dec(agg._sum.amountPaid ?? 0);
  return { billed: fixed2(billed), paid: fixed2(paid), outstanding: fixed2(billed.minus(paid)) };
}

// ---------------------------------------------------------------------------
// Payments: where builder, row shape
// ---------------------------------------------------------------------------

export function paymentWhere(filters: PaymentFilters, scope: 'ALL' | string[], tz: string): Prisma.PaymentWhereInput {
  const and: Prisma.PaymentWhereInput[] = [];
  if (scope !== 'ALL') and.push({ allocations: { some: { invoice: { studentId: { in: scope } } } } });
  if (filters.from) and.push({ receivedAt: { gte: schoolMidnight(filters.from, tz) } });
  if (filters.to) and.push({ receivedAt: { lt: schoolMidnight(addDateDays(filters.to, 1), tz) } });
  if (filters.method) and.push({ method: filters.method });
  if (filters.reversed !== undefined) and.push({ reversedAt: filters.reversed ? { not: null } : null });
  if (filters.parentId) and.push({ payerParentId: filters.parentId });
  if (filters.studentId) and.push({ allocations: { some: { invoice: { studentId: filters.studentId } } } });
  if (filters.q) {
    const contains = { contains: filters.q, mode: 'insensitive' as const };
    and.push({ OR: [{ receiptNumber: contains }, { payerName: contains }, { reference: contains }] });
  }
  return { AND: and };
}

export const paymentRowSelect = {
  id: true,
  receiptNumber: true,
  amount: true,
  method: true,
  reference: true,
  receivedAt: true,
  payerName: true,
  payerParentId: true,
  reversedAt: true,
  recordedBy: { select: { firstName: true, lastName: true } },
  allocations: { select: { invoice: { select: { number: true, studentId: true, student: { select: { firstName: true, lastName: true } } } } } },
} satisfies Prisma.PaymentSelect;
type PaymentRowData = Prisma.PaymentGetPayload<{ select: typeof paymentRowSelect }>;

/** scope limits which children's names a parent sees on a shared family payment. */
export function serializePaymentRow(p: PaymentRowData, scope: 'ALL' | string[] = 'ALL') {
  const allocs = p.allocations.filter((a) => scope === 'ALL' || scope.includes(a.invoice.studentId));
  return {
    id: p.id,
    receiptNumber: p.receiptNumber,
    amount: fixed2(p.amount),
    method: p.method,
    reference: p.reference,
    receivedAt: p.receivedAt.toISOString(),
    payerName: p.payerName,
    payerParentId: p.payerParentId,
    recordedByName: fullName(p.recordedBy),
    reversed: p.reversedAt !== null,
    reversedAt: p.reversedAt?.toISOString() ?? null,
    studentNames: [...new Set(allocs.map((a) => fullName(a.invoice.student)))],
    invoiceNumbers: allocs.map((a) => a.invoice.number ?? ''),
  };
}
export type PaymentRow = ReturnType<typeof serializePaymentRow>;

const PAYMENT_ORDER: Record<string, (dir: 'asc' | 'desc') => Prisma.PaymentOrderByWithRelationInput> = {
  receivedAt: (dir) => ({ receivedAt: dir }),
  amount: (dir) => ({ amount: dir }),
  receiptNumber: (dir) => ({ receiptNumber: dir }),
};
export const paymentOrderBy = (sort: { field: string; dir: 'asc' | 'desc' }) => [PAYMENT_ORDER[sort.field](sort.dir), { id: 'asc' as const }];

// ---------------------------------------------------------------------------
// Dashboard and aging (FR-42)
// ---------------------------------------------------------------------------

async function resolveTerm(termId: string | undefined, today: string) {
  if (termId) return prisma.term.findUnique({ where: { id: termId }, select: { id: true, name: true } });
  const terms = await prisma.term.findMany({
    where: { academicYear: { isCurrent: true } },
    orderBy: { startDate: 'asc' },
    select: { id: true, name: true, startDate: true },
  });
  // The latest term that has started, else the first one.
  return [...terms].reverse().find((t) => fromDbDate(t.startDate)! <= today) ?? terms[0] ?? null;
}

/** Monday (ISO week start) of a yyyy-MM-dd date. */
const weekStart = (d: string) => addDateDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));

export async function getDashboard(termId?: string, now: Date = new Date()) {
  const { today, tz, currency } = await freshFeeSettings(now);
  const term = await resolveTerm(termId, today);
  const billedWhere: Prisma.InvoiceWhereInput = { termId: term?.id ?? '__none__', status: { notIn: ['DRAFT', 'VOID'] } };
  const firstWeek = addDateDays(weekStart(today), -7 * 11);

  const [billedAgg, collectedAgg, openAgg, overdueAgg, payments] = await Promise.all([
    prisma.invoice.aggregate({ where: billedWhere, _sum: { total: true } }),
    prisma.paymentAllocation.aggregate({ where: { invoice: billedWhere, payment: { reversedAt: null } }, _sum: { amount: true } }),
    prisma.invoice.aggregate({ where: { status: { in: [...OPEN_STATUSES] } }, _sum: { total: true, amountPaid: true } }),
    prisma.invoice.aggregate({ where: { status: 'OVERDUE' }, _sum: { total: true, amountPaid: true } }),
    prisma.payment.findMany({
      where: { reversedAt: null, receivedAt: { gte: schoolMidnight(firstWeek, tz) } },
      select: { amount: true, receivedAt: true },
    }),
  ]);
  const billed = dec(billedAgg._sum.total ?? 0);
  const collected = dec(collectedAgg._sum.amount ?? 0);
  const sumBalance = (a: typeof openAgg) => dec(a._sum.total ?? 0).minus(a._sum.amountPaid ?? 0);

  const weeks = new Map<string, Decimal>(Array.from({ length: 12 }, (_, i) => [addDateDays(firstWeek, 7 * i), ZERO]));
  for (const p of payments) {
    const w = weekStart(schoolDateOf(p.receivedAt, tz));
    if (weeks.has(w)) weeks.set(w, weeks.get(w)!.plus(p.amount));
  }

  return {
    termId: term?.id ?? null,
    termName: term?.name ?? null,
    kpis: {
      billed: fixed2(billed),
      collected: fixed2(collected),
      outstanding: fixed2(sumBalance(openAgg)),
      overdue: fixed2(sumBalance(overdueAgg)),
      collectionRatePct: billed.isZero() ? 0 : collected.div(billed).mul(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toNumber(),
    },
    trend: [...weeks].map(([weekStart, amount]) => ({ weekStart, collected: fixed2(amount) })),
    currency,
  };
}

const openInvoiceAgingSelect = {
  id: true,
  number: true,
  status: true,
  dueDate: true,
  total: true,
  amountPaid: true,
  studentId: true,
  student: { select: { firstName: true, lastName: true } },
} satisfies Prisma.InvoiceSelect;

async function openInvoicesWithParents() {
  const invoices = await prisma.invoice.findMany({
    where: { status: { in: [...OPEN_STATUSES] } },
    select: openInvoiceAgingSelect,
    orderBy: [{ dueDate: 'asc' }, { number: 'asc' }],
  });
  const parentIds = await parentsOf(invoices.map((i) => i.studentId));
  const primaryIds = [...new Set([...parentIds.values()].map((ids) => ids[0]))];
  const parents = await prisma.user.findMany({ where: { id: { in: primaryIds } }, select: { id: true, firstName: true, lastName: true } });
  const parentName = new Map(parents.map((p) => [p.id, fullName(p)]));
  return invoices.map((i) => {
    const pid = parentIds.get(i.studentId)?.[0] ?? null;
    return { ...i, primaryParentId: pid, primaryParentName: pid ? parentName.get(pid) ?? null : null };
  });
}

export async function getAging(now: Date = new Date()) {
  const { today, currency } = await freshFeeSettings(now);
  const invoices = await openInvoicesWithParents();
  const buckets = new Map<AgingBucket, { count: number; amount: Decimal }>(AGING_BUCKETS.map((b) => [b, { count: 0, amount: ZERO }]));
  const families = new Map<string, { parentId: string; parentName: string; children: Set<string>; invoiceCount: number; overdue: Decimal; oldestDueDate: string }>();

  for (const inv of invoices) {
    const due = fromDbDate(inv.dueDate);
    const bal = balanceOf(inv);
    const b = buckets.get(agingBucket(due, today))!;
    b.count++;
    b.amount = b.amount.plus(bal);
    if (inv.status !== 'OVERDUE' || !inv.primaryParentId) continue;
    const f = families.get(inv.primaryParentId) ?? {
      parentId: inv.primaryParentId,
      parentName: inv.primaryParentName ?? '',
      children: new Set<string>(),
      invoiceCount: 0,
      overdue: ZERO,
      oldestDueDate: due!,
    };
    f.children.add(fullName(inv.student));
    f.invoiceCount++;
    f.overdue = f.overdue.plus(bal);
    if (due! < f.oldestDueDate) f.oldestDueDate = due!;
    families.set(inv.primaryParentId, f);
  }

  return {
    buckets: [...buckets].map(([bucket, v]) => ({ bucket, count: v.count, amount: fixed2(v.amount) })),
    topOverdueFamilies: [...families.values()]
      .sort((a, b) => b.overdue.comparedTo(a.overdue))
      .slice(0, 10)
      .map((f) => ({ ...f, children: [...f.children], overdue: fixed2(f.overdue) })),
    currency,
  };
}

// ---------------------------------------------------------------------------
// CSV (FR-44): non-negative money columns only (ADR-12 gotcha), raw 2-dp strings + a currency column
// ---------------------------------------------------------------------------

export function csvResponse(name: string, today: string, body: string): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}-${today}.csv"`,
    },
  });
}

// ponytail: exports load the whole filtered set in memory; stream if a school ever exports > ~50k rows.
export async function exportInvoicesCsv(filters: InvoiceFilters, now: Date = new Date()) {
  const { today, currency } = await freshFeeSettings(now);
  const rows = await prisma.invoice.findMany({
    where: invoiceWhere(filters, 'ALL'),
    select: invoiceRowSelect,
    orderBy: invoiceOrderBy({ field: 'issueDate', dir: 'desc' }),
  });
  const body = toCsv(
    [
      { key: 'number', header: 'Number' },
      { key: 'studentName', header: 'Student' },
      { key: 'gradeLevelName', header: 'Grade' },
      { key: 'sectionName', header: 'Section' },
      { key: 'termName', header: 'Term' },
      { key: 'status', header: 'Status' },
      { key: 'issueDate', header: 'Issue date' },
      { key: 'dueDate', header: 'Due date' },
      { key: 'total', header: 'Total' },
      { key: 'amountPaid', header: 'Paid' },
      { key: 'balance', header: 'Balance' },
      { key: 'currency', header: 'Currency' },
    ],
    rows.map((r) => ({ ...serializeInvoiceRow(r), currency })),
  );
  return csvResponse('invoices', today, body);
}

export async function exportPaymentsCsv(filters: PaymentFilters, now: Date = new Date()) {
  const { today, tz, currency } = await feeSettings(now);
  const rows = await prisma.payment.findMany({
    where: paymentWhere(filters, 'ALL', tz),
    select: { ...paymentRowSelect, reversalReason: true },
    orderBy: { receivedAt: 'desc' },
  });
  const body = toCsv(
    [
      { key: 'receiptNumber', header: 'Receipt' },
      { key: 'receivedAt', header: 'Received at' },
      { key: 'payerName', header: 'Payer' },
      { key: 'method', header: 'Method' },
      { key: 'reference', header: 'Reference' },
      { key: 'amount', header: 'Amount' },
      { key: 'reversed', header: 'Reversed' },
      { key: 'reversedAt', header: 'Reversed at' },
      { key: 'reversalReason', header: 'Reversal reason' },
      { key: 'invoices', header: 'Invoices' },
      { key: 'currency', header: 'Currency' },
    ],
    rows.map((p) => {
      const row = serializePaymentRow(p);
      return {
        ...row,
        receivedAt: formatInSchoolTz(p.receivedAt, 'yyyy-MM-dd HH:mm', tz),
        reversed: row.reversed ? 'Yes' : 'No',
        reversedAt: p.reversedAt ? schoolDateOf(p.reversedAt, tz) : '',
        reversalReason: p.reversalReason ?? '',
        invoices: row.invoiceNumbers.join(' '),
        currency,
      };
    }),
  );
  return csvResponse('payments', today, body);
}

export async function exportAgingCsv(now: Date = new Date()) {
  const { today, currency } = await freshFeeSettings(now);
  const invoices = await openInvoicesWithParents();
  const body = toCsv(
    [
      { key: 'number', header: 'Number' },
      { key: 'student', header: 'Student' },
      { key: 'parent', header: 'Primary parent' },
      { key: 'dueDate', header: 'Due date' },
      { key: 'daysOverdue', header: 'Days overdue' },
      { key: 'bucket', header: 'Bucket' },
      { key: 'balance', header: 'Balance' },
      { key: 'currency', header: 'Currency' },
    ],
    invoices.map((i) => {
      const due = fromDbDate(i.dueDate);
      return {
        number: i.number,
        student: fullName(i.student),
        parent: i.primaryParentName ?? '',
        dueDate: due,
        daysOverdue: due ? Math.max(0, daysBetween(due, today)) : 0,
        bucket: agingBucket(due, today),
        balance: fixed2(balanceOf(i)),
        currency,
      };
    }),
  );
  return csvResponse('aging', today, body);
}

// ---------------------------------------------------------------------------
// Parent page and brownfield KPIs (FR-39, FR-40, FR-43)
// ---------------------------------------------------------------------------

export async function getMyFees(parent: AccessUser, now: Date = new Date()) {
  const { currency, invoiceFooter } = await freshFeeSettings(now);
  const ids = await parentStudentIds(parent);
  // ponytail: whole family history in one response; paginate if a family ever has hundreds of invoices.
  const [invoices, payments, children] = await Promise.all([
    prisma.invoice.findMany({
      where: invoiceWhere({}, ids),
      select: invoiceRowSelect,
      orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
    }),
    prisma.payment.findMany({
      where: paymentWhere({}, ids, 'UTC'),
      select: paymentRowSelect,
      orderBy: { receivedAt: 'desc' },
    }),
    prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true }, orderBy: { firstName: 'asc' } }),
  ]);
  const rows = invoices.map(serializeInvoiceRow);
  const open = rows.filter((r) => (OPEN_STATUSES as readonly string[]).includes(r.status));
  const outstandingOf = (list: InvoiceRow[]) => fixed2(list.reduce((s, r) => s.plus(r.balance), ZERO));
  const upcoming = open.filter((r) => r.status !== 'OVERDUE' && r.dueDate).map((r) => r.dueDate!).sort();
  return {
    summary: {
      outstanding: outstandingOf(open),
      nextDueDate: upcoming[0] ?? null,
      overdue: outstandingOf(open.filter((r) => r.status === 'OVERDUE')),
    },
    children: children.map((c) => ({ id: c.id, name: fullName(c), outstanding: outstandingOf(open.filter((r) => r.studentId === c.id)) })),
    invoices: rows,
    payments: payments.map((p) => ({ ...serializePaymentRow(p, ids), receiptUrl: `/fees/receipts/${p.id}/print` })),
    invoiceFooter,
    currency,
  };
}

/** FR-43: Σ balance of open invoices. */
export async function outstandingTotal(now: Date = new Date()) {
  const { currency } = await freshFeeSettings(now);
  const agg = await prisma.invoice.aggregate({ where: { status: { in: [...OPEN_STATUSES] } }, _sum: { total: true, amountPaid: true } });
  return { amount: fixed2(dec(agg._sum.total ?? 0).minus(agg._sum.amountPaid ?? 0)), currency };
}

/** FR-40: studentId → outstanding balance (only students with open invoices appear). */
export async function outstandingByStudent(studentIds: readonly string[], now: Date = new Date()) {
  const { currency } = await freshFeeSettings(now);
  const groups = await prisma.invoice.groupBy({
    by: ['studentId'],
    where: { studentId: { in: [...studentIds] }, status: { in: [...OPEN_STATUSES] } },
    _sum: { total: true, amountPaid: true },
  });
  return {
    currency,
    byStudent: new Map(groups.map((g) => [g.studentId, fixed2(dec(g._sum.total ?? 0).minus(g._sum.amountPaid ?? 0))])),
  };
}
