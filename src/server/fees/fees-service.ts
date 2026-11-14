// PRD-17 public fee service (NFR-7): setup (FR-6 to FR-10), invoices (FR-12 to FR-23, FR-38) and
// payments (FR-26 to FR-32). Used by route handlers, pages, the seed and the tests. Writes audit and
// notify after commit (D-13); every read refreshes OVERDUE first (FR-25).
import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { AppError, type PaginationParams } from '@/server/http';
import { audit } from '@/server/audit';
import { notify } from '@/server/notifications/notify';
import type { AccessUser } from '@/server/auth/student-access';
import { schoolDateOf } from '@/lib/dates';
import { amountInWords, dec, fixed2, formatMoney, sumMoney } from '@/lib/money';
import type {
  AdjustInput,
  BulkOptionalFeeInput,
  DiscountInput,
  DiscountPatch,
  DraftPatch,
  FeeItemInput,
  FeeItemPatch,
  FeePlanInput,
  GenerateInput,
  InvoiceListQuery,
  ManualInvoiceInput,
  PaymentListQuery,
  PreviewInput,
  RecordPaymentInput,
  SetupListQuery,
  StudentDiscountsInput,
  StudentOptionalFeesInput,
  AutoRule,
} from '@/lib/validators/fees';
import {
  autoAllocate,
  computeInvoiceTotals,
  isOpen,
  OPEN_STATUSES,
  siblingRank,
  siblingRuleFor,
  validateAllocations,
  type ChargeLine,
  type DiscountRule,
  type DraftLine,
} from './fee-math';
import { feeSettings, fromDbDate, issueInvoice, lockInvoices, nextDocumentNumber, recomputeInvoice, type Tx } from './ledger';
import { notifyReminder, parentsOf } from './maintenance';
import { assertCanSeeInvoice, assertCanSeePayment, assertParent, feeStudentScope } from './access';
import {
  freshFeeSettings,
  invoiceOrderBy,
  invoiceRowSelect,
  invoiceTotals,
  invoiceWhere,
  paymentOrderBy,
  paymentRowSelect,
  paymentWhere,
  serializeInvoiceRow,
  serializePaymentRow,
} from './reports';

const fullName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`;
const nameSelect = { select: { id: true, firstName: true, lastName: true } } as const;

/** Options for tests and the seed: inject "today"/"now" (school-tz date / instant). */
export interface ClockOptions {
  today?: string;
  now?: Date;
}

interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  extra?: Record<string, unknown>;
}

/** D-13: after commit, never throws (audit() swallows its own errors). */
async function auditAll(actorId: string, entries: AuditEntry[]) {
  for (const e of entries) {
    await audit({
      actorId,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      metadata: { before: e.before ?? null, after: e.after ?? null, ...e.extra },
    });
  }
}

async function currentYearId(): Promise<string> {
  const year = await prisma.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
  if (!year) throw new AppError('VALIDATION_ERROR', 'No current academic year is set.');
  return year.id;
}

const conflict = (message: string) => new AppError('CONFLICT', message);
const invalid = (message: string, details?: unknown) => new AppError('VALIDATION_ERROR', message, details);

// ===========================================================================
// Setup (FR-6 to FR-10)
// ===========================================================================

type FeeItemRow = Prisma.FeeItemGetPayload<object>;
const serializeItem = (i: FeeItemRow) => ({
  id: i.id,
  name: i.name,
  code: i.code,
  description: i.description,
  defaultAmount: fixed2(i.defaultAmount),
  isOptional: i.isOptional,
  archivedAt: i.archivedAt?.toISOString() ?? null,
});

export async function listFeeItems(q: SetupListQuery = {}) {
  const { currency } = await feeSettings();
  const items = await prisma.feeItem.findMany({
    where: { ...(q.includeArchived ? {} : { archivedAt: null }), ...(q.optional !== undefined ? { isOptional: q.optional } : {}) },
    orderBy: [{ archivedAt: { sort: 'desc', nulls: 'first' } }, { name: 'asc' }],
  });
  return { items: items.map(serializeItem), currency };
}

export async function createFeeItem(actor: AccessUser, input: FeeItemInput) {
  const item = await prisma.feeItem.create({ data: { ...input, description: input.description ?? null } });
  await auditAll(actor.id, [{ action: 'feeItem.create', entityType: 'FeeItem', entityId: item.id, after: serializeItem(item) }]);
  return serializeItem(item);
}

export async function updateFeeItem(actor: AccessUser, id: string, patch: FeeItemPatch) {
  const before = await prisma.feeItem.findUniqueOrThrow({ where: { id } });
  const item = await prisma.feeItem.update({ where: { id }, data: patch });
  await auditAll(actor.id, [{ action: 'feeItem.update', entityType: 'FeeItem', entityId: id, before: serializeItem(before), after: serializeItem(item) }]);
  return serializeItem(item);
}

export async function archiveFeeItem(actor: AccessUser, id: string) {
  const before = await prisma.feeItem.findUniqueOrThrow({ where: { id } });
  if (before.archivedAt) return serializeItem(before);
  const item = await prisma.feeItem.update({ where: { id }, data: { archivedAt: new Date() } });
  await auditAll(actor.id, [{ action: 'feeItem.archive', entityType: 'FeeItem', entityId: id, before: serializeItem(before), after: serializeItem(item) }]);
  return serializeItem(item);
}

const planInclude = {
  lines: { include: { feeItem: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
  term: { select: { name: true } },
  gradeLevel: { select: { name: true } },
} satisfies Prisma.FeePlanInclude;
type PlanRow = Prisma.FeePlanGetPayload<{ include: typeof planInclude }>;

const serializePlan = (p: PlanRow) => ({
  id: p.id,
  name: p.name,
  academicYearId: p.academicYearId,
  termId: p.termId,
  termName: p.term?.name ?? null,
  gradeLevelId: p.gradeLevelId,
  gradeLevelName: p.gradeLevel.name,
  dueDays: p.dueDays,
  lines: p.lines.map((l) => ({ id: l.id, feeItemId: l.feeItemId, feeItemName: l.feeItem.name, amount: fixed2(l.amount) })),
  total: fixed2(sumMoney(p.lines.map((l) => l.amount))),
  archivedAt: p.archivedAt?.toISOString() ?? null,
});

export async function listPlans(q: SetupListQuery = {}) {
  const { currency } = await feeSettings();
  const plans = await prisma.feePlan.findMany({
    where: {
      ...(q.includeArchived ? {} : { archivedAt: null }),
      ...(q.academicYearId ? { academicYearId: q.academicYearId } : {}),
      ...(q.termId ? { termId: q.termId === 'annual' ? null : q.termId } : {}),
      ...(q.gradeLevelId ? { gradeLevelId: q.gradeLevelId } : {}),
    },
    include: planInclude,
    orderBy: [{ academicYear: { startDate: 'desc' } }, { gradeLevel: { order: 'asc' } }, { term: { order: 'asc' } }],
  });
  return { plans: plans.map(serializePlan), currency };
}

async function checkPlanRefs(input: FeePlanInput) {
  if (input.termId) {
    const term = await prisma.term.findUnique({ where: { id: input.termId }, select: { academicYearId: true } });
    if (!term || term.academicYearId !== input.academicYearId) throw invalid('The term does not belong to the academic year.');
  }
  const ids = input.lines.map((l) => l.feeItemId);
  const ok = await prisma.feeItem.count({ where: { id: { in: ids }, archivedAt: null } });
  if (ok !== ids.length) throw invalid('Every line needs an existing, non-archived fee item.');
}

const planData = (input: FeePlanInput) => ({
  name: input.name,
  academicYearId: input.academicYearId,
  termId: input.termId,
  gradeLevelId: input.gradeLevelId,
  dueDays: input.dueDays,
});

export async function createPlan(actor: AccessUser, input: FeePlanInput) {
  await checkPlanRefs(input);
  const plan = await prisma.feePlan.create({
    data: { ...planData(input), lines: { createMany: { data: input.lines } } },
    include: planInclude,
  });
  await auditAll(actor.id, [{ action: 'feePlan.create', entityType: 'FeePlan', entityId: plan.id, after: serializePlan(plan) }]);
  return serializePlan(plan);
}

/** FR-7: PUT replaces the whole plan and its lines in one transaction; existing invoices are untouched. */
export async function replacePlan(actor: AccessUser, id: string, input: FeePlanInput) {
  await checkPlanRefs(input);
  const before = await prisma.feePlan.findUniqueOrThrow({ where: { id }, include: planInclude });
  const plan = await prisma.$transaction(async (tx) => {
    await tx.feePlanLine.deleteMany({ where: { feePlanId: id } });
    return tx.feePlan.update({
      where: { id },
      data: { ...planData(input), lines: { createMany: { data: input.lines } } },
      include: planInclude,
    });
  });
  await auditAll(actor.id, [{ action: 'feePlan.update', entityType: 'FeePlan', entityId: id, before: serializePlan(before), after: serializePlan(plan) }]);
  return serializePlan(plan);
}

type DiscountRow = Prisma.DiscountGetPayload<object>;
const serializeDiscount = (d: DiscountRow) => ({
  id: d.id,
  name: d.name,
  kind: d.kind,
  value: fixed2(d.value),
  autoRule: d.autoRule as AutoRule | null,
  archivedAt: d.archivedAt?.toISOString() ?? null,
});

export async function listDiscounts(q: SetupListQuery = {}) {
  const { currency } = await feeSettings();
  const discounts = await prisma.discount.findMany({
    where: { ...(q.includeArchived ? {} : { archivedAt: null }), ...(q.manualOnly ? { autoRule: null } : {}) },
    orderBy: { name: 'asc' },
  });
  return { discounts: discounts.map(serializeDiscount), currency };
}

export async function createDiscount(actor: AccessUser, input: DiscountInput) {
  const d = await prisma.discount.create({ data: input });
  await auditAll(actor.id, [{ action: 'discount.create', entityType: 'Discount', entityId: d.id, after: serializeDiscount(d) }]);
  return serializeDiscount(d);
}

export async function updateDiscount(actor: AccessUser, id: string, patch: DiscountPatch) {
  const before = await prisma.discount.findUniqueOrThrow({ where: { id } });
  const kind = patch.kind ?? before.kind;
  const value = patch.value ?? fixed2(before.value);
  if (kind === 'PERCENT' && dec(value).gt(100)) throw invalid('A percent discount must be between 0 and 100');
  const d = await prisma.discount.update({ where: { id }, data: patch });
  await auditAll(actor.id, [{ action: 'discount.update', entityType: 'Discount', entityId: id, before: serializeDiscount(before), after: serializeDiscount(d) }]);
  return serializeDiscount(d);
}

export async function archiveDiscount(actor: AccessUser, id: string) {
  const before = await prisma.discount.findUniqueOrThrow({ where: { id } });
  if (before.archivedAt) return serializeDiscount(before);
  const d = await prisma.discount.update({ where: { id }, data: { archivedAt: new Date() } });
  await auditAll(actor.id, [{ action: 'discount.archive', entityType: 'Discount', entityId: id, before: serializeDiscount(before), after: serializeDiscount(d) }]);
  return serializeDiscount(d);
}

export async function getStudentOptionalFees(studentId: string, academicYearId?: string) {
  const yearId = academicYearId ?? (await currentYearId());
  const { currency } = await feeSettings();
  const rows = await prisma.studentOptionalFee.findMany({
    where: { studentId, academicYearId: yearId },
    include: { feeItem: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return {
    academicYearId: yearId,
    fees: rows.map((r) => ({ feeItemId: r.feeItemId, feeItemName: r.feeItem.name, amount: fixed2(r.amount) })),
    currency,
  };
}

async function assertOptionalItems(ids: string[]) {
  const ok = await prisma.feeItem.count({ where: { id: { in: ids }, isOptional: true, archivedAt: null } });
  if (ok !== new Set(ids).size) throw invalid('Only optional, non-archived fee items can be assigned as optional fees.');
}

export async function setStudentOptionalFees(actor: AccessUser, studentId: string, input: StudentOptionalFeesInput) {
  await assertOptionalItems(input.fees.map((f) => f.feeItemId));
  const before = await getStudentOptionalFees(studentId, input.academicYearId);
  await prisma.$transaction([
    prisma.studentOptionalFee.deleteMany({ where: { studentId, academicYearId: input.academicYearId } }),
    prisma.studentOptionalFee.createMany({
      data: input.fees.map((f) => ({ studentId, academicYearId: input.academicYearId, feeItemId: f.feeItemId, amount: f.amount })),
    }),
  ]);
  const after = await getStudentOptionalFees(studentId, input.academicYearId);
  await auditAll(actor.id, [{ action: 'studentOptionalFee.set', entityType: 'User', entityId: studentId, before: before.fees, after: after.fees }]);
  return after;
}

/** FR-9: one optional fee to every active member of a section for the year (upsert). */
export async function bulkAssignOptionalFee(actor: AccessUser, input: BulkOptionalFeeInput) {
  await assertOptionalItems([input.feeItemId]);
  const members = await prisma.sectionMember.findMany({
    where: { sectionId: input.sectionId, student: { archivedAt: null, role: 'STUDENT' } },
    select: { studentId: true },
  });
  const studentIds = members.map((m) => m.studentId);
  const existing = await prisma.studentOptionalFee.count({
    where: { studentId: { in: studentIds }, academicYearId: input.academicYearId, feeItemId: input.feeItemId },
  });
  await prisma.$transaction(
    studentIds.map((studentId) =>
      prisma.studentOptionalFee.upsert({
        where: { studentId_academicYearId_feeItemId: { studentId, academicYearId: input.academicYearId, feeItemId: input.feeItemId } },
        create: { studentId, academicYearId: input.academicYearId, feeItemId: input.feeItemId, amount: input.amount },
        update: { amount: input.amount },
      }),
    ),
  );
  const result = { assigned: studentIds.length - existing, updated: existing };
  await auditAll(actor.id, [
    { action: 'studentOptionalFee.set', entityType: 'Section', entityId: input.sectionId, after: { ...input, ...result } },
  ]);
  return result;
}

export async function getStudentDiscounts(studentId: string, academicYearId?: string) {
  const yearId = academicYearId ?? (await currentYearId());
  const { currency } = await feeSettings();
  const rows = await prisma.studentDiscount.findMany({
    where: { studentId, academicYearId: yearId },
    include: { discount: true },
    orderBy: { createdAt: 'asc' },
  });
  return {
    academicYearId: yearId,
    discounts: rows.map((r) => ({ discountId: r.discountId, name: r.discount.name, kind: r.discount.kind, value: fixed2(r.discount.value), note: r.note })),
    currency,
  };
}

/** FR-10: manual discounts only (autoRule must be null). */
export async function setStudentDiscounts(actor: AccessUser, studentId: string, input: StudentDiscountsInput) {
  const ids = input.discounts.map((d) => d.discountId);
  const ok = await prisma.discount.count({ where: { id: { in: ids }, autoRule: null, archivedAt: null } });
  if (ok !== ids.length) throw invalid('Only manual, non-archived discounts can be assigned to a student.');
  const before = await getStudentDiscounts(studentId, input.academicYearId);
  await prisma.$transaction([
    prisma.studentDiscount.deleteMany({ where: { studentId, academicYearId: input.academicYearId } }),
    prisma.studentDiscount.createMany({
      data: input.discounts.map((d) => ({ studentId, academicYearId: input.academicYearId, discountId: d.discountId, note: d.note ?? null })),
    }),
  ]);
  const after = await getStudentDiscounts(studentId, input.academicYearId);
  await auditAll(actor.id, [{ action: 'studentDiscount.set', entityType: 'User', entityId: studentId, before: before.discounts, after: after.discounts }]);
  return after;
}

// ===========================================================================
// Invoice drafts (FR-11 to FR-16, D-4, D-5, D-7, D-12, NFR-5)
// ===========================================================================

const toRule = (d: { id: string; name: string; kind: 'PERCENT' | 'FIXED'; value: Prisma.Decimal }): DiscountRule => ({
  id: d.id,
  name: d.name,
  kind: d.kind,
  value: fixed2(d.value),
});

/**
 * Discounts that apply to each student in a year: manual StudentDiscounts plus the sibling auto rule
 * for their rank among the students sharing their primary parent (D-4, D-5). Batched: 4 queries.
 */
async function discountRulesFor(studentIds: readonly string[], academicYearId: string) {
  const [manual, autoDiscounts, primaryLinks] = await Promise.all([
    prisma.studentDiscount.findMany({
      where: { studentId: { in: [...studentIds] }, academicYearId, discount: { archivedAt: null, autoRule: null } },
      include: { discount: true },
    }),
    prisma.discount.findMany({ where: { archivedAt: null, autoRule: { not: null } } }),
    prisma.parentStudentLink.findMany({ where: { studentId: { in: [...studentIds] }, isPrimary: true }, select: { studentId: true, parentId: true } }),
  ]);
  const primaryOf = new Map(primaryLinks.map((l) => [l.studentId, l.parentId]));
  const siblingLinks = autoDiscounts.length
    ? await prisma.parentStudentLink.findMany({
        where: { parentId: { in: [...new Set(primaryOf.values())] }, isPrimary: true, student: { archivedAt: null, role: 'STUDENT' } },
        select: { parentId: true, student: { select: { id: true, studentProfile: { select: { enrollmentDate: true, dateOfBirth: true } } } } },
      })
    : [];
  const familyOf = new Map<string, { id: string; enrollmentDate: string; dateOfBirth: string }[]>();
  for (const l of siblingLinks) {
    const p = l.student.studentProfile;
    if (!p) continue;
    familyOf.set(l.parentId, [
      ...(familyOf.get(l.parentId) ?? []),
      { id: l.student.id, enrollmentDate: fromDbDate(p.enrollmentDate)!, dateOfBirth: fromDbDate(p.dateOfBirth)! },
    ]);
  }
  const activeRules = new Set(autoDiscounts.map((d) => d.autoRule as AutoRule));

  const result = new Map<string, { rules: DiscountRule[]; siblingRank: number | null }>();
  for (const id of studentIds) {
    const parent = primaryOf.get(id);
    const rank = parent ? siblingRank(id, familyOf.get(parent) ?? []) : null;
    const rule = siblingRuleFor(rank, activeRules);
    result.set(id, {
      siblingRank: rank,
      rules: [
        ...manual.filter((m) => m.studentId === id).map((m) => toRule(m.discount)),
        ...autoDiscounts.filter((d) => d.autoRule === rule).map(toRule),
      ],
    });
  }
  return result;
}

export interface DraftRow {
  studentId: string;
  studentName: string;
  gradeLevelName: string;
  sectionName: string | null;
  feePlanId: string | null;
  dueDays: number;
  lines: DraftLine[];
  subtotal: string;
  discountTotal: string;
  total: string;
  siblingRank: number | null;
  skipped: null | 'ALREADY_INVOICED' | 'NO_PLAN';
}

/** FR-12/FR-13: one row per non-archived student in the grades, ≈8 batched queries (NFR-5). */
export async function buildInvoiceDrafts(input: PreviewInput): Promise<DraftRow[]> {
  const { academicYearId, termId, gradeLevelIds } = input;
  const [plans, students] = await Promise.all([
    prisma.feePlan.findMany({
      where: { academicYearId, termId, gradeLevelId: { in: gradeLevelIds }, archivedAt: null },
      include: { lines: { include: { feeItem: { select: { name: true } } }, orderBy: { createdAt: 'asc' } } },
    }),
    prisma.user.findMany({
      where: { role: 'STUDENT', archivedAt: null, studentProfile: { gradeLevelId: { in: gradeLevelIds } } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        studentProfile: { select: { gradeLevelId: true, gradeLevel: { select: { name: true, order: true } } } },
        sectionMemberships: { where: { academicYearId }, select: { section: { select: { name: true } } } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    }),
  ]);
  const ids = students.map((s) => s.id);
  const [optional, existing, discounts] = await Promise.all([
    prisma.studentOptionalFee.findMany({
      where: { academicYearId, studentId: { in: ids } },
      include: { feeItem: { select: { name: true } } },
    }),
    prisma.invoice.findMany({
      where: { studentId: { in: ids }, feePlanId: { not: null }, status: { not: 'VOID' }, ...(termId ? { termId } : { termId: null, academicYearId }) },
      select: { studentId: true },
    }),
    discountRulesFor(ids, academicYearId),
  ]);
  const planByGrade = new Map(plans.map((p) => [p.gradeLevelId, p]));
  const invoiced = new Set(existing.map((e) => e.studentId));

  const rows = students.map((s): DraftRow & { order: number } => {
    const profile = s.studentProfile!;
    const plan = planByGrade.get(profile.gradeLevelId);
    const base = {
      studentId: s.id,
      studentName: fullName(s),
      gradeLevelName: profile.gradeLevel.name,
      order: profile.gradeLevel.order,
      sectionName: s.sectionMemberships[0]?.section.name ?? null,
      feePlanId: plan?.id ?? null,
      dueDays: plan?.dueDays ?? 30,
      siblingRank: discounts.get(s.id)?.siblingRank ?? null,
    };
    const skipped = invoiced.has(s.id) ? 'ALREADY_INVOICED' : plan ? null : 'NO_PLAN';
    if (!plan || skipped) return { ...base, lines: [], subtotal: '0.00', discountTotal: '0.00', total: '0.00', skipped };
    // D-12 (assumption): an optional fee for the year is billed on every plan invoice of that year.
    const charges: ChargeLine[] = [
      ...plan.lines.map((l) => ({ description: l.feeItem.name, amount: l.amount, feeItemId: l.feeItemId })),
      ...optional.filter((o) => o.studentId === s.id).map((o) => ({ description: o.feeItem.name, amount: o.amount, feeItemId: o.feeItemId, isOptional: true })),
    ];
    return { ...base, ...computeInvoiceTotals(charges, discounts.get(s.id)?.rules ?? []), skipped: null };
  });
  return rows.sort((a, b) => a.order - b.order).map(({ order: _order, ...row }) => row);
}

export async function previewInvoices(input: PreviewInput) {
  const { currency } = await feeSettings();
  const rows = await buildInvoiceDrafts(input);
  const live = rows.filter((r) => !r.skipped);
  return {
    rows,
    summary: { toCreate: live.length, skipped: rows.length - live.length, total: fixed2(sumMoney(live.map((r) => r.total))) },
    currency,
  };
}

const lineData = (lines: DraftLine[]) =>
  lines.map(({ description, amount, feeItemId, discountId, isOptional, isDiscount, isAdjustment, reason, sortOrder }) => ({
    description, amount, feeItemId: feeItemId ?? null, discountId: discountId ?? null, isOptional, isDiscount, isAdjustment, reason: reason ?? null, sortOrder,
  }));

async function writeDraft(tx: Tx, actor: AccessUser, input: PreviewInput, row: DraftRow, issue: boolean, today: string) {
  const inv = await tx.invoice.create({
    data: {
      studentId: row.studentId,
      academicYearId: input.academicYearId,
      termId: input.termId,
      feePlanId: row.feePlanId,
      dueDays: row.dueDays,
      subtotal: row.subtotal,
      discountTotal: row.discountTotal,
      total: row.total,
      createdById: actor.id,
      lines: { createMany: { data: lineData(row.lines) } },
    },
    select: { id: true },
  });
  const issued = issue ? await issueInvoice(tx, inv.id, today) : null;
  return { id: inv.id, studentId: row.studentId, number: issued?.number ?? null };
}

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
const CHUNK = 50;

/**
 * FR-13/FR-14, ADR-6: rebuild drafts server-side, write them in 50-student transactions (issuing in
 * the same transaction when asked). A P2002 on the D-7 partial index (a concurrent run) is a skip:
 * the chunk is retried one student per transaction so the rest still go through.
 */
export async function generateInvoices(actor: AccessUser, input: GenerateInput, opts: ClockOptions = {}) {
  const today = opts.today ?? (await feeSettings()).today;
  const rows = await buildInvoiceDrafts(input);
  const skipped = rows.filter((r) => r.skipped).map((r) => ({ studentId: r.studentId, studentName: r.studentName, reason: r.skipped! }));
  const todo = rows.filter((r) => !r.skipped);
  const created: { id: string; studentId: string; number: string | null }[] = [];

  for (let i = 0; i < todo.length; i += CHUNK) {
    const chunk = todo.slice(i, i + CHUNK);
    try {
      created.push(
        ...(await prisma.$transaction(
          async (tx) => {
            const out = [];
            for (const row of chunk) out.push(await writeDraft(tx, actor, input, row, input.issue, today));
            return out;
          },
          { timeout: 30_000 },
        )),
      );
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      for (const row of chunk) {
        try {
          created.push(await prisma.$transaction((tx) => writeDraft(tx, actor, input, row, input.issue, today)));
        } catch (e) {
          if (!isUniqueViolation(e)) throw e;
          skipped.push({ studentId: row.studentId, studentName: row.studentName, reason: 'ALREADY_INVOICED' });
        }
      }
    }
  }

  await auditAll(
    actor.id,
    created.map((c) => ({
      action: input.issue ? 'invoice.issue' : 'invoice.create',
      entityType: 'Invoice',
      entityId: c.id,
      after: { number: c.number, status: input.issue ? 'ISSUED' : 'DRAFT' },
    })),
  );
  if (input.issue) await notifyIssued(created.map((c) => c.id));
  return { created: created.length, issued: input.issue ? created.length : 0, skipped, invoiceIds: created.map((c) => c.id) };
}

/** FR-14/FR-36: fees.invoice_issued to every linked parent, after commit. */
async function notifyIssued(invoiceIds: string[]) {
  if (!invoiceIds.length) return;
  const { currency } = await feeSettings();
  const invoices = await prisma.invoice.findMany({
    where: { id: { in: invoiceIds } },
    select: { id: true, number: true, total: true, dueDate: true, studentId: true, student: nameSelect },
  });
  const parents = await parentsOf(invoices.map((i) => i.studentId));
  for (const inv of invoices) {
    await notify({
      type: 'fees.invoice_issued',
      userIds: parents.get(inv.studentId) ?? [],
      title: `New invoice ${inv.number} for ${fullName(inv.student)}`,
      body: `Total ${formatMoney(inv.total, currency)}, due ${fromDbDate(inv.dueDate)}.`,
      link: `/fees?invoice=${inv.id}`,
      email: { template: 'generic-notification' },
    });
  }
}

// ===========================================================================
// Invoice reads (FR-17 to FR-19, FR-22)
// ===========================================================================

export async function listInvoices(actor: AccessUser, query: InvoiceListQuery, page: PaginationParams) {
  const { currency } = await freshFeeSettings();
  const { sort, page: _p, pageSize: _ps, ...filters } = query;
  const where = invoiceWhere(filters, await feeStudentScope(actor));
  const [rows, total, totals] = await Promise.all([
    prisma.invoice.findMany({ where, select: invoiceRowSelect, orderBy: invoiceOrderBy(sort), skip: page.skip, take: page.take }),
    prisma.invoice.count({ where }),
    invoiceTotals(where),
  ]);
  return { rows: rows.map(serializeInvoiceRow), meta: { page: page.page, pageSize: page.pageSize, total, totals, currency } };
}

export async function getInvoice(actor: AccessUser, id: string) {
  const { currency, invoiceFooter } = await freshFeeSettings();
  await assertCanSeeInvoice(actor, id);
  const inv = await prisma.invoice.findUniqueOrThrow({
    where: { id },
    select: {
      ...invoiceRowSelect,
      subtotal: true,
      discountTotal: true,
      notes: true,
      voidedAt: true,
      voidReason: true,
      dueDays: true,
      lines: { orderBy: { sortOrder: 'asc' } },
      allocations: {
        select: { amount: true, payment: { select: { id: true, receiptNumber: true, receivedAt: true, method: true, reversedAt: true } } },
        orderBy: { createdAt: 'asc' },
      },
      reminders: { select: { kind: true, sentAt: true }, orderBy: { sentAt: 'desc' } },
    },
  });
  const [links, logs] = await Promise.all([
    prisma.parentStudentLink.findMany({
      where: { studentId: inv.studentId },
      select: { isPrimary: true, parent: nameSelect },
      orderBy: { isPrimary: 'desc' },
    }),
    // The audit timeline is internal: admins only.
    actor.role === 'ADMIN'
      ? prisma.auditLog.findMany({
          where: { entityType: 'Invoice', entityId: id },
          select: { action: true, createdAt: true, metadata: true, actor: { select: { firstName: true, lastName: true } } },
          orderBy: { createdAt: 'asc' },
        })
      : Promise.resolve([]),
  ]);
  const meta = (m: unknown) => (m && typeof m === 'object' ? (m as Record<string, unknown>) : {});
  return {
    ...serializeInvoiceRow(inv),
    academicYearId: inv.academicYearId,
    feePlanId: inv.feePlanId,
    dueDays: inv.dueDays,
    subtotal: fixed2(inv.subtotal),
    discountTotal: fixed2(inv.discountTotal),
    notes: inv.notes,
    voidedAt: inv.voidedAt?.toISOString() ?? null,
    voidReason: inv.voidReason,
    lines: inv.lines.map((l) => ({
      id: l.id,
      feeItemId: l.feeItemId,
      discountId: l.discountId,
      description: l.description,
      amount: fixed2(l.amount),
      isOptional: l.isOptional,
      isDiscount: l.isDiscount,
      isAdjustment: l.isAdjustment,
      reason: l.reason,
      sortOrder: l.sortOrder,
    })),
    allocations: inv.allocations.map((a) => ({
      paymentId: a.payment.id,
      receiptNumber: a.payment.receiptNumber,
      amount: fixed2(a.amount),
      receivedAt: a.payment.receivedAt.toISOString(),
      method: a.payment.method,
      reversed: a.payment.reversedAt !== null,
    })),
    timeline: logs.map((l) => ({
      action: l.action,
      at: l.createdAt.toISOString(),
      actorName: l.actor ? fullName(l.actor) : 'System',
      before: meta(l.metadata).before ?? null,
      after: meta(l.metadata).after ?? null,
    })),
    reminders: inv.reminders.map((r) => ({ kind: r.kind, sentAt: r.sentAt.toISOString() })),
    parents: links.map((l) => ({ id: l.parent.id, name: fullName(l.parent), isPrimary: l.isPrimary })),
    currency,
    invoiceFooter,
  };
}
export type InvoiceDetail = Awaited<ReturnType<typeof getInvoice>>;

// ===========================================================================
// Invoice writes (FR-20, FR-21, FR-23, FR-38)
// ===========================================================================

/** Manual lines + (plan invoices only) the student's discounts recomputed on the server. */
async function manualTotals(studentId: string, academicYearId: string, lines: ManualInvoiceInput['lines'], withDiscounts: boolean) {
  const itemIds = lines.flatMap((l) => (l.feeItemId ? [l.feeItemId] : []));
  if (itemIds.length) {
    const ok = await prisma.feeItem.count({ where: { id: { in: itemIds }, archivedAt: null } });
    if (ok !== new Set(itemIds).size) throw invalid('Every fee item must exist and not be archived.');
  }
  const rules = withDiscounts ? (await discountRulesFor([studentId], academicYearId)).get(studentId)?.rules ?? [] : [];
  return computeInvoiceTotals(lines.map((l) => ({ ...l, isOptional: l.isOptional ?? false })), rules);
}

/** FR-23: a one-off invoice; feePlanId null, so it never counts toward the generation skip rule. */
export async function createManualInvoice(actor: AccessUser, input: ManualInvoiceInput, opts: ClockOptions = {}) {
  const student = await prisma.user.findFirst({ where: { id: input.studentId, role: 'STUDENT' }, select: { id: true } });
  if (!student) throw new AppError('NOT_FOUND', 'Resource not found');
  if (input.termId) {
    const term = await prisma.term.findUnique({ where: { id: input.termId }, select: { academicYearId: true } });
    if (!term || term.academicYearId !== input.academicYearId) throw invalid('The term does not belong to the academic year.');
  }
  const totals = await manualTotals(input.studentId, input.academicYearId, input.lines, false);
  const today = opts.today ?? (await feeSettings()).today;
  const created = await prisma.$transaction(async (tx) => {
    const inv = await tx.invoice.create({
      data: {
        studentId: input.studentId,
        academicYearId: input.academicYearId,
        termId: input.termId,
        dueDays: input.dueDays,
        notes: input.notes ?? null,
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        total: totals.total,
        createdById: actor.id,
        lines: { createMany: { data: lineData(totals.lines) } },
      },
      select: { id: true },
    });
    const issued = input.issue ? await issueInvoice(tx, inv.id, today) : null;
    return { id: inv.id, number: issued?.number ?? null };
  });
  await auditAll(actor.id, [
    { action: 'invoice.create', entityType: 'Invoice', entityId: created.id, after: { total: totals.total, lines: totals.lines.length } },
    ...(input.issue ? [{ action: 'invoice.issue', entityType: 'Invoice', entityId: created.id, after: { number: created.number } }] : []),
  ]);
  if (input.issue) await notifyIssued([created.id]);
  return getInvoice(actor, created.id);
}

async function lockedInvoice(tx: Tx, id: string) {
  const [locked] = await lockInvoices(tx, [id]);
  if (!locked) throw new AppError('NOT_FOUND', 'Resource not found');
  return tx.invoice.findUniqueOrThrow({ where: { id } });
}

/** FR-20: DRAFT only. Replaces lines; discount lines are recomputed server-side. */
export async function updateDraft(actor: AccessUser, id: string, patch: DraftPatch) {
  const draft = await prisma.invoice.findUnique({ where: { id }, select: { studentId: true, academicYearId: true, feePlanId: true } });
  if (!draft) throw new AppError('NOT_FOUND', 'Resource not found');
  const totals = patch.lines ? await manualTotals(draft.studentId, draft.academicYearId, patch.lines, draft.feePlanId !== null) : null;
  const before = await prisma.$transaction(async (tx) => {
    const inv = await lockedInvoice(tx, id);
    if (inv.status !== 'DRAFT') throw conflict('Only draft invoices can be edited.');
    if (totals) {
      await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
      await tx.invoiceLine.createMany({ data: lineData(totals.lines).map((l) => ({ ...l, invoiceId: id })) });
    }
    await tx.invoice.update({
      where: { id },
      data: {
        ...(totals ? { subtotal: totals.subtotal, discountTotal: totals.discountTotal, total: totals.total } : {}),
        ...(patch.dueDays !== undefined ? { dueDays: patch.dueDays } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      },
    });
    return { total: fixed2(inv.total), dueDays: inv.dueDays, notes: inv.notes };
  });
  await auditAll(actor.id, [
    { action: 'invoice.update', entityType: 'Invoice', entityId: id, before, after: { total: totals?.total ?? before.total, dueDays: patch.dueDays ?? before.dueDays, notes: patch.notes ?? before.notes } },
  ]);
  return getInvoice(actor, id);
}

/** FR-20: DRAFT only; hard delete (issued invoices are voided, never deleted, NFR-2). */
export async function deleteDraft(actor: AccessUser, id: string) {
  const before = await prisma.$transaction(async (tx) => {
    const inv = await lockedInvoice(tx, id);
    if (inv.status !== 'DRAFT') throw conflict('Only draft invoices can be deleted.');
    await tx.invoice.delete({ where: { id } });
    return { studentId: inv.studentId, total: fixed2(inv.total) };
  });
  await auditAll(actor.id, [{ action: 'invoice.delete', entityType: 'Invoice', entityId: id, before }]);
  return { id, deleted: true as const };
}

export async function issue(actor: AccessUser, id: string, opts: ClockOptions = {}) {
  const today = opts.today ?? (await feeSettings()).today;
  const result = await prisma.$transaction(async (tx) => {
    await lockedInvoice(tx, id);
    return issueInvoice(tx, id, today);
  });
  await auditAll(actor.id, [{ action: 'invoice.issue', entityType: 'Invoice', entityId: id, before: { status: 'DRAFT' }, after: result }]);
  await notifyIssued([id]);
  return getInvoice(actor, id);
}

const assertOpen = (status: string, action: string) => {
  if (!isOpen(status as (typeof OPEN_STATUSES)[number])) throw conflict(`Only issued, partially paid or overdue invoices can be ${action}.`);
};

/** FR-21 / D-10: negative isAdjustment line; never below amountPaid or 0 (no credit balances). */
export async function adjustInvoice(actor: AccessUser, id: string, input: AdjustInput, opts: ClockOptions = {}) {
  const today = opts.today ?? (await feeSettings()).today;
  const change = await prisma.$transaction(async (tx) => {
    const inv = await lockedInvoice(tx, id);
    assertOpen(inv.status, 'adjusted');
    const newTotal = dec(inv.total).minus(input.amount);
    if (newTotal.lt(0) || newTotal.lt(inv.amountPaid)) {
      throw invalid('The adjustment would bring the total below the amount already paid.', { maxAdjustment: fixed2(dec(inv.total).minus(inv.amountPaid)) });
    }
    const last = await tx.invoiceLine.aggregate({ where: { invoiceId: id }, _max: { sortOrder: true } });
    await tx.invoiceLine.create({
      data: {
        invoiceId: id,
        description: input.description,
        amount: fixed2(dec(input.amount).neg()),
        isAdjustment: true,
        reason: input.reason,
        sortOrder: (last._max.sortOrder ?? 0) + 1,
      },
    });
    await tx.invoice.update({ where: { id }, data: { total: fixed2(newTotal) } });
    return recomputeInvoice(tx, id, today);
  });
  await auditAll(actor.id, [
    { action: 'invoice.adjust', entityType: 'Invoice', entityId: id, before: change.before, after: { ...change.after, total: fixed2(dec(change.before.total).minus(input.amount)) }, extra: { amount: input.amount, reason: input.reason } },
  ]);
  return getInvoice(actor, id);
}

/** FR-21 / D-11: only with no non-reversed allocations. */
export async function voidInvoice(actor: AccessUser, id: string, reason: string) {
  const before = await prisma.$transaction(async (tx) => {
    const inv = await lockedInvoice(tx, id);
    assertOpen(inv.status, 'voided');
    const live = await tx.paymentAllocation.count({ where: { invoiceId: id, payment: { reversedAt: null } } });
    if (live) throw conflict('Reverse the payments allocated to this invoice before voiding it.');
    await tx.invoice.update({ where: { id }, data: { status: 'VOID', voidedAt: new Date(), voidReason: reason } });
    return { status: inv.status };
  });
  await auditAll(actor.id, [{ action: 'invoice.void', entityType: 'Invoice', entityId: id, before, after: { status: 'VOID' }, extra: { reason } }]);
  return getInvoice(actor, id);
}

const DAY_MS = 86_400_000;

/** FR-38 / D-8: MANUAL reminder, at most one per invoice per 24 h (DB check under the invoice lock). */
export async function remindInvoice(actor: AccessUser, id: string, opts: ClockOptions = {}) {
  const now = opts.now ?? new Date();
  const { currency } = await feeSettings(now);
  await prisma.$transaction(async (tx) => {
    const inv = await lockedInvoice(tx, id);
    assertOpen(inv.status, 'reminded');
    const last = await tx.invoiceReminder.findFirst({
      where: { invoiceId: id, kind: 'MANUAL', sentAt: { gt: new Date(now.getTime() - DAY_MS) } },
      orderBy: { sentAt: 'desc' },
    });
    if (last) {
      throw new AppError('RATE_LIMITED', 'A reminder was already sent for this invoice in the last 24 hours.', {
        retryAfter: new Date(last.sentAt.getTime() + DAY_MS).toISOString(),
      });
    }
    await tx.invoiceReminder.create({ data: { invoiceId: id, kind: 'MANUAL', sentAt: now, sentById: actor.id } });
  });
  const inv = await prisma.invoice.findUniqueOrThrow({
    where: { id },
    select: { id: true, number: true, dueDate: true, total: true, amountPaid: true, studentId: true, student: nameSelect },
  });
  const recipients = await notifyReminder(inv, currency, (await parentsOf([inv.studentId])).get(inv.studentId) ?? []);
  await auditAll(actor.id, [{ action: 'invoice.remind', entityType: 'Invoice', entityId: id, after: { recipients } }]);
  return { invoiceId: id, sentAt: now.toISOString(), recipients };
}

// ===========================================================================
// Payments (FR-26 to FR-32)
// ===========================================================================

const openInvoiceSelect = {
  id: true,
  number: true,
  studentId: true,
  status: true,
  dueDate: true,
  total: true,
  amountPaid: true,
  student: nameSelect,
} satisfies Prisma.InvoiceSelect;
type OpenInvoiceRow = Prisma.InvoiceGetPayload<{ select: typeof openInvoiceSelect }>;

const toOpen = (i: OpenInvoiceRow) => ({
  id: i.id,
  number: i.number,
  studentId: i.studentId,
  studentName: fullName(i.student),
  dueDate: fromDbDate(i.dueDate),
  status: i.status,
  total: fixed2(i.total),
  amountPaid: fixed2(i.amountPaid),
  balance: fixed2(dec(i.total).minus(i.amountPaid)),
});

async function childrenOf(parentId: string) {
  const links = await prisma.parentStudentLink.findMany({
    where: { parentId },
    select: { student: nameSelect },
    orderBy: { createdAt: 'asc' },
  });
  return links.map((l) => ({ id: l.student.id, name: fullName(l.student) }));
}

const openWhere = (studentIds: string[]): Prisma.InvoiceWhereInput => ({ studentId: { in: studentIds }, status: { in: [...OPEN_STATUSES] } });
const openOrder: Prisma.InvoiceOrderByWithRelationInput[] = [{ dueDate: 'asc' }, { number: 'asc' }];

/** FR-26/FR-28: open invoices of every child of the parent, oldest due first, plus a suggestion. */
export async function getFamilyOpenInvoices(parentId: string, amount?: string) {
  const { currency } = await freshFeeSettings();
  const parent = await assertParent(parentId);
  const children = await childrenOf(parentId);
  const rows = (
    await prisma.invoice.findMany({ where: openWhere(children.map((c) => c.id)), select: openInvoiceSelect, orderBy: openOrder })
  ).map(toOpen);
  const outstanding = sumMoney(rows.map((r) => r.balance));
  const suggestion = amount ? autoAllocate(amount, rows) : null;
  return {
    parent: { id: parent.id, name: fullName(parent) },
    children,
    invoices: rows,
    outstanding: fixed2(outstanding),
    suggestedAllocations: suggestion?.allocations ?? [],
    overpayment: amount && dec(amount).gt(outstanding) ? fixed2(dec(amount).minus(outstanding)) : '0.00',
    currency,
  };
}

/**
 * FR-27 to FR-30 (ADR-4): one transaction locks the family's open invoices (sorted), refuses an
 * overpayment against the reloaded balances, validates allocations, takes an RCT number, writes the
 * payment and recomputes each invoice. Audit + notify after commit.
 */
export async function recordPayment(actor: AccessUser, input: RecordPaymentInput, opts: ClockOptions = {}) {
  const { tz, currency, today: settingsToday } = await feeSettings();
  const today = opts.today ?? settingsToday;
  await assertParent(input.payerParentId);
  const childIds = (await childrenOf(input.payerParentId)).map((c) => c.id);

  const { paymentId, changes, allocations } = await prisma.$transaction(
    async (tx) => {
      const candidates = await tx.invoice.findMany({ where: openWhere(childIds), select: { id: true } });
      await lockInvoices(tx, candidates.map((c) => c.id));
      const open = (await tx.invoice.findMany({ where: openWhere(childIds), select: openInvoiceSelect, orderBy: openOrder })).map(toOpen);
      const outstanding = sumMoney(open.map((o) => o.balance));
      if (dec(input.amount).gt(outstanding)) {
        throw invalid(`Amount exceeds the family's outstanding balance of ${formatMoney(outstanding, currency)}`, { outstanding: fixed2(outstanding) });
      }
      const allocs = input.allocations ?? autoAllocate(input.amount, open).allocations;
      const error = validateAllocations(input.amount, allocs, Object.fromEntries(open.map((o) => [o.id, o.balance])));
      if (error) throw invalid(error);

      const receiptNumber = await nextDocumentNumber(tx, 'RCT', Number(schoolDateOf(input.receivedAt, tz).slice(0, 4)));
      const payment = await tx.payment.create({
        data: {
          receiptNumber,
          amount: input.amount,
          method: input.method,
          reference: input.reference ?? null,
          receivedAt: input.receivedAt,
          payerName: input.payerName,
          payerParentId: input.payerParentId,
          notes: input.notes ?? null,
          recordedById: actor.id,
          allocations: { createMany: { data: allocs.map((a) => ({ invoiceId: a.invoiceId, amount: a.amount })) } },
        },
        select: { id: true },
      });
      const out = [];
      for (const a of allocs) out.push({ invoiceId: a.invoiceId, ...(await recomputeInvoice(tx, a.invoiceId, today)) });
      return { paymentId: payment.id, changes: out, allocations: allocs };
    },
    { timeout: 20_000 },
  );

  await auditAll(actor.id, [
    { action: 'payment.create', entityType: 'Payment', entityId: paymentId, after: { amount: input.amount, method: input.method, allocations } },
    ...changes.map((c) => ({ action: 'payment.create', entityType: 'Invoice', entityId: c.invoiceId, before: c.before, after: c.after, extra: { paymentId } })),
  ]);
  const payment = await getPayment(actor, paymentId);
  await notifyPayment(payment, changes.map((c) => c.invoiceId));
  return { payment, receiptUrl: `/fees/receipts/${paymentId}/print` };
}

/** FR-30: fees.payment_received to the union of parents linked to the allocated invoices' students. */
async function notifyPayment(payment: { id: string; receiptNumber: string; amount: string; currency: string }, invoiceIds: string[]) {
  const invoices = await prisma.invoice.findMany({ where: { id: { in: invoiceIds } }, select: { studentId: true } });
  const parents = await parentsOf(invoices.map((i) => i.studentId));
  await notify({
    type: 'fees.payment_received',
    userIds: [...parents.values()].flat(),
    title: `Payment received: receipt ${payment.receiptNumber}`,
    body: `We received ${formatMoney(payment.amount, payment.currency)}. Thank you.`,
    link: `/fees/receipts/${payment.id}/print`,
    email: { template: 'generic-notification' },
  });
}

/** FR-31: lock the payment (second reverse → 409), lock its invoices, flag it, recompute. Never deleted. */
export async function reversePayment(actor: AccessUser, id: string, reason: string, opts: ClockOptions = {}) {
  const today = opts.today ?? (await feeSettings()).today;
  const changes = await prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<{ reversedAt: Date | null }[]>`
      SELECT "reversedAt" FROM "Payment" WHERE "id" = ${id} FOR UPDATE`;
    if (!row) throw new AppError('NOT_FOUND', 'Resource not found');
    if (row.reversedAt) throw conflict('This payment has already been reversed.');
    const allocs = await tx.paymentAllocation.findMany({ where: { paymentId: id }, select: { invoiceId: true } });
    const invoiceIds = allocs.map((a) => a.invoiceId);
    await lockInvoices(tx, invoiceIds);
    await tx.payment.update({ where: { id }, data: { reversedAt: new Date(), reversedById: actor.id, reversalReason: reason } });
    const out = [];
    for (const invoiceId of [...invoiceIds].sort()) out.push({ invoiceId, ...(await recomputeInvoice(tx, invoiceId, today)) });
    return out;
  });
  await auditAll(actor.id, [
    { action: 'payment.reverse', entityType: 'Payment', entityId: id, before: { reversed: false }, after: { reversed: true }, extra: { reason } },
    ...changes.map((c) => ({ action: 'payment.reverse', entityType: 'Invoice', entityId: c.invoiceId, before: c.before, after: c.after, extra: { paymentId: id } })),
  ]);
  return getPayment(actor, id);
}

export async function listPayments(actor: AccessUser, query: PaymentListQuery, page: PaginationParams) {
  const { tz, currency } = await freshFeeSettings();
  const { sort, page: _p, pageSize: _ps, ...filters } = query;
  const scope = await feeStudentScope(actor);
  const where = paymentWhere(filters, scope, tz);
  const [rows, total] = await Promise.all([
    prisma.payment.findMany({ where, select: paymentRowSelect, orderBy: paymentOrderBy(sort), skip: page.skip, take: page.take }),
    prisma.payment.count({ where }),
  ]);
  return { rows: rows.map((r) => serializePaymentRow(r, scope)), meta: { page: page.page, pageSize: page.pageSize, total, currency } };
}

export async function getPayment(actor: AccessUser, id: string) {
  const { currency } = await feeSettings();
  await assertCanSeePayment(actor, id);
  const scope = await feeStudentScope(actor);
  const p = await prisma.payment.findUniqueOrThrow({
    where: { id },
    select: {
      ...paymentRowSelect,
      notes: true,
      reversalReason: true,
      reversedBy: { select: { firstName: true, lastName: true } },
      allocations: {
        select: { amount: true, invoice: { select: { id: true, number: true, studentId: true, student: { select: { firstName: true, lastName: true } } } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  const amount = fixed2(p.amount);
  return {
    ...serializePaymentRow(p, scope),
    notes: p.notes,
    reversalReason: p.reversalReason,
    reversedByName: p.reversedBy ? fullName(p.reversedBy) : null,
    allocations: p.allocations
      .filter((a) => scope === 'ALL' || scope.includes(a.invoice.studentId))
      .map((a) => ({ invoiceId: a.invoice.id, invoiceNumber: a.invoice.number, studentName: fullName(a.invoice.student), amount: fixed2(a.amount) })),
    amountInWords: amountInWords(amount, currency),
    currency,
  };
}
export type PaymentDetail = Awaited<ReturnType<typeof getPayment>>;

// ---------------------------------------------------------------------------
// Lookups for pages
// ---------------------------------------------------------------------------

/** Record-payment picker: every parent with their children's names (searchable by either, FR-26). */
export async function listPayerOptions() {
  const parents = await prisma.user.findMany({
    where: { role: 'PARENT', archivedAt: null, parentLinks: { some: {} } },
    select: { id: true, firstName: true, lastName: true, parentLinks: { select: { student: { select: { firstName: true, lastName: true } } } } },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });
  return parents.map((p) => ({ id: p.id, name: fullName(p), children: p.parentLinks.map((l) => fullName(l.student)) }));
}
