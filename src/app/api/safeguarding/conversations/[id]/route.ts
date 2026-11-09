import { ok, withHandler } from '@/server/http';
import { requireSafeguardingLead } from '@/server/messaging/access';
import { getConversationForSafeguarding } from '@/server/messaging/safeguarding';

export const dynamic = 'force-dynamic';

/** GET /api/safeguarding/conversations/:id — read-only full thread; audited on every call (FR-24, FR-25). */
export const GET = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const lead = await requireSafeguardingLead();
  return ok(await getConversationForSafeguarding(lead, params.id, request));
});
