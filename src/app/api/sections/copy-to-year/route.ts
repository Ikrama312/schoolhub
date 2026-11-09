import { ok, parseBody, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { copySectionsToYear } from '@/server/sections/sections-service';
import { copyToYearSchema } from '@/lib/validators/sections';

/** POST /api/sections/copy-to-year — ADMIN, structural copy only (FR-6, NFR-6). */
export const POST = withHandler(async (request: Request) => {
  const actor = await requireRole('ADMIN');
  const input = await parseBody(request, copyToYearSchema);
  return ok(await copySectionsToYear(input, actor.id), { status: 201 });
});
