import { ok, parseBody, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { getCategories, replaceCategories } from '@/server/gradebook/categories-service';
import { categoriesPutSchema } from '@/lib/validators/gradebook';

type Ctx = { params: { id: string } };

/** GET /api/courses/:id/grade-categories — view course (FR-17). */
export const GET = withHandler(async (_request: Request, { params }: Ctx) => {
  const user = await requireUser();
  return ok(await getCategories(user, params.id));
});

/** PUT /api/courses/:id/grade-categories — manage; replaces the list, total must be 100 (FR-40). */
export const PUT = withHandler(async (request: Request, { params }: Ctx) => {
  const user = await requireUser();
  const input = await parseBody(request, categoriesPutSchema);
  return ok(await replaceCategories(user, params.id, input, request));
});
