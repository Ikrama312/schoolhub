import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import type { EmailLogQuery } from '@/lib/validators/notifications';

/** Never selects html/text (FR-39). */
const SELECT = {
  id: true,
  toEmail: true,
  toName: true,
  subject: true,
  status: true,
  attempts: true,
  lastError: true,
  nextAttemptAt: true,
  sentAt: true,
  createdAt: true,
} as const;

export async function listEmailLog(query: EmailLogQuery, page: { skip: number; take: number }) {
  const where = query.status ? { status: query.status } : {};
  const [rows, total] = await Promise.all([
    prisma.emailOutbox.findMany({ where, orderBy: { createdAt: 'desc' }, select: SELECT, ...page }),
    prisma.emailOutbox.count({ where }),
  ]);
  return { rows, total };
}

/** FR-32: only FAILED rows reset; 0 rows → NOT_FOUND (double click is harmless). */
export async function retryEmail(id: string): Promise<{ id: string; status: 'PENDING' }> {
  const { count } = await prisma.emailOutbox.updateMany({
    where: { id, status: 'FAILED' },
    data: { attempts: 0, status: 'PENDING', nextAttemptAt: new Date(), lastError: null },
  });
  if (count === 0) throw new AppError('NOT_FOUND', 'Failed email not found');
  return { id, status: 'PENDING' };
}
