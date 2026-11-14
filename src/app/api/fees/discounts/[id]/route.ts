import { ok, parseBody, withHandler } from '@/server/http';
import { requireBursar } from '@/server/fees/access';
import { updateDiscount } from '@/server/fees/fees-service';
import { discountPatchSchema } from '@/lib/validators/fees';

type Ctx = { params: { id: string } };

/** PATCH /api/fees/discounts/:id — bursar (FR-8). */
export const PATCH = withHandler(async (request: Request, { params }: Ctx) => {
  const actor = await requireBursar();
  return ok(await updateDiscount(actor, params.id, await parseBody(request, discountPatchSchema)));
});
