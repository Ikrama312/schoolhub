import { ok, parseBody, parseQuery, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { listMessagesQuery, sendMessageSchema } from '@/lib/validators/messaging';
import { listMessages, sendMessage } from '@/server/messaging/messages';

export const dynamic = 'force-dynamic';

/** GET /api/conversations/:id/messages?before= | ?after=&since= (FR-10, FR-13, NFR-2). */
export const GET = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  const q = parseQuery(new URL(request.url).searchParams, listMessagesQuery);
  return ok(await listMessages(user, params.id, q));
});

/** POST /api/conversations/:id/messages — send (FR-7, FR-11, FR-31, NFR-4). */
export const POST = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  const input = await parseBody(request, sendMessageSchema);
  return ok({ message: await sendMessage(user, params.id, input) }, { status: 201 });
});
