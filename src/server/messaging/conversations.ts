import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import { DELETED_TEXT } from '@/lib/messaging/constants';
import type { CreateConversationInput } from '@/lib/validators/messaging';
import { canSendIn, validateNewConversation, type Party } from './contact-rules';
import { getParticipation } from './access';
import { conversationLink } from './notifications';
import { afterSend, assertRateLimit, insertMessage, toMessageDTO, toUserSummary, userSummarySelect } from './messages';

/** PRD-13 conversation service (FR-6, FR-9, FR-12, FR-14, FR-18, FR-30, FR-31, NFR-2). */

const PREVIEW_MAX = 80;

export async function listConversations(
  user: Party,
  opts: { archived?: boolean; q?: string; skip: number; take: number },
) {
  const where: Prisma.ConversationWhereInput = {
    participants: { some: { userId: user.id, leftAt: null, archivedAt: opts.archived ? { not: null } : null } },
  };
  if (opts.q) {
    const contains = { contains: opts.q, mode: 'insensitive' as const };
    where.OR = [
      { subject: contains },
      { participants: { some: { userId: { not: user.id }, user: { OR: [{ firstName: contains }, { lastName: contains }] } } } },
    ];
  }
  const [total, rows] = await Promise.all([
    prisma.conversation.count({ where }),
    prisma.conversation.findMany({
      where,
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      skip: opts.skip,
      take: opts.take,
      include: {
        participants: { select: { userId: true, leftAt: true, mutedAt: true, archivedAt: true, user: { select: userSummarySelect } } },
        messages: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: { body: true, deletedAt: true, sender: { select: { firstName: true } } } },
      },
    }),
  ]);

  const unread = new Map<string, number>();
  if (rows.length) {
    // One LATERAL COUNT over the page, capped at 99 per row (NFR-2).
    const counts = await prisma.$queryRaw<{ id: string; unread: number }[]>`
      SELECT p."conversationId" AS id, c.cnt::int AS unread
      FROM "ConversationParticipant" p
      CROSS JOIN LATERAL (
        SELECT COUNT(*) AS cnt FROM (
          SELECT 1 FROM "Message" m
          WHERE m."conversationId" = p."conversationId" AND m."senderId" <> p."userId" AND m."deletedAt" IS NULL
            AND m."createdAt" > COALESCE(p."lastReadAt", 'epoch'::timestamp)
          LIMIT 99
        ) x
      ) c
      WHERE p."userId" = ${user.id} AND p."conversationId" IN (${Prisma.join(rows.map((r) => r.id))})`;
    for (const c of counts) unread.set(c.id, c.unread);
  }

  const data = rows.map((c) => {
    const me = c.participants.find((p) => p.userId === user.id)!;
    const last = c.messages[0];
    const preview = !last
      ? null
      : last.deletedAt
        ? DELETED_TEXT
        : `${last.sender.firstName}: ${last.body.length > PREVIEW_MAX ? `${last.body.slice(0, PREVIEW_MAX - 1)}…` : last.body}`;
    return {
      id: c.id,
      subject: c.subject,
      participants: c.participants.filter((p) => p.userId !== user.id && !p.leftAt).map((p) => toUserSummary(p.user)),
      preview,
      lastMessageAt: c.lastMessageAt.toISOString(),
      unreadCount: unread.get(c.id) ?? 0,
      muted: me.mutedAt !== null,
      archived: me.archivedAt !== null,
    };
  });
  return { data, total };
}

export async function getConversation(user: Party, conversationId: string) {
  const me = await getParticipation(user.id, conversationId);
  const c = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    include: { participants: { orderBy: { createdAt: 'asc' }, select: { userId: true, leftAt: true, user: { select: userSummarySelect } } } },
  });
  const active = c.participants.filter((p) => !p.leftAt);
  const others = active.filter((p) => p.userId !== user.id).map((p) => p.userId);
  return {
    id: c.id,
    subject: c.subject,
    createdById: c.createdById,
    involvesStudent: c.involvesStudent,
    lastMessageAt: c.lastMessageAt.toISOString(),
    participants: c.participants.map((p) => ({ ...toUserSummary(p.user), leftAt: p.leftAt?.toISOString() ?? null })),
    me: { lastReadAt: me.lastReadAt?.toISOString() ?? null, muted: me.mutedAt !== null, archived: me.archivedAt !== null },
    canSend: await canSendIn(user, others),
    canLeave: active.length > 2 && !(c.createdById === user.id && c.involvesStudent),
  };
}
export type ConversationDetail = Awaited<ReturnType<typeof getConversation>>;

/** FR-6/FR-12/FR-30: contact rules first (403, nothing written), then one transaction with the first message. */
export async function createConversation(user: Party, input: CreateConversationInput) {
  assertRateLimit(user.id);
  const { participantIds, involvesStudent } = await validateNewConversation(user, input.participantIds);
  const message = await prisma.$transaction(async (tx) => {
    const c = await tx.conversation.create({
      data: {
        subject: input.subject ?? null,
        createdById: user.id,
        involvesStudent,
        participants: { create: [user.id, ...participantIds].map((userId) => ({ userId })) },
      },
    });
    return insertMessage(tx, user.id, c.id, { body: input.body, fileIds: input.fileIds });
  });
  await afterSend(message);
  return { conversation: await getConversation(user, message.conversationId), message: toMessageDTO(message, user.id) };
}

/** FR-14: lastReadAt = now; also clears the unread message.received notification and the pending email. */
export async function markRead(user: Party, conversationId: string) {
  await getParticipation(user.id, conversationId);
  const now = new Date();
  await prisma.$transaction([
    prisma.conversationParticipant.update({ where: { conversationId_userId: { conversationId, userId: user.id } }, data: { lastReadAt: now } }),
    prisma.notification.updateMany({
      where: { userId: user.id, type: 'message.received', readAt: null, link: conversationLink(conversationId) },
      data: { readAt: now },
    }),
    prisma.pendingMessageEmail.deleteMany({ where: { userId: user.id, conversationId } }),
  ]);
  return { lastReadAt: now.toISOString() };
}

export async function setMuted(user: Party, conversationId: string, muted: boolean) {
  await getParticipation(user.id, conversationId);
  await prisma.conversationParticipant.update({
    where: { conversationId_userId: { conversationId, userId: user.id } },
    data: { mutedAt: muted ? new Date() : null },
  });
  return { muted };
}

export async function setArchived(user: Party, conversationId: string, archived: boolean) {
  await getParticipation(user.id, conversationId);
  await prisma.conversationParticipant.update({
    where: { conversationId_userId: { conversationId, userId: user.id } },
    data: { archivedAt: archived ? new Date() : null },
  });
  return { archived };
}

/** FR-14/A10: not from 1:1s (archive covers those), and never the creator of a student group. */
export async function leave(user: Party, conversationId: string) {
  await getParticipation(user.id, conversationId);
  const c = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    select: { createdById: true, involvesStudent: true, _count: { select: { participants: { where: { leftAt: null } } } } },
  });
  if (c._count.participants <= 2) throw new AppError('FORBIDDEN', 'You cannot leave a one-to-one conversation. Archive it instead.', { reason: 'ONE_TO_ONE' });
  if (c.createdById === user.id && c.involvesStudent) {
    throw new AppError('FORBIDDEN', 'The creator of a group with students cannot leave it.', { reason: 'CREATOR_OF_STUDENT_GROUP' });
  }
  await prisma.$transaction([
    prisma.conversationParticipant.update({ where: { conversationId_userId: { conversationId, userId: user.id } }, data: { leftAt: new Date() } }),
    prisma.pendingMessageEmail.deleteMany({ where: { userId: user.id, conversationId } }),
  ]);
  return { left: true as const };
}

/** FR-18: conversations not left with activity after lastReadAt. One raw COUNT (NFR-2). */
export async function unreadCount(userId: string): Promise<number> {
  const [row] = await prisma.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM "ConversationParticipant" p
    JOIN "Conversation" c ON c.id = p."conversationId"
    WHERE p."userId" = ${userId} AND p."leftAt" IS NULL
      AND c."lastMessageAt" > COALESCE(p."lastReadAt", 'epoch'::timestamp)`;
  return row?.count ?? 0;
}
