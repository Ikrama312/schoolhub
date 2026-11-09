import { ok, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { audit } from '@/server/audit';
import { archiveUser } from '@/server/services/users';

/** POST /api/users/:id/archive — ADMIN only (FR-13, FR-14). Same self/last-admin guard as /status. */
export const POST = withHandler(async (_request: Request, { params }: { params: { id: string } }) => {
  const actor = await requireRole('ADMIN');
  const user = await archiveUser(actor.id, params.id);
  await audit({ actorId: actor.id, action: 'user.archived', entityType: 'User', entityId: params.id });
  return ok(user);
});
