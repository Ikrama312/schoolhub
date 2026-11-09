import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import { rateLimit } from '@/server/rate-limit';
import { EDIT_WINDOW_MS, RATE_LIMIT } from '@/lib/messaging/constants';
import type { ListMessagesQuery, SendMessageInput } from '@/lib/validators/messaging';
import type { Party } from './contact-rules';
import { canSendIn } from './contact-rules';
import { getParticipation } from './access';
import { onMessageSent } from './notifications';

/**
 * PRD-13 message service (FR-3, FR-7, FR-10, FR-11, FR-13, FR-15, FR-27, FR-31, NFR-2..4).
 * Messages are never hard-deleted (NFR-3); normal users see deleted ones redacted.
 */

type Tx = Prisma.TransactionClient;

export const userSummarySelect = { id: true, firstName: true, lastName: true, role: true } as const;
type UserRow = { id: string; firstName: string; lastName: string; role: Party['role'] };

export const toUserSummary = (u: UserRow) => ({ id: u.id, name: `${u.firstName} ${u.lastName}`, role: u.role, avatarUrl: null as string | null });
export type UserSummary = ReturnType<typeof toUserSummary>;

export const messageInclude = {
  sender: { select: userSummarySelect },
  attachments: { select: { file: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true } } } },
} as const;
export type MessageRow = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

export const toAttachment = (f: MessageRow['attachments'][number]['file']) => ({
  fileId: f.id,
  name: f.originalName,
  mimeType: f.mimeType,
  size: f.sizeBytes,
  url: `/api/files/${f.id}`,
});

export function toMessageDTO(m: MessageRow, viewerId: string, now: Date = new Date()) {
  const deleted = m.deletedAt !== null;
  const isOwn = m.senderId === viewerId;
  return {
    id: m.id,
    conversationId: m.conversationId,
    sender: toUserSummary(m.sender),
    body: deleted ? null : m.body,
    deleted,
    editedAt: m.editedAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
    attachments: deleted ? [] : m.attachments.map((a) => toAttachment(a.file)),
    isOwn,
    canEdit: isOwn && !deleted && now.getTime() - m.createdAt.getTime() <= EDIT_WINDOW_MS,
  };
}
export type MessageDTO = ReturnType<typeof toMessageDTO>;

/** NFR-4: 30 messages (sends + creates) per minute per user. */
export function assertRateLimit(userId: string): void {
  const r = rateLimit(`msg:${userId}`, RATE_LIMIT.limit, RATE_LIMIT.windowMs);
  if (!r.ok) throw new AppError('RATE_LIMITED', 'You are sending messages too quickly.', { retryAfterMs: r.retryAfterMs });
}

const POLL_TAKE = 100;

/** Keyset pagination on (createdAt, id). `after` (+`since`) is the 5 s poll; `before` loads older pages. */
export async function listMessages(user: Party, conversationId: string, q: ListMessagesQuery) {
  await getParticipation(user.id, conversationId);
  const now = new Date();
  const dto = (rows: MessageRow[]) => rows.map((m) => toMessageDTO(m, user.id, now));
  const cursorId = q.after ?? q.before;
  const cursor = cursorId
    ? await prisma.message.findFirst({ where: { id: cursorId, conversationId }, select: { id: true, createdAt: true } })
    : null;
  if (cursorId && !cursor) throw new AppError('NOT_FOUND', 'Message not found');

  if (q.after && cursor) {
    const newer = { OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] };
    const [messages, changed] = await Promise.all([
      prisma.message.findMany({ where: { conversationId, ...newer }, include: messageInclude, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: POLL_TAKE }),
      q.since
        ? prisma.message.findMany({
            where: { conversationId, updatedAt: { gt: new Date(q.since) }, NOT: newer },
            include: messageInclude,
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: POLL_TAKE,
          })
        : Promise.resolve([]),
    ]);
    return { messages: dto(messages), changed: dto(changed), hasMore: false };
  }

  const older = cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {};
  const rows = await prisma.message.findMany({
    where: { conversationId, ...older },
    include: messageInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
  });
  const hasMore = rows.length > q.limit;
  return { messages: dto(rows.slice(0, q.limit).reverse()), changed: [], hasMore };
}

/**
 * The send transaction body, shared with createConversation (FR-11, FR-27, FR-31, A11):
 * insert, link attachments (owned by the sender, unattached, context 'message'), bump
 * lastMessageAt, mark the sender read and unarchive for everyone else.
 */
export async function insertMessage(tx: Tx, senderId: string, conversationId: string, input: SendMessageInput): Promise<MessageRow> {
  const fileIds = [...new Set(input.fileIds ?? [])];
  if (fileIds.length) {
    const ok = await tx.fileObject.count({ where: { id: { in: fileIds }, ownerId: senderId, contextId: null, context: 'message' } });
    if (ok !== fileIds.length) throw new AppError('VALIDATION_ERROR', 'One or more files cannot be attached.', { fileIds });
  }
  const created = await tx.message.create({ data: { conversationId, senderId, body: input.body } });
  if (fileIds.length) {
    await tx.fileObject.updateMany({ where: { id: { in: fileIds } }, data: { contextId: created.id } });
    await tx.messageAttachment.createMany({ data: fileIds.map((fileId) => ({ messageId: created.id, fileId })) });
  }
  await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: created.createdAt } });
  await tx.conversationParticipant.update({
    where: { conversationId_userId: { conversationId, userId: senderId } },
    data: { lastReadAt: created.createdAt },
  });
  await tx.conversationParticipant.updateMany({
    where: { conversationId, userId: { not: senderId }, archivedAt: { not: null } },
    data: { archivedAt: null },
  });
  return tx.message.findUniqueOrThrow({ where: { id: created.id }, include: messageInclude });
}

export const afterSend = (m: MessageRow) =>
  onMessageSent(m.conversationId, { senderId: m.senderId, senderName: `${m.sender.firstName} ${m.sender.lastName}`, body: m.body });

/** FR-7/FR-11: rate limit → participation (404) → canSendIn (403 RELATIONSHIP_ENDED) → transaction → after-commit notify. */
export async function sendMessage(user: Party, conversationId: string, input: SendMessageInput): Promise<MessageDTO> {
  assertRateLimit(user.id);
  await getParticipation(user.id, conversationId);
  const others = await prisma.conversationParticipant.findMany({
    where: { conversationId, leftAt: null, userId: { not: user.id } },
    select: { userId: true },
  });
  if (!(await canSendIn(user, others.map((o) => o.userId)))) {
    throw new AppError('FORBIDDEN', 'You can no longer send messages in this conversation.', { reason: 'RELATIONSHIP_ENDED' });
  }
  const message = await prisma.$transaction((tx) => insertMessage(tx, user.id, conversationId, input));
  await afterSend(message);
  return toMessageDTO(message, user.id);
}

/** FR-15: own message, still a participant, not deleted, within 15 minutes. */
async function loadOwnEditable(user: Party, messageId: string, now: Date) {
  const m = await prisma.message.findUnique({ where: { id: messageId }, select: { id: true, conversationId: true, senderId: true, body: true, createdAt: true, deletedAt: true } });
  if (!m) throw new AppError('NOT_FOUND', 'Message not found');
  await getParticipation(user.id, m.conversationId);
  const refuse = (reason: string, msg: string) => new AppError('FORBIDDEN', msg, { reason });
  if (m.senderId !== user.id) throw refuse('NOT_SENDER', 'You can only change your own messages.');
  if (m.deletedAt) throw refuse('ALREADY_DELETED', 'This message was deleted.');
  if (now.getTime() - m.createdAt.getTime() > EDIT_WINDOW_MS) throw refuse('EDIT_WINDOW_EXPIRED', 'Messages can only be changed within 15 minutes of sending.');
  return m;
}

/** FR-3/FR-15: stores the old body as a MessageRevision, then updates body + editedAt, in one transaction. */
export async function editMessage(user: Party, messageId: string, body: string, now: Date = new Date()): Promise<MessageDTO> {
  const m = await loadOwnEditable(user, messageId, now);
  const updated = await prisma.$transaction(async (tx) => {
    await tx.messageRevision.create({ data: { messageId, body: m.body } });
    return tx.message.update({ where: { id: messageId }, data: { body, editedAt: now }, include: messageInclude });
  });
  return toMessageDTO(updated, user.id, now);
}

/** FR-15/NFR-3: soft delete only. */
export async function deleteMessage(user: Party, messageId: string, now: Date = new Date()): Promise<MessageDTO> {
  await loadOwnEditable(user, messageId, now);
  const updated = await prisma.message.update({ where: { id: messageId }, data: { deletedAt: now }, include: messageInclude });
  return toMessageDTO(updated, user.id, now);
}
