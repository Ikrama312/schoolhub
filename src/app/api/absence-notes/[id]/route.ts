import { ok, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { get } from '@/server/absence-notes/absence-notes-service';

/** GET /api/absence-notes/:id — parent, homeroom teacher or ADMIN; reviewers also get attendance records (FR-20, FR-21). */
export const GET = withHandler(async (_request: Request, { params }: { params: { id: string } }) => {
  const user = await requireRole('PARENT', 'TEACHER', 'ADMIN');
  return ok(await get(user, params.id));
});
