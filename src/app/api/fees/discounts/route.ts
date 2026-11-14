import { ok, parseBody, parseQuery, withHandler } from '@/server/http';
import { requireBursar, requireFeeAdmin } from '@/server/fees/access';
import { createDiscount, listDiscounts } from '@/server/fees/fees-service';
import { discountSchema, setupListQuery } from '@/lib/validators/fees';

/** GET /api/fees/discounts — ADMIN read (FR-8). */
export const GET = withHandler(async (request: Request) => {
  await requireFeeAdmin();
  return ok(await listDiscounts(parseQuery(new URL(request.url).searchParams, setupListQuery)));
});

/** POST /api/fees/discounts — bursar (FR-8, FR-11). */
export const POST = withHandler(async (request: Request) => {
  const actor = await requireBursar();
  return ok(await createDiscount(actor, await parseBody(request, discountSchema)), { status: 201 });
});
