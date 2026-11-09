import { ok, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { audit } from '@/server/audit';
import { restoreUser } from '@/server/services/users';

/** POST /api/users/:id/restore — ADMIN only. Clears archivedAt; status is re-enabled separately via /status (FR-13). */
export const POST = withHandler(async (_request: Request, { params }: { params: { id: string } }) => {
  const actor = await requireRole('ADMIN');
  const user = await restoreUser(params.id);
  await audit({ actorId: actor.id, action: 'user.restored', entityType: 'User', entityId: params.id });
  return ok(user);
});
