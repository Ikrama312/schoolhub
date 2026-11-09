import type { Prisma, ReportStatus } from '@prisma/client';
import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import { audit } from '@/server/audit';
import type { Party } from './contact-rules';
import { assertSafeguardingLead } from './access';
import { messageInclude, toAttachment, toUserSummary, userSummarySelect } from './messages';

/**
 * PRD-13 safeguarding (FR-23..FR-25, NFR-1, NFR-3, NFR-11). Every function re-checks the lead flag
 * from the DB. Deleted bodies and edit revisions are visible here and nowhere else. Every view of
 * conversation content writes audit('safeguarding.conversation.view').
 */

const sgInclude = { ...messageInclude, revisions: { orderBy: { createdAt: 'asc' }, select: { body: true, createdAt: true } } } as const;
type SgRow = Prisma.MessageGetPayload<{ include: typeof sgInclude }>;

const toSgMessage = (m: SgRow) => ({
  id: m.id,
  conversationId: m.conversationId,
  sender: toUserSummary(m.sender),
  body: m.body,
  deleted: m.deletedAt !== null,
  deletedAt: m.deletedAt?.toISOString() ?? null,
  editedAt: m.editedAt?.toISOString() ?? null,
  createdAt: m.createdAt.toISOString(),
  updatedAt: m.updatedAt.toISOString(),
  attachments: m.attachments.map((a) => toAttachment(a.file)),
  isOwn: false,
  canEdit: false,
  revisions: m.revisions.map((r) => ({ body: r.body, createdAt: r.createdAt.toISOString() })),
});
export type SafeguardingMessageDTO = ReturnType<typeof toSgMessage>;

const reportInclude = {
  reporter: { select: userSummarySelect },
  reviewedBy: { select: userSummarySelect },
  message: { include: sgInclude },
} as const;
type ReportRow = Prisma.MessageReportGetPayload<{ include: typeof reportInclude }>;

const toReport = (r: ReportRow) => ({
  id: r.id,
  status: r.status,
  reason: r.reason,
  reporter: toUserSummary(r.reporter),
  message: toSgMessage(r.message),
  conversationId: r.message.conversationId,
  reviewedBy: r.reviewedBy ? toUserSummary(r.reviewedBy) : null,
  reviewedAt: r.reviewedAt?.toISOString() ?? null,
  reviewNote: r.reviewNote,
  createdAt: r.createdAt.toISOString(),
});
export type ReportDTO = ReturnType<typeof toReport>;

const participantsOf = async (conversationId: string) =>
  (
    await prisma.conversationParticipant.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      select: { leftAt: true, user: { select: userSummarySelect } },
    })
  ).map((p) => ({ ...toUserSummary(p.user), leftAt: p.leftAt?.toISOString() ?? null }));

const viewAudit = (lead: Party, conversationId: string, request?: Request, metadata?: Record<string, unknown>) =>
  audit({ actorId: lead.id, action: 'safeguarding.conversation.view', entityType: 'Conversation', entityId: conversationId, metadata, request });

/** FR-23: OPEN first (enum order), then newest first. */
export async function listReports(lead: Party, opts: { status?: ReportStatus; skip: number; take: number }) {
  await assertSafeguardingLead(lead);
  const where: Prisma.MessageReportWhereInput = opts.status ? { status: opts.status } : {};
  const [total, rows] = await Promise.all([
    prisma.messageReport.count({ where }),
    prisma.messageReport.findMany({ where, include: reportInclude, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], skip: opts.skip, take: opts.take }),
  ]);
  return { data: rows.map(toReport), total };
}

/** FR-23/FR-25: the report, ±5 messages of context (incl. deleted + revisions), participants. Audited. */
export async function getReport(lead: Party, reportId: string, request?: Request) {
  await assertSafeguardingLead(lead);
  const r = await prisma.messageReport.findUnique({ where: { id: reportId }, include: reportInclude });
  if (!r) throw new AppError('NOT_FOUND', 'Report not found');
  const { conversationId, createdAt, id } = r.message;
  const [before, after, participants] = await Promise.all([
    prisma.message.findMany({
      where: { conversationId, OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }] },
      include: sgInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 5,
    }),
    prisma.message.findMany({
      where: { conversationId, OR: [{ createdAt: { gt: createdAt } }, { createdAt, id: { gt: id } }] },
      include: sgInclude,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 5,
    }),
    participantsOf(conversationId),
  ]);
  await viewAudit(lead, conversationId, request, { reportId });
  return { report: toReport(r), before: before.reverse().map(toSgMessage), after: after.map(toSgMessage), participants };
}

/** FR-23/NFR-11: review needs a note; only OPEN reports can change (409). Audited. */
export async function reviewReport(lead: Party, reportId: string, input: { action: 'review' | 'dismiss'; note?: string }, request?: Request) {
  await assertSafeguardingLead(lead);
  if (input.action === 'review' && !input.note) throw new AppError('VALIDATION_ERROR', 'A note is required to mark a report reviewed.');
  const r = await prisma.messageReport.findUnique({ where: { id: reportId }, select: { status: true, message: { select: { conversationId: true } } } });
  if (!r) throw new AppError('NOT_FOUND', 'Report not found');
  // Conditional update closes the race between two leads acting at once.
  const changed = await prisma.messageReport.updateMany({
    where: { id: reportId, status: 'OPEN' },
    data: { status: input.action === 'review' ? 'REVIEWED' : 'DISMISSED', reviewedById: lead.id, reviewedAt: new Date(), reviewNote: input.note ?? null },
  });
  if (changed.count !== 1) throw new AppError('CONFLICT', 'This report has already been handled.');
  await audit({
    actorId: lead.id,
    action: `safeguarding.report.${input.action}`,
    entityType: 'MessageReport',
    entityId: reportId,
    metadata: { conversationId: r.message.conversationId, note: input.note ?? null },
    request,
  });
  return { report: toReport(await prisma.messageReport.findUniqueOrThrow({ where: { id: reportId }, include: reportInclude })) };
}

/** FR-24: involvesStudent conversations only; from/to select conversations active in the range. */
export async function searchConversations(lead: Party, opts: { participantId?: string; from?: Date; to?: Date; skip: number; take: number }) {
  await assertSafeguardingLead(lead);
  const where: Prisma.ConversationWhereInput = {
    involvesStudent: true,
    ...(opts.participantId ? { participants: { some: { userId: opts.participantId } } } : {}),
    ...(opts.from ? { lastMessageAt: { gte: opts.from } } : {}),
    ...(opts.to ? { createdAt: { lte: opts.to } } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.conversation.count({ where }),
    prisma.conversation.findMany({
      where,
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      skip: opts.skip,
      take: opts.take,
      include: { participants: { select: { user: { select: userSummarySelect } } }, _count: { select: { messages: true } } },
    }),
  ]);
  const open = await prisma.messageReport.findMany({
    where: { status: 'OPEN', message: { conversationId: { in: rows.map((r) => r.id) } } },
    select: { message: { select: { conversationId: true } } },
  });
  const openBy = new Map<string, number>();
  for (const o of open) openBy.set(o.message.conversationId, (openBy.get(o.message.conversationId) ?? 0) + 1);
  return {
    data: rows.map((c) => ({
      id: c.id,
      subject: c.subject,
      participants: c.participants.map((p) => toUserSummary(p.user)),
      createdAt: c.createdAt.toISOString(),
      lastMessageAt: c.lastMessageAt.toISOString(),
      messageCount: c._count.messages,
      openReportCount: openBy.get(c.id) ?? 0,
    })),
    total,
  };
}

/** FR-24/FR-25: full read-only thread incl. deleted content and revisions; 404 unless involvesStudent. Audited on every call. */
export async function getConversationForSafeguarding(lead: Party, conversationId: string, request?: Request) {
  await assertSafeguardingLead(lead);
  const c = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!c || !c.involvesStudent) throw new AppError('NOT_FOUND', 'Conversation not found');
  const [participants, messages] = await Promise.all([
    participantsOf(conversationId),
    prisma.message.findMany({ where: { conversationId }, include: sgInclude, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
  ]);
  await viewAudit(lead, conversationId, request);
  return {
    conversation: {
      id: c.id,
      subject: c.subject,
      createdById: c.createdById,
      involvesStudent: c.involvesStudent,
      lastMessageAt: c.lastMessageAt.toISOString(),
      participants,
    },
    messages: messages.map(toSgMessage),
  };
}
