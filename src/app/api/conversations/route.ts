import { ok, paginated, parseBody, parsePagination, parseQuery, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { createConversationSchema, listConversationsQuery } from '@/lib/validators/messaging';
import { createConversation, listConversations } from '@/server/messaging/conversations';

export const dynamic = 'force-dynamic';

/** GET /api/conversations — the caller's inbox or archive (FR-9). */
export const GET = withHandler(async (request: Request) => {
  const user = await requireUser();
  const { searchParams } = new URL(request.url);
  const q = parseQuery(searchParams, listConversationsQuery);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const { data, total } = await listConversations(user, { archived: q.archived, q: q.q, skip, take });
  return paginated(data, { page, pageSize, total });
});

/** POST /api/conversations — create with the first message (FR-6, FR-12, FR-30, NFR-4). */
export const POST = withHandler(async (request: Request) => {
  const user = await requireUser();
  const input = await parseBody(request, createConversationSchema);
  return ok(await createConversation(user, input), { status: 201 });
});
