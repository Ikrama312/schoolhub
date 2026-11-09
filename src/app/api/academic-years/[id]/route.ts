import { z } from 'zod';
import { ok, parseBody, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { audit } from '@/server/audit';
import { updateAcademicYear, deleteAcademicYear } from '@/server/services/academicYears';

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

export const PATCH = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const actor = await requireRole('ADMIN');
  const input = await parseBody(request, updateSchema);
  const year = await updateAcademicYear(params.id, input);
  await audit({ actorId: actor.id, action: 'academicYear.update', entityType: 'AcademicYear', entityId: year.id, metadata: { fields: Object.keys(input) } });
  return ok(year);
});

export const DELETE = withHandler(async (_request: Request, { params }: { params: { id: string } }) => {
  const actor = await requireRole('ADMIN');
  await deleteAcademicYear(params.id);
  await audit({ actorId: actor.id, action: 'academicYear.delete', entityType: 'AcademicYear', entityId: params.id });
  return ok({ id: params.id, deleted: true });
});
