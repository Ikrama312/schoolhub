import { ok, parseBody, withHandler } from '@/server/http';
import { requireBursar } from '@/server/fees/access';
import { reversePayment } from '@/server/fees/fees-service';
import { reasonSchema } from '@/lib/validators/fees';

type Ctx = { params: { id: string } };

/** POST /api/fees/payments/:id/reverse — bursar; second reverse → 409 (FR-31). */
export const POST = withHandler(async (request: Request, { params }: Ctx) => {
  const actor = await requireBursar();
  const { reason } = await parseBody(request, reasonSchema);
  return ok(await reversePayment(actor, params.id, reason));
});
