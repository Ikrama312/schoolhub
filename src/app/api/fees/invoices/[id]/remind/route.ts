import { ok, withHandler } from '@/server/http';
import { requireBursar } from '@/server/fees/access';
import { remindInvoice } from '@/server/fees/fees-service';

type Ctx = { params: { id: string } };

/** POST /api/fees/invoices/:id/remind — bursar; once per 24 h per invoice → 429 (FR-38, D-8). */
export const POST = withHandler(async (_request: Request, { params }: Ctx) => {
  const actor = await requireBursar();
  return ok(await remindInvoice(actor, params.id));
});
