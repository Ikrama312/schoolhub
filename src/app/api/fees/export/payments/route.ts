import { parseQuery, withHandler } from '@/server/http';
import { requireFeeAdmin } from '@/server/fees/access';
import { exportPaymentsCsv } from '@/server/fees/reports';
import { paymentExportQuery } from '@/lib/validators/fees';

/** GET /api/fees/export/payments — ADMIN; date range + method, CSV (FR-44). */
export const GET = withHandler(async (request: Request) => {
  await requireFeeAdmin();
  return exportPaymentsCsv(parseQuery(new URL(request.url).searchParams, paymentExportQuery));
});
