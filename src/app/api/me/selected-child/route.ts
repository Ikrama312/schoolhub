import { z } from 'zod';
import { ok, parseBody, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { setSelectedChildCookie } from '@/server/parent/selected-child';

const body = z.object({ studentId: z.string().min(1) });

/** POST /api/me/selected-child — PARENT; sets sh_child after checking the link (FR-3, FR-4, NFR-5). */
export const POST = withHandler(async (request: Request) => {
  const user = await requireRole('PARENT');
  const { studentId } = await parseBody(request, body);
  return ok(await setSelectedChildCookie(user, studentId));
});
