import { ok, parseBody, withHandler } from '@/server/http';
import { requireBursar } from '@/server/fees/access';
import { generateInvoices } from '@/server/fees/fees-service';
import { generateSchema } from '@/lib/validators/fees';

export const maxDuration = 300;

/** POST /api/fees/invoices/generate — bursar; chunked, idempotent (FR-13, FR-14, NFR-5). */
export const POST = withHandler(async (request: Request) => {
  const actor = await requireBursar();
  return ok(await generateInvoices(actor, await parseBody(request, generateSchema)), { status: 201 });
});
