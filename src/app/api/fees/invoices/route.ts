import { NextResponse } from 'next/server';
import { ok, parseBody, parsePagination, parseQuery, withHandler } from '@/server/http';
import { requireBursar, requireFeeReader } from '@/server/fees/access';
import { createManualInvoice, listInvoices } from '@/server/fees/fees-service';
import { invoiceListQuery, manualInvoiceSchema } from '@/lib/validators/fees';

/** GET /api/fees/invoices — fee reader; parents see linked children only, no drafts (FR-17, FR-18). */
export const GET = withHandler(async (request: Request) => {
  const user = await requireFeeReader();
  const params = new URL(request.url).searchParams;
  const { rows, meta } = await listInvoices(user, parseQuery(params, invoiceListQuery), parsePagination(params));
  // meta carries totals + currency on top of the standard page/pageSize/total (same envelope as paginated()).
  return NextResponse.json({ data: rows, meta });
});

/** POST /api/fees/invoices — bursar; manual one-off invoice (FR-23). */
export const POST = withHandler(async (request: Request) => {
  const actor = await requireBursar();
  return ok(await createManualInvoice(actor, await parseBody(request, manualInvoiceSchema)), { status: 201 });
});
