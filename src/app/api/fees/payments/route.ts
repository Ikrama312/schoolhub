import { NextResponse } from 'next/server';
import { ok, parseBody, parsePagination, parseQuery, withHandler } from '@/server/http';
import { requireBursar, requireFeeReader } from '@/server/fees/access';
import { listPayments, recordPayment } from '@/server/fees/fees-service';
import { paymentListQuery, recordPaymentSchema } from '@/lib/validators/fees';

/** GET /api/fees/payments — fee reader; parents see payments allocated to their children (FR-32). */
export const GET = withHandler(async (request: Request) => {
  const user = await requireFeeReader();
  const params = new URL(request.url).searchParams;
  const { rows, meta } = await listPayments(user, parseQuery(params, paymentListQuery), parsePagination(params));
  return NextResponse.json({ data: rows, meta });
});

/** POST /api/fees/payments — bursar; one transaction, overpayment refused (FR-27 to FR-30). */
export const POST = withHandler(async (request: Request) => {
  const actor = await requireBursar();
  return ok(await recordPayment(actor, await parseBody(request, recordPaymentSchema)), { status: 201 });
});
