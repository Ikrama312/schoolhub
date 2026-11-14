import { ok, parseBody, parseQuery, withHandler } from '@/server/http';
import { requireBursar, requireFeeAdmin } from '@/server/fees/access';
import { createFeeItem, listFeeItems } from '@/server/fees/fees-service';
import { feeItemSchema, setupListQuery } from '@/lib/validators/fees';

/** GET /api/fees/items — ADMIN read (FR-6). */
export const GET = withHandler(async (request: Request) => {
  await requireFeeAdmin();
  return ok(await listFeeItems(parseQuery(new URL(request.url).searchParams, setupListQuery)));
});

/** POST /api/fees/items — bursar; duplicate code → 409 (FR-6). */
export const POST = withHandler(async (request: Request) => {
  const actor = await requireBursar();
  return ok(await createFeeItem(actor, await parseBody(request, feeItemSchema)), { status: 201 });
});
