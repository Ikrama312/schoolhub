import { Suspense } from 'react';
import { requirePageRole } from '@/server/auth/requireRole';
import { prisma } from '@/server/db';
import { isBursar } from '@/server/fees/access';
import { listDiscounts, listFeeItems, listPlans } from '@/server/fees/fees-service';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { LoadingSkeleton } from '@/components/LoadingSkeleton/LoadingSkeleton';
import { SetupTabs } from './_components/SetupTabs';

export const dynamic = 'force-dynamic';

/** /admin/fees/setup — any ADMIN reads; write controls only for bursars (FR-6 to FR-10, FR-45). */
export default async function FeeSetupPage() {
  const user = await requirePageRole('ADMIN');
  const year = await prisma.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true, name: true } });
  const yearId = year?.id ?? '__none__';
  const [canWrite, items, plans, discounts, terms, grades, sections] = await Promise.all([
    isBursar(user),
    listFeeItems(),
    listPlans(year ? { academicYearId: year.id } : {}),
    listDiscounts(),
    prisma.term.findMany({ where: { academicYearId: yearId }, orderBy: { order: 'asc' }, select: { id: true, name: true } }),
    prisma.gradeLevel.findMany({ where: { archivedAt: null }, orderBy: { order: 'asc' }, select: { id: true, name: true } }),
    prisma.section.findMany({ where: { academicYearId: yearId }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);
  return (
    <>
      <PageHeader title="Fee setup" breadcrumbs={[{ label: 'Fees', href: '/admin/fees' }, { label: 'Setup' }]} />
      <Suspense fallback={<LoadingSkeleton variant="table" />}>
        <SetupTabs
          data={{
            canWrite,
            currency: items.currency,
            academicYear: year,
            terms,
            grades,
            sections,
            items: items.items,
            plans: plans.plans,
            discounts: discounts.discounts,
          }}
        />
      </Suspense>
    </>
  );
}
