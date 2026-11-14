// PRD-17 ledger (ADR-3, ADR-4, NFR-1, NFR-3): the only code that allocates document numbers, takes
// invoice row locks and writes Invoice.amountPaid / post-issue status. Everything here runs inside
// the caller's interactive transaction.
import type { InvoiceStatus, Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import { addDateDays, schoolDateOf } from '@/lib/dates';
import { fixed2 } from '@/lib/money';
import { deriveStatus } from './fee-math';

export type Tx = Prisma.TransactionClient;

/** @db.Date columns are written at UTC midnight so the stored day is the school day (ADR-13). */
export const toDbDate = (d: string) => new Date(`${d}T00:00:00Z`);
export const fromDbDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export interface FeeSettings {
  tz: string;
  currency: string;
  invoiceFooter: string | null;
  today: string;
}

/** School timezone, currency, footer and "today" in the school tz (NFR-8). */
export async function feeSettings(now: Date = new Date()): Promise<FeeSettings> {
  const s = await prisma.schoolSettings.findUnique({
    where: { id: 'singleton' },
    select: { timezone: true, currency: true, invoiceFooter: true },
  });
  const tz = s?.timezone ?? 'UTC';
  return { tz, currency: s?.currency ?? 'USD', invoiceFooter: s?.invoiceFooter ?? null, today: schoolDateOf(now, tz) };
}

/**
 * ADR-3: next gap-free number for (kind, year), e.g. INV-2026-000001. One upsert takes the
 * DocumentSequence row lock until the transaction ends (same effect as INSERT … ON CONFLICT DO
 * NOTHING + SELECT … FOR UPDATE + UPDATE, in one round trip). A rollback also rolls back the
 * increment, so no gaps.
 */
export async function nextDocumentNumber(tx: Tx, kind: 'INV' | 'RCT', year: number): Promise<string> {
  const [row] = await tx.$queryRaw<{ n: number }[]>`
    INSERT INTO "DocumentSequence" ("kind", "year", "nextValue") VALUES (${kind}, ${year}, 2)
    ON CONFLICT ("kind", "year") DO UPDATE SET "nextValue" = "DocumentSequence"."nextValue" + 1
    RETURNING ("nextValue" - 1)::int AS n`;
  return `${kind}-${year}-${String(row.n).padStart(6, '0')}`;
}

/** ADR-4: lock invoice rows in id order (deadlock-free). Returns the ids that exist. */
export async function lockInvoices(tx: Tx, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const sorted = [...new Set(ids)].sort();
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Invoice" WHERE "id" = ANY(${sorted}::text[]) ORDER BY "id" FOR UPDATE`;
  return rows.map((r) => r.id);
}

export interface InvoiceSnapshot {
  status: InvoiceStatus;
  amountPaid: string;
  total: string;
}

/**
 * ADR-4 / FR-24: amountPaid = Σ allocations of non-reversed payments; status from deriveStatus.
 * The single writer of amountPaid. Returns before/after for the caller's audit (D-13).
 */
export async function recomputeInvoice(tx: Tx, id: string, today: string): Promise<{ before: InvoiceSnapshot; after: InvoiceSnapshot }> {
  const inv = await tx.invoice.findUniqueOrThrow({
    where: { id },
    select: { status: true, total: true, amountPaid: true, dueDate: true },
  });
  const agg = await tx.paymentAllocation.aggregate({
    where: { invoiceId: id, payment: { reversedAt: null } },
    _sum: { amount: true },
  });
  const amountPaid = fixed2(agg._sum.amount ?? 0);
  const status = deriveStatus(
    { status: inv.status, total: inv.total, amountPaid, dueDate: fromDbDate(inv.dueDate) },
    today,
  ) as InvoiceStatus;
  const before = { status: inv.status, amountPaid: fixed2(inv.amountPaid), total: fixed2(inv.total) };
  const after = { status, amountPaid, total: before.total };
  if (before.status !== status || before.amountPaid !== amountPaid) {
    await tx.invoice.update({ where: { id }, data: { status, amountPaid } });
  }
  return { before, after };
}

/**
 * FR-14 / FR-16: DRAFT → issued. Number under the INV row lock (year of the school-tz issue date),
 * issueDate = today, dueDate = today + dueDays, then recompute (a 0-total invoice becomes PAID).
 * The caller holds the invoice lock (or just created the row in this transaction).
 */
export async function issueInvoice(tx: Tx, id: string, today: string) {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id }, select: { status: true, dueDays: true } });
  if (inv.status !== 'DRAFT') throw new AppError('CONFLICT', 'Only draft invoices can be issued.');
  const number = await nextDocumentNumber(tx, 'INV', Number(today.slice(0, 4)));
  await tx.invoice.update({
    where: { id },
    data: { number, status: 'ISSUED', issueDate: toDbDate(today), dueDate: toDbDate(addDateDays(today, inv.dueDays)) },
  });
  const { after } = await recomputeInvoice(tx, id, today);
  return { number, status: after.status };
}
