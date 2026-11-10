import { ok, parseBody, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { respond } from '@/server/consent-forms/consent-forms-service';
import { consentResponseSchema } from '@/lib/validators/consent-forms';

/** POST /api/consent-forms/:id/responses — PARENT signs for a linked audience child (FR-37, FR-38). */
export const POST = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const user = await requireRole('PARENT');
  return ok(await respond(user, params.id, await parseBody(request, consentResponseSchema), request));
});
