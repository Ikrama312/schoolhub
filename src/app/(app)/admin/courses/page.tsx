import { prisma } from '@/server/db';
import { requirePageRole } from '@/server/auth/requireRole';
import { getCurrentAcademicYear } from '@/server/services/academicYears';
import { listCourses } from '@/server/courses/courses-service';
import { CoursesClient } from './CoursesClient';

export const dynamic = 'force-dynamic';

/** /admin/courses — PRD-05 FR-13/FR-14. */
export default async function CoursesPage() {
  const user = await requirePageRole('ADMIN');
  const [years, gradeLevels, subjects, current] = await Promise.all([
    prisma.academicYear.findMany({ orderBy: { startDate: 'asc' } }),
    prisma.gradeLevel.findMany({ where: { archivedAt: null }, orderBy: { order: 'asc' } }),
    prisma.subject.findMany({ where: { archivedAt: null }, orderBy: { name: 'asc' } }),
    getCurrentAcademicYear(),
  ]);
  const sections = await prisma.section.findMany({
    select: { id: true, name: true, academicYearId: true, gradeLevelId: true },
    orderBy: { name: 'asc' },
  });
  const initial = await listCourses(user, {}, { skip: 0, take: 20 });

  return (
    <CoursesClient
      years={years.map((y) => ({ id: y.id, name: y.name, isCurrent: y.isCurrent }))}
      currentYearId={current?.id ?? null}
      gradeLevels={gradeLevels.map((g) => ({ id: g.id, name: g.name }))}
      subjects={subjects.map((s) => ({ id: s.id, name: s.name, code: s.code, color: s.color }))}
      sections={sections}
      initialRows={JSON.parse(JSON.stringify(initial.rows))}
      initialTotal={initial.total}
    />
  );
}
