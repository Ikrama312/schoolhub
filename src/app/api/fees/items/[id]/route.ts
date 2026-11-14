import { ok, parseBody, withHandler } from '@/server/http';
import { requireBursar } from '@/server/fees/access';
import { updateFeeItem } from '@/server/fees/fees-service';
import { feeItemPatchSchema } from '@/lib/validators/fees';

type Ctx = { params: { id: string } };

/** PATCH /api/fees/items/:id — bursar (FR-6). */
export const PATCH = withHandler(async (request: Request, { params }: Ctx) => {
  const actor = await requireBursar();
  return ok(await updateFeeItem(actor, params.id, await parseBody(request, feeItemPatchSchema)));
});
