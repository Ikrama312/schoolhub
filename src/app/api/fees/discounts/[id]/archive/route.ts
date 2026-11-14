import { ok, withHandler } from '@/server/http';
import { requireBursar } from '@/server/fees/access';
import { archiveDiscount } from '@/server/fees/fees-service';

type Ctx = { params: { id: string } };

/** POST /api/fees/discounts/:id/archive — bursar, idempotent (FR-8). */
export const POST = withHandler(async (_request: Request, { params }: Ctx) => {
  const actor = await requireBursar();
  return ok(await archiveDiscount(actor, params.id));
});
