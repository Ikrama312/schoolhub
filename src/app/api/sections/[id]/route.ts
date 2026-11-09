import { ok, parseBody, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { deleteSection, updateSection } from '@/server/sections/sections-service';
import { sectionUpdateSchema } from '@/lib/validators/sections';

type Ctx = { params: { id: string } };

/** PATCH/DELETE /api/sections/:id — ADMIN (PRD-05 FR-3). */
export const PATCH = withHandler(async (request: Request, { params }: Ctx) => {
  const actor = await requireRole('ADMIN');
  const input = await parseBody(request, sectionUpdateSchema);
  return ok(await updateSection(params.id, input, actor.id));
});

export const DELETE = withHandler(async (_request: Request, { params }: Ctx) => {
  const actor = await requireRole('ADMIN');
  return ok(await deleteSection(params.id, actor.id));
});
