import { ok, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { audit } from '@/server/audit';
import { unlockUser } from '@/server/services/users';

/** POST /api/users/:id/unlock — ADMIN only, clears lockout fields (FR-31). */
export const POST = withHandler(async (_request: Request, { params }: { params: { id: string } }) => {
  const actor = await requireRole('ADMIN');
  const result = await unlockUser(params.id);
  await audit({ actorId: actor.id, action: 'user.unlocked', entityType: 'User', entityId: params.id });
  return ok(result);
});
