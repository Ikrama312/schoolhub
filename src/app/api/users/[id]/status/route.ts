import { z } from 'zod';
import { ok, parseBody, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { audit } from '@/server/audit';
import { setUserStatus } from '@/server/services/users';

const bodySchema = z.object({ status: z.enum(['ACTIVE', 'DISABLED']) });

/**
 * POST /api/users/:id/status — ADMIN only. Rejects self-disable and
 * disabling the last active ADMIN (FR-12, FR-14). The "sessions stop
 * within 5 minutes" effect is PRD-01's session refresh re-reading status,
 * not rebuilt here (NFR-7) — this only guarantees status is correct the
 * instant the write commits.
 */
export const POST = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const actor = await requireRole('ADMIN');
  const { status } = await parseBody(request, bodySchema);
  const user = await setUserStatus(actor.id, params.id, status);
  await audit({
    actorId: actor.id,
    action: 'user.status_changed',
    entityType: 'User',
    entityId: params.id,
    metadata: { status },
  });
  return ok(user);
});
