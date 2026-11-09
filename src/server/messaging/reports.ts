import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import type { Party } from './contact-rules';
import { getParticipation } from './access';
import { onMessageReported } from './notifications';

/** PRD-13 FR-22/FR-26, A12: a participant reports someone else's message; one OPEN report per (message, reporter). */
export async function reportMessage(user: Party, messageId: string, reason: string) {
  const m = await prisma.message.findUnique({ where: { id: messageId }, select: { conversationId: true, senderId: true } });
  if (!m) throw new AppError('NOT_FOUND', 'Message not found');
  await getParticipation(user.id, m.conversationId);
  if (m.senderId === user.id) throw new AppError('FORBIDDEN', 'You cannot report your own message.');
  const existing = await prisma.messageReport.findFirst({ where: { messageId, reporterId: user.id, status: 'OPEN' }, select: { id: true } });
  if (existing) throw new AppError('CONFLICT', 'You have already reported this message.');
  const report = await prisma.messageReport.create({ data: { messageId, reporterId: user.id, reason }, select: { id: true, status: true } });
  await onMessageReported(report.id);
  return { reportId: report.id, status: report.status };
}
