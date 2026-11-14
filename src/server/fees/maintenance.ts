// PRD-17 maintenance (FR-25, FR-37, ADR-7). Called from the internal dispatch route; markOverdue is
// also the first call of every fee read so statuses are never stale.
import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { logger } from '@/lib/logger';
import { addDateDays } from '@/lib/dates';
import { notify } from '@/server/notifications/notify';
import { dec, fixed2, formatMoney } from '@/lib/money';
import { reminderSlot } from './fee-math';
import { feeSettings, fromDbDate, toDbDate } from './ledger';

/** FR-25: one indexed updateMany; idempotent. Same rule as deriveStatus for unpaid past-due invoices. */
export async function markOverdue(today: string): Promise<{ updated: number }> {
  const r = await prisma.invoice.updateMany({
    where: { status: { in: ['ISSUED', 'PARTIALLY_PAID'] }, dueDate: { lt: toDbDate(today) } },
    data: { status: 'OVERDUE' },
  });
  return { updated: r.count };
}

/** studentId → linked parent ids, primary first (FR-37, §2.4). */
export async function parentsOf(studentIds: readonly string[]): Promise<Map<string, string[]>> {
  const links = await prisma.parentStudentLink.findMany({
    where: { studentId: { in: [...new Set(studentIds)] } },
    select: { studentId: true, parentId: true, isPrimary: true },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  });
  const map = new Map<string, string[]>();
  for (const l of links) map.set(l.studentId, [...(map.get(l.studentId) ?? []), l.parentId]);
  return map;
}

const fullName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`;

/** fees.overdue_reminder for one invoice to every linked parent. Returns the recipient count. */
export async function notifyReminder(
  invoice: { id: string; number: string | null; dueDate: Date | null; total: Prisma.Decimal; amountPaid: Prisma.Decimal; studentId: string; student: { firstName: string; lastName: string } },
  currency: string,
  parentIds: string[],
): Promise<number> {
  const balance = formatMoney(fixed2(dec(invoice.total).minus(invoice.amountPaid)), currency);
  await notify({
    type: 'fees.overdue_reminder',
    userIds: parentIds,
    title: `Fee reminder: invoice ${invoice.number} for ${fullName(invoice.student)}`,
    body: `Balance ${balance}, due ${fromDbDate(invoice.dueDate)}.`,
    link: `/fees?invoice=${invoice.id}`,
    email: { template: 'generic-notification' },
  });
  return parentIds.length;
}

/**
 * FR-37: for each open invoice whose reminderSlot is due, insert an InvoiceReminder (the unique
 * index on (invoiceId, kind, scheduledFor) makes a P2002 mean "already sent") and then notify.
 * At most once: if notify fails after the insert, it is logged and not retried.
 */
export async function sendInvoiceReminders(now: Date): Promise<{ sent: number; skipped: number }> {
  const { today, currency } = await feeSettings(now);
  // ponytail: scans every open invoice due within 3 days or overdue; fine at school scale.
  const invoices = await prisma.invoice.findMany({
    where: { status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] }, dueDate: { lte: toDbDate(addDateDays(today, 3)) } },
    select: {
      id: true, number: true, dueDate: true, total: true, amountPaid: true, studentId: true,
      student: { select: { firstName: true, lastName: true } },
    },
  });
  const parents = await parentsOf(invoices.map((i) => i.studentId));
  let sent = 0;
  let skipped = 0;
  for (const inv of invoices) {
    const slot = reminderSlot(fromDbDate(inv.dueDate), today);
    if (!slot) continue;
    try {
      await prisma.invoiceReminder.create({
        data: { invoiceId: inv.id, kind: slot.kind, scheduledFor: toDbDate(slot.scheduledFor), sentAt: now },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        skipped++;
        continue;
      }
      throw error;
    }
    try {
      await notifyReminder(inv, currency, parents.get(inv.studentId) ?? []);
      sent++;
    } catch (error) {
      logger.error('Fee reminder notify failed', { invoiceId: inv.id, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { sent, skipped };
}
