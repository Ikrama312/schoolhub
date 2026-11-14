import { ok, parseBody, withHandler } from '@/server/http';
import { requireBursar } from '@/server/fees/access';
import { voidInvoice } from '@/server/fees/fees-service';
import { reasonSchema } from '@/lib/validators/fees';

type Ctx = { params: { id: string } };

/** POST /api/fees/invoices/:id/void — bursar; no live allocations (FR-21, D-11). */
export const POST = withHandler(async (request: Request, { params }: Ctx) => {
  const actor = await requireBursar();
  const { reason } = await parseBody(request, reasonSchema);
  return ok(await voidInvoice(actor, params.id, reason));
});
