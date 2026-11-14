import { ok, withHandler } from '@/server/http';
import { requireBursar } from '@/server/fees/access';
import { issue } from '@/server/fees/fees-service';

type Ctx = { params: { id: string } };

/** POST /api/fees/invoices/:id/issue — bursar, DRAFT only (FR-14, FR-16, FR-20). */
export const POST = withHandler(async (_request: Request, { params }: Ctx) => {
  const actor = await requireBursar();
  return ok(await issue(actor, params.id));
});
