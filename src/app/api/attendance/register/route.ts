import { ok, parseBody, parseQuery, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { getRegister, saveRegister } from '@/server/attendance/attendance-service';
import { registerPutBody, registerQuery } from '@/lib/validators/attendance';

/** GET /api/attendance/register?courseId&date&periodId | ?sectionId&date (FR-8, FR-9, FR-14, FR-15, FR-19). */
export const GET = withHandler(async (request: Request) => {
  const user = await requireUser();
  const key = parseQuery(new URL(request.url).searchParams, registerQuery);
  return ok(await getRegister(user, key));
});

/** PUT /api/attendance/register — save the whole register atomically (FR-10, FR-14, FR-18..22, NFR-3). */
export const PUT = withHandler(async (request: Request) => {
  const user = await requireUser();
  const { records, ...key } = await parseBody(request, registerPutBody);
  return ok(await saveRegister(user, key, records));
});
