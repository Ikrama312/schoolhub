import { ok, parseBody, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { generateDrafts } from '@/server/report-cards/report-card-service';
import { generateSchema } from '@/lib/validators/gradebook';

/** POST /api/report-cards/generate — ADMIN; builds/refreshes DRAFT snapshots (FR-30, FR-31). */
export const POST = withHandler(async (request: Request) => {
  const user = await requireRole('ADMIN');
  const input = await parseBody(request, generateSchema);
  return ok(await generateDrafts(user, input));
});
