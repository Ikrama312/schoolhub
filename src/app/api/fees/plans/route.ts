import { ok, parseBody, parseQuery, withHandler } from '@/server/http';
import { requireBursar, requireFeeAdmin } from '@/server/fees/access';
import { createPlan, listPlans } from '@/server/fees/fees-service';
import { feePlanSchema, setupListQuery } from '@/lib/validators/fees';

/** GET /api/fees/plans — ADMIN read (FR-7). */
export const GET = withHandler(async (request: Request) => {
  await requireFeeAdmin();
  return ok(await listPlans(parseQuery(new URL(request.url).searchParams, setupListQuery)));
});

/** POST /api/fees/plans — bursar; duplicate term/annual + grade → 409 (FR-7, D-3). */
export const POST = withHandler(async (request: Request) => {
  const actor = await requireBursar();
  return ok(await createPlan(actor, await parseBody(request, feePlanSchema)), { status: 201 });
});
