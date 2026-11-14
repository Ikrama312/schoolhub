import { z } from 'zod';
import { dec, fixed2 } from '@/lib/money';

/**
 * PRD-17 validation (NFR-7). Client-safe: shared by the fee route handlers and the React Hook Form
 * resolvers. Money comes in as number | string and leaves as a 2-dp string such as "2235.00"
 * (ADR-2); at most 2 dp and at most 99,999,999.99, the Decimal(10,2) ceiling.
 */

export const MONEY_MAX = '99999999.99';
export const INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID'] as const;
export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'CHEQUE', 'CARD_TERMINAL', 'OTHER'] as const;
export const DISCOUNT_KINDS = ['PERCENT', 'FIXED'] as const;
export const AUTO_RULES = ['SIBLING_2ND', 'SIBLING_3RD_PLUS'] as const;
export type InvoiceStatusValue = (typeof INVOICE_STATUSES)[number];
export type PaymentMethodValue = (typeof PAYMENT_METHODS)[number];
export type AutoRule = (typeof AUTO_RULES)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethodValue, string> = {
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank transfer',
  CHEQUE: 'Cheque',
  CARD_TERMINAL: 'Card terminal',
  OTHER: 'Other',
};

const id = z.string().min(1);
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use yyyy-MM-dd');
const queryBool = z.enum(['true', 'false']).optional().transform((v) => (v === undefined ? undefined : v === 'true'));
const reason = z.string().trim().min(3, 'Give a reason (at least 3 characters)').max(500, 'At most 500 characters');

/**
 * number | "12.5" → "12.50". One short-circuiting superRefine, like gradebook's decimal(): zod runs
 * chained refines after a failure and dec() throws on non-numeric input.
 */
const moneyOf = (label: string, positive: boolean) =>
  z
    .union([z.number(), z.string().trim().min(1, `${label} is required`)])
    .superRefine((v, ctx) => {
      const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
      if (!/^\d+(\.\d{1,2})?$/.test(String(v))) return fail(`${label} must be a number with at most 2 decimals`);
      const d = dec(v);
      if (positive && d.lte(0)) return fail(`${label} must be greater than 0`);
      if (d.gt(MONEY_MAX)) return fail(`${label} must be at most ${MONEY_MAX}`);
    })
    .transform((v) => fixed2(v));

export const money = (label = 'Amount') => moneyOf(label, false);
export const positiveMoney = (label = 'Amount') => moneyOf(label, true);

const uniqueBy = <T>(key: (item: T) => string, message: string) => (items: T[], ctx: z.RefinementCtx) => {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(key(item))) return ctx.addIssue({ code: 'custom', message });
    seen.add(key(item));
  }
};

/** `sort=<field>&order=asc|desc` (DataTable) or `sort=-<field>`; whitelisted fields only (NFR-7). */
const sortOf = <F extends string>(fields: readonly F[], fallback: { field: F; dir: 'asc' | 'desc' }) => ({
  sort: z.string().regex(new RegExp(`^-?(${fields.join('|')})$`), 'Invalid sort').optional(),
  order: z.enum(['asc', 'desc']).optional(),
  resolveSort(q: { sort?: string; order?: 'asc' | 'desc' }): { field: F; dir: 'asc' | 'desc' } {
    if (!q.sort) return fallback;
    const desc = q.sort.startsWith('-');
    return { field: (desc ? q.sort.slice(1) : q.sort) as F, dir: desc ? 'desc' : (q.order ?? 'asc') };
  },
});

const pageParams = { page: z.string().optional(), pageSize: z.string().optional() };

// ---------------------------------------------------------------------------
// Setup (FR-6 to FR-10)
// ---------------------------------------------------------------------------

export const setupListQuery = z.object({
  includeArchived: queryBool,
  optional: queryBool,
  manualOnly: queryBool,
  academicYearId: id.optional(),
  termId: id.optional(),
  gradeLevelId: id.optional(),
});
export type SetupListQuery = z.infer<typeof setupListQuery>;

export const feeItemSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  code: z
    .string()
    .trim()
    .min(1, 'Code is required')
    .max(30)
    .transform((c) => c.toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9_-]+$/, 'Use letters, digits, - and _ only')),
  description: z.string().trim().max(500).nullish(),
  defaultAmount: positiveMoney('Default amount'),
  isOptional: z.boolean().default(false),
});
export type FeeItemInput = z.infer<typeof feeItemSchema>;
export const feeItemPatchSchema = feeItemSchema.partial().extend({ isOptional: z.boolean().optional() });
export type FeeItemPatch = z.infer<typeof feeItemPatchSchema>;

export const feePlanSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  academicYearId: id,
  termId: id.nullable(),
  gradeLevelId: id,
  dueDays: z.coerce.number().int().min(0).max(365).default(30),
  lines: z
    .array(z.object({ feeItemId: id, amount: positiveMoney() }))
    .min(1, 'Add at least one line')
    .max(50)
    .superRefine(uniqueBy((l) => l.feeItemId, 'Each fee item can appear only once')),
});
export type FeePlanInput = z.infer<typeof feePlanSchema>;

const discountBase = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  kind: z.enum(DISCOUNT_KINDS),
  value: positiveMoney('Value'),
  autoRule: z.enum(AUTO_RULES).nullable().default(null),
});
const percentCap = (d: { kind?: string; value?: string }, ctx: z.RefinementCtx) => {
  if (d.kind === 'PERCENT' && d.value !== undefined && dec(d.value).gt(100)) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'A percent discount must be between 0 and 100' });
  }
};
export const discountSchema = discountBase.superRefine(percentCap);
export type DiscountInput = z.infer<typeof discountSchema>;
export const discountPatchSchema = discountBase
  .partial()
  .extend({ autoRule: z.enum(AUTO_RULES).nullable().optional() })
  .superRefine(percentCap);
export type DiscountPatch = z.infer<typeof discountPatchSchema>;

export const yearQuery = z.object({ academicYearId: id.optional() });

export const studentOptionalFeesSchema = z.object({
  academicYearId: id,
  fees: z
    .array(z.object({ feeItemId: id, amount: positiveMoney() }))
    .max(50)
    .superRefine(uniqueBy((f) => f.feeItemId, 'Each fee item can appear only once')),
});
export type StudentOptionalFeesInput = z.infer<typeof studentOptionalFeesSchema>;

export const bulkOptionalFeeSchema = z.object({
  sectionId: id,
  academicYearId: id,
  feeItemId: id,
  amount: positiveMoney(),
});
export type BulkOptionalFeeInput = z.infer<typeof bulkOptionalFeeSchema>;

export const studentDiscountsSchema = z.object({
  academicYearId: id,
  discounts: z
    .array(z.object({ discountId: id, note: z.string().trim().max(500).nullish() }))
    .max(20)
    .superRefine(uniqueBy((d) => d.discountId, 'Each discount can appear only once')),
});
export type StudentDiscountsInput = z.infer<typeof studentDiscountsSchema>;

// ---------------------------------------------------------------------------
// Invoices (FR-12 to FR-23, FR-38)
// ---------------------------------------------------------------------------

export const previewSchema = z.object({
  academicYearId: id,
  termId: id.nullable(),
  gradeLevelIds: z.array(id).min(1, 'Choose at least one grade').max(20),
});
export type PreviewInput = z.infer<typeof previewSchema>;
export const generateSchema = previewSchema.extend({ issue: z.boolean().default(false) });
export type GenerateInput = z.infer<typeof generateSchema>;

export const INVOICE_SORT_FIELDS = ['dueDate', 'issueDate', 'number', 'total', 'studentName'] as const;
const invoiceSort = sortOf(INVOICE_SORT_FIELDS, { field: 'issueDate', dir: 'desc' });
const invoiceFilters = {
  status: z.enum(INVOICE_STATUSES).optional(),
  termId: id.optional(),
  academicYearId: id.optional(),
  gradeLevelId: id.optional(),
  sectionId: id.optional(),
  studentId: id.optional(),
  overdue: queryBool,
  q: z.string().trim().max(100).optional(),
  sort: invoiceSort.sort,
  order: invoiceSort.order,
};
export const invoiceListQuery = z
  .object({ ...invoiceFilters, ...pageParams })
  .transform(({ sort, order, ...rest }) => ({ ...rest, sort: invoiceSort.resolveSort({ sort, order }) }));
export type InvoiceListQuery = z.infer<typeof invoiceListQuery>;
export type InvoiceFilters = Omit<InvoiceListQuery, 'page' | 'pageSize' | 'sort'>;

const invoiceLine = z.object({
  description: z.string().trim().min(1, 'Description is required').max(200),
  amount: positiveMoney(),
  feeItemId: id.nullish(),
  isOptional: z.boolean().optional(),
});
export type InvoiceLineInput = z.infer<typeof invoiceLine>;

export const manualInvoiceSchema = z.object({
  studentId: id,
  academicYearId: id,
  termId: id.nullable().default(null),
  lines: z.array(invoiceLine).min(1, 'Add at least one line').max(50),
  dueDays: z.coerce.number().int().min(0).max(365).default(30),
  notes: z.string().trim().max(1000).nullish(),
  issue: z.boolean().default(false),
});
export type ManualInvoiceInput = z.infer<typeof manualInvoiceSchema>;

export const draftPatchSchema = z.object({
  lines: z.array(invoiceLine).min(1, 'Add at least one line').max(50).optional(),
  dueDays: z.coerce.number().int().min(0).max(365).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});
export type DraftPatch = z.infer<typeof draftPatchSchema>;

export const reasonSchema = z.object({ reason });
export const adjustSchema = z.object({
  amount: positiveMoney(),
  reason,
  description: z.string().trim().min(1).max(200).default('Adjustment'),
});
export type AdjustInput = z.infer<typeof adjustSchema>;

// ---------------------------------------------------------------------------
// Payments (FR-26 to FR-32)
// ---------------------------------------------------------------------------

export const openInvoicesQuery = z.object({ amount: positiveMoney().optional() });

export const PAYMENT_SORT_FIELDS = ['receivedAt', 'amount', 'receiptNumber'] as const;
const paymentSort = sortOf(PAYMENT_SORT_FIELDS, { field: 'receivedAt', dir: 'desc' });
const paymentFilterShape = {
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  reversed: queryBool,
  parentId: id.optional(),
  studentId: id.optional(),
  q: z.string().trim().max(100).optional(),
};
const rangeOk = (q: { from?: string; to?: string }) => !q.from || !q.to || q.to >= q.from;
export const paymentListQuery = z
  .object({ ...paymentFilterShape, ...pageParams, sort: paymentSort.sort, order: paymentSort.order })
  .refine(rangeOk, { message: '`to` must be on or after `from`', path: ['to'] })
  .transform(({ sort, order, ...rest }) => ({ ...rest, sort: paymentSort.resolveSort({ sort, order }) }));
export type PaymentListQuery = z.infer<typeof paymentListQuery>;
export type PaymentFilters = Omit<PaymentListQuery, 'page' | 'pageSize' | 'sort'>;
export const paymentExportQuery = z.object(paymentFilterShape).refine(rangeOk, {
  message: '`to` must be on or after `from`',
  path: ['to'],
});

export const recordPaymentSchema = z.object({
  payerParentId: id,
  amount: positiveMoney(),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(100).nullish(),
  receivedAt: z.coerce
    .date({ invalid_type_error: 'Enter a valid date and time' })
    .refine((d) => d.getTime() <= Date.now() + 5 * 60_000, 'Received date cannot be in the future'),
  payerName: z.string().trim().min(1, 'Payer name is required').max(200),
  notes: z.string().trim().max(1000).nullish(),
  allocations: z
    .array(z.object({ invoiceId: id, amount: positiveMoney() }))
    .max(100)
    .superRefine(uniqueBy((a) => a.invoiceId, 'Each invoice can appear only once'))
    .optional(),
});
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

// ---------------------------------------------------------------------------
// Reports (FR-42)
// ---------------------------------------------------------------------------

export const dashboardQuery = z.object({ termId: id.optional() });
