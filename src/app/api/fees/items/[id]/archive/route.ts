import { ok, withHandler } from '@/server/http';
import { requireBursar } from '@/server/fees/access';
import { archiveFeeItem } from '@/server/fees/fees-service';

type Ctx = { params: { id: string } };

/** POST /api/fees/items/:id/archive — bursar, idempotent (FR-6). */
export const POST = withHandler(async (_request: Request, { params }: Ctx) => {
  const actor = await requireBursar();
  return ok(await archiveFeeItem(actor, params.id));
});
