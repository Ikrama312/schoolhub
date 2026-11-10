import { ok, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { get } from '@/server/consent-forms/consent-forms-service';

/** GET /api/consent-forms/:id — audience parents, creator or ADMIN; others 404 (FR-36, FR-37). */
export const GET = withHandler(async (_request: Request, { params }: { params: { id: string } }) => {
  const user = await requireRole('ADMIN', 'TEACHER', 'PARENT');
  return ok(await get(user, params.id));
});
