import { ok, parseBody, withHandler } from '@/server/http';
import { requireBursar } from '@/server/fees/access';
import { adjustInvoice } from '@/server/fees/fees-service';
import { adjustSchema } from '@/lib/validators/fees';

type Ctx = { params: { id: string } };

/** POST /api/fees/invoices/:id/adjust — bursar; negative line with a reason (FR-21, D-10). */
export const POST = withHandler(async (request: Request, { params }: Ctx) => {
  const actor = await requireBursar();
  return ok(await adjustInvoice(actor, params.id, await parseBody(request, adjustSchema)));
});
