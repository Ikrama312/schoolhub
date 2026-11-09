import { ok, parseBody, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { reportSchema } from '@/lib/validators/messaging';
import { reportMessage } from '@/server/messaging/reports';

/** POST /api/messages/:id/report (FR-22, FR-26). 409 on a duplicate OPEN report. */
export const POST = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  const { reason } = await parseBody(request, reportSchema);
  return ok(await reportMessage(user, params.id, reason), { status: 201 });
});
