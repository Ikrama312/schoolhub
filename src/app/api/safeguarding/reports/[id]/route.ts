import { ok, parseBody, withHandler } from '@/server/http';
import { reviewReportSchema } from '@/lib/validators/messaging';
import { requireSafeguardingLead } from '@/server/messaging/access';
import { getReport, reviewReport } from '@/server/messaging/safeguarding';

export const dynamic = 'force-dynamic';

/** GET /api/safeguarding/reports/:id — detail with ±5 messages; audited (FR-23, FR-25). */
export const GET = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const lead = await requireSafeguardingLead();
  return ok(await getReport(lead, params.id, request));
});

/** PATCH /api/safeguarding/reports/:id — review (note required) or dismiss; audited (FR-23, NFR-11). */
export const PATCH = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const lead = await requireSafeguardingLead();
  const input = await parseBody(request, reviewReportSchema);
  return ok(await reviewReport(lead, params.id, input, request));
});
