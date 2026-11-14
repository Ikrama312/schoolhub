import { ok, parseBody, withHandler } from '@/server/http';
import { requireBursar } from '@/server/fees/access';
import { replacePlan } from '@/server/fees/fees-service';
import { feePlanSchema } from '@/lib/validators/fees';

type Ctx = { params: { id: string } };

/** PUT /api/fees/plans/:id — bursar; replaces the plan and all lines in one transaction (FR-7). */
export const PUT = withHandler(async (request: Request, { params }: Ctx) => {
  const actor = await requireBursar();
  return ok(await replacePlan(actor, params.id, await parseBody(request, feePlanSchema)));
});
