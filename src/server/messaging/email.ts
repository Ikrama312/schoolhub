import { prisma } from '@/server/db';
import { notify } from '@/server/notifications/notify';
import { getSchoolTimezone } from '@/server/assignments/assignments-service';
import { quietHoursEnd } from './quiet-hours';
import { conversationLink } from './notifications';

/** PRD-13 deferred message email (FR-4, FR-20). Run by POST /api/internal/email/dispatch. */

const BATCH = 200;

export async function processPendingMessageEmails(now: Date = new Date()): Promise<{ sent: number; deferred: number; dropped: number }> {
  const summary = { sent: 0, deferred: 0, dropped: 0 };
  const rows = await prisma.pendingMessageEmail.findMany({ where: { dueAt: { lte: now } }, orderBy: { dueAt: 'asc' }, take: BATCH });
  if (!rows.length) return summary;
  const tz = await getSchoolTimezone();

  for (const row of rows) {
    // Claim by delete: a concurrent run that loses the race skips the row.
    const claimed = await prisma.pendingMessageEmail.deleteMany({ where: { id: row.id } });
    if (claimed.count !== 1) continue;

    const [participant, settings, conversation] = await Promise.all([
      prisma.conversationParticipant.findUnique({ where: { conversationId_userId: { conversationId: row.conversationId, userId: row.userId } } }),
      prisma.messagingSettings.findUnique({ where: { userId: row.userId }, select: { quietStart: true, quietEnd: true } }),
      prisma.conversation.findUnique({ where: { id: row.conversationId }, select: { subject: true } }),
    ]);
    if (!participant || !conversation || participant.leftAt || participant.mutedAt || (participant.lastReadAt && participant.lastReadAt >= row.createdAt)) {
      summary.dropped++;
      continue;
    }

    const quietEnd = quietHoursEnd(now, tz, settings);
    if (quietEnd) {
      await prisma.pendingMessageEmail.upsert({
        where: { userId_conversationId: { userId: row.userId, conversationId: row.conversationId } },
        create: { userId: row.userId, conversationId: row.conversationId, dueAt: quietEnd, createdAt: row.createdAt },
        update: {},
      });
      summary.deferred++;
      continue;
    }

    await notify({
      type: 'message.received',
      userIds: [row.userId],
      title: conversation.subject ? `Unread messages: ${conversation.subject}` : 'You have unread messages',
      body: 'You have unread direct messages in SchoolHub. Open the conversation to read them.',
      link: conversationLink(row.conversationId),
      inApp: false,
      email: { template: 'generic-notification' },
    });
    summary.sent++;
  }
  return summary;
}
