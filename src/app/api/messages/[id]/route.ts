import { ok, parseBody, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { editMessageSchema } from '@/lib/validators/messaging';
import { deleteMessage, editMessage } from '@/server/messaging/messages';

/** PATCH /api/messages/:id — edit own message within 15 min; old body kept as a revision (FR-3, FR-15). */
export const PATCH = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  const { body } = await parseBody(request, editMessageSchema);
  return ok({ message: await editMessage(user, params.id, body) });
});

/** DELETE /api/messages/:id — soft delete within 15 min (FR-15, NFR-3). */
export const DELETE = withHandler(async (_request: Request, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  return ok({ message: await deleteMessage(user, params.id) });
});
