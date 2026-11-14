import { ok, parseQuery, withHandler } from '@/server/http';
import { requireFeeAdmin } from '@/server/fees/access';
import { getFamilyOpenInvoices } from '@/server/fees/fees-service';
import { openInvoicesQuery } from '@/lib/validators/fees';

type Ctx = { params: { parentId: string } };

/** GET /api/fees/families/:parentId/open-invoices — ADMIN read; :parentId must be a PARENT (FR-26, FR-28). */
export const GET = withHandler(async (request: Request, { params }: Ctx) => {
  await requireFeeAdmin();
  const { amount } = parseQuery(new URL(request.url).searchParams, openInvoicesQuery);
  return ok(await getFamilyOpenInvoices(params.parentId, amount));
});
