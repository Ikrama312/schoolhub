import { ok, parseBody, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { addMembers } from '@/server/sections/sections-service';
import { enrollStudentsSchema } from '@/lib/validators/sections';

/** POST /api/sections/:id/members — ADMIN; auto-enrolls in the section's CORE courses (FR-7). */
export const POST = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const actor = await requireRole('ADMIN');
  const input = await parseBody(request, enrollStudentsSchema);
  return ok(await addMembers(params.id, input, actor.id), { status: 201 });
});
