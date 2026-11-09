import { ok, parseBody, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { setExemption } from '@/server/assignments/assignments-service';
import { exemptionInput } from '@/lib/validators/assignments';

type Ctx = { params: { id: string; studentId: string } };

/** PUT / DELETE /api/assignments/:id/exemptions/:studentId — idempotent exempt toggle (FR-35). */
export const PUT = withHandler(async (request: Request, { params }: Ctx) => {
  const user = await requireUser();
  const { reason } = await parseBody(request, exemptionInput);
  return ok(await setExemption(user, params.id, params.studentId, true, reason, request));
});

export const DELETE = withHandler(async (request: Request, { params }: Ctx) => {
  const user = await requireUser();
  return ok(await setExemption(user, params.id, params.studentId, false, undefined, request));
});
