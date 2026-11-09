import { AppError, apiError, ok, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { uploadFile } from '@/server/files/files-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/files: multipart upload with `context` before `file` (FR-3..FR-7).
 * '/api/files/' is public in middleware (D1), so requireUser is mandatory here.
 */
export const POST = withHandler(async (request: Request) => {
  const user = await requireUser();
  try {
    return ok(await uploadFile(user, request), { status: 201 });
  } catch (error) {
    if (error instanceof AppError && error.code === 'RATE_LIMITED') {
      const res = apiError(error.code, error.message, error.details);
      const seconds = (error.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds ?? 3600;
      res.headers.set('Retry-After', String(seconds));
      return res;
    }
    throw error;
  }
});
