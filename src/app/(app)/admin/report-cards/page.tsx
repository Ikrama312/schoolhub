import { prisma } from '@/server/db';
import { requirePageRole } from '@/server/auth/requireRole';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { ReportCardsAdminClient } from './ReportCardsAdminClient';

export const dynamic = 'force-dynamic';

/** /admin/report-cards — PRD-11 FR-29, FR-30, FR-34, FR-35. */
export default async function AdminReportCardsPage() {
  await requirePageRole('ADMIN');
  const [terms, gradeLevels, sections] = await Promise.all([
    prisma.term.findMany({ include: { academicYear: { select: { name: true, isCurrent: true } } }, orderBy: [{ academicYear: { startDate: 'desc' } }, { order: 'asc' }] }),
    prisma.gradeLevel.findMany({ where: { archivedAt: null }, orderBy: { order: 'asc' }, select: { id: true, name: true } }),
    prisma.section.findMany({ select: { id: true, name: true, academicYearId: true, gradeLevelId: true }, orderBy: { name: 'asc' } }),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const current = terms.find((t) => t.academicYear.isCurrent && t.startDate.toISOString().slice(0, 10) <= today && today <= t.endDate.toISOString().slice(0, 10)) ?? terms.find((t) => t.academicYear.isCurrent) ?? terms[0];
  return (
    <>
      <PageHeader title="Report cards" description="Generate, review, publish and print term report cards." />
      <ReportCardsAdminClient
        terms={terms.map((t) => ({ id: t.id, name: `${t.name} (${t.academicYear.name})`, academicYearId: t.academicYearId }))}
        gradeLevels={gradeLevels}
        sections={sections}
        defaultTermId={current?.id ?? ''}
      />
    </>
  );
}
