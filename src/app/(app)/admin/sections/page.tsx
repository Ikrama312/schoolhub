import { prisma } from '@/server/db';
import { requirePageRole } from '@/server/auth/requireRole';
import { getCurrentAcademicYear } from '@/server/services/academicYears';
import { isCopyTargetYear, listSections } from '@/server/sections/sections-service';
import { SectionsClient } from './SectionsClient';

export const dynamic = 'force-dynamic';

/** /admin/sections — PRD-05 FR-2/FR-3/FR-6. */
export default async function SectionsPage() {
  await requirePageRole('ADMIN');
  const [years, gradeLevels, rooms, current] = await Promise.all([
    prisma.academicYear.findMany({ orderBy: { startDate: 'asc' } }),
    prisma.gradeLevel.findMany({ where: { archivedAt: null }, orderBy: { order: 'asc' } }),
    prisma.room.findMany({ where: { archivedAt: null }, orderBy: { name: 'asc' } }),
    getCurrentAcademicYear(),
  ]);
  const initial = await listSections({}, { skip: 0, take: 20 });

  return (
    <SectionsClient
      years={years.map((y) => ({ id: y.id, name: y.name, isCurrent: y.isCurrent, isCopyTarget: isCopyTargetYear(y) }))}
      currentYearId={current?.id ?? null}
      gradeLevels={gradeLevels.map((g) => ({ id: g.id, name: g.name }))}
      rooms={rooms.map((r) => ({ id: r.id, name: r.name }))}
      initialRows={JSON.parse(JSON.stringify(initial.rows))}
      initialTotal={initial.total}
    />
  );
}
