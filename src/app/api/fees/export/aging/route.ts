import { withHandler } from '@/server/http';
import { requireFeeAdmin } from '@/server/fees/access';
import { exportAgingCsv } from '@/server/fees/reports';

/** GET /api/fees/export/aging — ADMIN; open invoices with their aging bucket, CSV (FR-44). */
export const GET = withHandler(async () => {
  await requireFeeAdmin();
  return exportAgingCsv();
});
