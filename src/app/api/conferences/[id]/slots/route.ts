import { ok, parseQuery, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { listSlots } from '@/server/conferences/conferences-service';
import { getSelectedChild } from '@/server/parent/selected-child';
import { slotsQuery } from '@/lib/validators/conferences';

/** GET /api/conferences/:id/slots — PARENT: selected child's teachers; TEACHER: own (?view=day); ADMIN: all (FR-29, FR-30, FR-34). */
export const GET = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const user = await requireRole('ADMIN', 'TEACHER', 'PARENT');
  const searchParams = new URL(request.url).searchParams;
  const query = parseQuery(searchParams, slotsQuery);
  if (user.role === 'PARENT') {
    // An explicit ?studentId must be linked (404 otherwise, in the service); else sh_child / first child.
    const studentId = query.studentId ?? (await getSelectedChild(user))?.studentId;
    return ok(await listSlots(user, params.id, { ...query, studentId }));
  }
  return ok(await listSlots(user, params.id, query));
});
