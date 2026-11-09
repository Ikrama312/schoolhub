import { z } from 'zod';
import { ok, paginated, parseBody, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { audit } from '@/server/audit';
import { listAcademicYears, createAcademicYear } from '@/server/services/academicYears';

const createSchema = z.object({
  name: z.string().min(1),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
});

export const GET = withHandler(async () => {
  const years = await listAcademicYears();
  return paginated(years, { page: 1, pageSize: years.length, total: years.length });
});

export const POST = withHandler(async (request: Request) => {
  const actor = await requireRole('ADMIN');
  const input = await parseBody(request, createSchema);
  const year = await createAcademicYear(input);
  await audit({ actorId: actor.id, action: 'academicYear.create', entityType: 'AcademicYear', entityId: year.id });
  return ok(year, { status: 201 });
});
