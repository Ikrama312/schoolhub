import { parseQuery, withHandler } from '@/server/http';
import { requireFeeAdmin } from '@/server/fees/access';
import { exportInvoicesCsv } from '@/server/fees/reports';
import { invoiceListQuery } from '@/lib/validators/fees';

/** GET /api/fees/export/invoices — ADMIN; same filters as the list, CSV (FR-44). */
export const GET = withHandler(async (request: Request) => {
  await requireFeeAdmin();
  const { sort: _sort, page: _page, pageSize: _pageSize, ...filters } = parseQuery(new URL(request.url).searchParams, invoiceListQuery);
  return exportInvoicesCsv(filters);
});
