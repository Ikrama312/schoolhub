import { ok, parseBody, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { getReportCard, patchComments } from '@/server/report-cards/report-card-service';
import { reportCardPatchSchema } from '@/lib/validators/gradebook';

type Ctx = { params: { id: string } };

/** GET /api/report-cards/:id — assertCanViewReportCard; NOT_FOUND for everyone else (FR-37). */
export const GET = withHandler(async (_request: Request, { params }: Ctx) => {
  const user = await requireUser();
  return ok(await getReportCard(user, params.id));
});

/** PATCH /api/report-cards/:id — comments, field-level access, DRAFT only (FR-32). */
export const PATCH = withHandler(async (request: Request, { params }: Ctx) => {
  const user = await requireUser();
  const patch = await parseBody(request, reportCardPatchSchema);
  return ok(await patchComments(user, params.id, patch, request));
});
