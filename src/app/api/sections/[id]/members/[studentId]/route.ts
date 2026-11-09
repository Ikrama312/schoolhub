import { ok, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { removeMember } from '@/server/sections/sections-service';

/** DELETE /api/sections/:id/members/:studentId — ADMIN; drops CORE enrollments (FR-8). */
export const DELETE = withHandler(
  async (_request: Request, { params }: { params: { id: string; studentId: string } }) => {
    const actor = await requireRole('ADMIN');
    return ok(await removeMember(params.id, params.studentId, actor.id));
  },
);
