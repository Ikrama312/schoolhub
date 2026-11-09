import { ok, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { audit } from '@/server/audit';
import { setCurrentAcademicYear } from '@/server/services/academicYears';

export const POST = withHandler(async (_request: Request, { params }: { params: { id: string } }) => {
  const actor = await requireRole('ADMIN');
  const year = await setCurrentAcademicYear(params.id);
  await audit({ actorId: actor.id, action: 'academicYear.update', entityType: 'AcademicYear', entityId: year.id, metadata: { fields: ['isCurrent'] } });
  return ok(year);
});
