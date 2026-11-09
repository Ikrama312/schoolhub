import { notFound } from 'next/navigation';
import { prisma } from '@/server/db';
import { requirePageRole } from '@/server/auth/requireRole';
import { AppError } from '@/server/http';
import { getSection, listEligibleStudents } from '@/server/sections/sections-service';
import { SectionDetailClient } from './SectionDetailClient';

export const dynamic = 'force-dynamic';

/** /admin/sections/[id] — PRD-05 FR-4/FR-5/FR-9/FR-11/FR-12. */
export default async function SectionDetailPage({ params }: { params: { id: string } }) {
  await requirePageRole('ADMIN');
  const section = await getSection(params.id).catch((error) => {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  });
  const [eligible, subjects, otherSections] = await Promise.all([
    listEligibleStudents(section.id),
    prisma.subject.findMany({ where: { archivedAt: null }, orderBy: { name: 'asc' } }),
    prisma.section.findMany({
      where: { academicYearId: section.academicYearId, id: { not: section.id } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  return (
    <SectionDetailClient
      section={JSON.parse(JSON.stringify(section))}
      eligibleStudents={eligible}
      subjects={subjects.map((s) => ({ id: s.id, name: s.name, code: s.code }))}
      otherSections={otherSections}
    />
  );
}
