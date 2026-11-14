import { ok, parseBody, withHandler } from '@/server/http';
import { requireBursar } from '@/server/fees/access';
import { previewInvoices } from '@/server/fees/fees-service';
import { previewSchema } from '@/lib/validators/fees';

/** POST /api/fees/invoices/preview — bursar; dry run, nothing written (FR-12, FR-13). */
export const POST = withHandler(async (request: Request) => {
  await requireBursar();
  return ok(await previewInvoices(await parseBody(request, previewSchema)));
});
