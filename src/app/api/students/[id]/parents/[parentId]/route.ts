import { ok, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { audit } from '@/server/audit';
import { unlinkParentFromStudent } from '@/server/services/userLinks';

/** DELETE /api/students/:id/parents/:parentId — ADMIN only (FR-15). */
export const DELETE = withHandler(
  async (_request: Request, { params }: { params: { id: string; parentId: string } }) => {
    const actor = await requireRole('ADMIN');
    await unlinkParentFromStudent(params.id, params.parentId);
    await audit({
      actorId: actor.id,
      action: 'parent_link.removed',
      entityType: 'User',
      entityId: params.id,
      metadata: { parentId: params.parentId },
    });
    return ok({ id: params.parentId, deleted: true });
  },
);
