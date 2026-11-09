import { paginated, parsePagination, parseQuery, withHandler } from '@/server/http';
import { safeguardingConversationsQuery } from '@/lib/validators/messaging';
import { requireSafeguardingLead } from '@/server/messaging/access';
import { searchConversations } from '@/server/messaging/safeguarding';

export const dynamic = 'force-dynamic';

/** GET /api/safeguarding/conversations — involvesStudent conversations only (FR-24). */
export const GET = withHandler(async (request: Request) => {
  const lead = await requireSafeguardingLead();
  const { searchParams } = new URL(request.url);
  const q = parseQuery(searchParams, safeguardingConversationsQuery);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const { data, total } = await searchConversations(lead, { participantId: q.participantId, from: q.from, to: q.to, skip, take });
  return paginated(data, { page, pageSize, total });
});
