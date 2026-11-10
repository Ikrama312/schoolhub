import { ok, parseBody, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { getEvent, updateEvent } from '@/server/conferences/conferences-service';
import { getSelectedChild } from '@/server/parent/selected-child';
import { conferenceEventPatchSchema } from '@/lib/validators/conferences';

type Ctx = { params: { id: string } };

/** GET /api/conferences/:id — TEACHER gets mySlotCount; PARENT gets the selected child's teachers (FR-28, FR-30). */
export const GET = withHandler(async (request: Request, { params }: Ctx) => {
  const user = await requireRole('ADMIN', 'TEACHER', 'PARENT');
  const child = await getSelectedChild(user, new URL(request.url).searchParams);
  return ok(await getEvent(user, params.id, { studentId: child?.studentId }));
});

/** PATCH /api/conferences/:id — ADMIN (FR-28). */
export const PATCH = withHandler(async (request: Request, { params }: Ctx) => {
  const user = await requireRole('ADMIN');
  const patch = await parseBody(request, conferenceEventPatchSchema);
  return ok(await updateEvent(user, params.id, patch, request));
});
