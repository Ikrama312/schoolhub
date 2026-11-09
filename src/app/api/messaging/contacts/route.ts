import { ok, parseQuery, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { contactsQuery } from '@/lib/validators/messaging';
import { listContacts } from '@/server/messaging/contacts';

export const dynamic = 'force-dynamic';

/** GET /api/messaging/contacts?q= — only users the caller may message, grouped (FR-8). */
export const GET = withHandler(async (request: Request) => {
  const user = await requireUser();
  const { q } = parseQuery(new URL(request.url).searchParams, contactsQuery);
  return ok(await listContacts(user, q));
});
