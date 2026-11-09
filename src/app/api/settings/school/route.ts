import { ok, parseBody, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { audit } from '@/server/audit';
import { prisma } from '@/server/db';
import { updateSchoolSettings } from '@/server/services/settings';
import { attendanceSettingsPatch } from '@/lib/validators/attendance';

/** PATCH /api/settings/school — ADMIN; attendance fields only (PRD-07 FR-4/FR-5, strict body). */
export const PATCH = withHandler(async (request: Request) => {
  const user = await requireRole('ADMIN');
  const patch = await parseBody(request, attendanceSettingsPatch);
  const old = await prisma.schoolSettings.upsert({ where: { id: 'singleton' }, update: {}, create: { id: 'singleton' } });
  const updated = await updateSchoolSettings(patch);
  const pick = (s: typeof old) => ({ attendanceMode: s.attendanceMode, attendanceAlertThreshold: s.attendanceAlertThreshold });
  await audit({
    actorId: user.id,
    action: 'school_settings.update',
    entityType: 'SchoolSettings',
    entityId: 'singleton',
    metadata: { old: pick(old), new: pick(updated) },
    request,
  });
  return ok(pick(updated));
});
