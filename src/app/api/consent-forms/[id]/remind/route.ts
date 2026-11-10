import { AppError, apiError, ok, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { remind } from '@/server/consent-forms/consent-forms-service';

/** POST /api/consent-forms/:id/remind — creator or ADMIN, once per 24 h (429 + Retry-After) (FR-39). */
export const POST = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const user = await requireRole('ADMIN', 'TEACHER');
  try {
    return ok(await remind(user, params.id, request));
  } catch (error) {
    if (error instanceof AppError && error.code === 'RATE_LIMITED') {
      const res = apiError(error.code, error.message, error.details);
      const ms = (error.details as { retryAfterMs?: number } | undefined)?.retryAfterMs ?? 0;
      res.headers.set('Retry-After', String(Math.ceil(ms / 1000)));
      return res;
    }
    throw error;
  }
});
