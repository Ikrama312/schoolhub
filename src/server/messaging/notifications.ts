import { prisma } from '@/server/db';
import { logger } from '@/lib/logger';
import { notify } from '@/server/notifications/notify';
import { EMAIL_DELAY_MS } from '@/lib/messaging/constants';

/** PRD-13 notification side effects (FR-19, FR-20, FR-26). Never throw: call after the transaction commits. */

/** The one link builder for a conversation; markRead matches notifications on it. */
export const conversationLink = (conversationId: string) => `/messages/${conversationId}`;

const PREVIEW_MAX = 140;

/**
 * FR-19/FR-20: for each other participant who has not muted or left — replace their unread
 * message.received row for this conversation with one fresh in-app notification, and start the
 * 10-minute email clock (create-only: the first unread message sets dueAt).
 */
export async function onMessageSent(
  conversationId: string,
  message: { senderId: string; senderName: string; body: string },
  now: Date = new Date(),
): Promise<void> {
  try {
    const recipients = await prisma.conversationParticipant.findMany({
      where: { conversationId, userId: { not: message.senderId }, leftAt: null, mutedAt: null },
      select: { userId: true },
    });
    const userIds = recipients.map((r) => r.userId);
    if (!userIds.length) return;
    const link = conversationLink(conversationId);
    await prisma.notification.deleteMany({ where: { userId: { in: userIds }, type: 'message.received', readAt: null, link } });
    const preview = message.body.length > PREVIEW_MAX ? `${message.body.slice(0, PREVIEW_MAX - 1)}…` : message.body;
    await notify({ type: 'message.received', userIds, title: `New message from ${message.senderName}`, body: preview, link });
    await prisma.pendingMessageEmail.createMany({
      data: userIds.map((userId) => ({ userId, conversationId, dueAt: new Date(now.getTime() + EMAIL_DELAY_MS) })),
      skipDuplicates: true,
    });
  } catch (error) {
    logger.error('onMessageSent failed', { conversationId, message: error instanceof Error ? error.message : String(error) });
  }
}

/** FR-26: notify every ACTIVE safeguarding lead (mandatory in-app + email). Never includes the message text. */
export async function onMessageReported(reportId: string): Promise<void> {
  try {
    const leads = await prisma.user.findMany({
      where: { role: 'ADMIN', isSafeguardingLead: true, status: 'ACTIVE', archivedAt: null },
      select: { id: true },
    });
    await notify({
      type: 'message.reported',
      userIds: leads.map((l) => l.id),
      title: 'A message was reported',
      body: 'A message has been reported for safeguarding review.',
      link: `/admin/safeguarding?report=${reportId}`,
      email: { template: 'generic-notification' },
    });
  } catch (error) {
    logger.error('onMessageReported failed', { reportId, message: error instanceof Error ? error.message : String(error) });
  }
}
