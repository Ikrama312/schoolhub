import { Suspense } from 'react';
import { requirePageRole } from '@/server/auth/requireRole';
import { prisma } from '@/server/db';
import { isBursar } from '@/server/fees/access';
import { feeSettings } from '@/server/fees/ledger';
import { listFeeItems } from '@/server/fees/fees-service';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { LoadingSkeleton } from '@/components/LoadingSkeleton/LoadingSkeleton';
import { InvoicesTable } from './_components/InvoicesTable';

export const dynamic = 'force-dynamic';

/** /admin/fees/invoices — any ADMIN reads; bursars also get the write buttons (FR-17, FR-18, FR-23, FR-45). */
export default async function InvoicesPage() {
  const user = await requirePageRole('ADMIN');
  const year = await prisma.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
  const [canWrite, terms, grades, sections, { items }, { currency }] = await Promise.all([
    isBursar(user),
    prisma.term.findMany({ where: { academicYearId: year?.id ?? '__none__' }, orderBy: { order: 'asc' }, select: { id: true, name: true } }),
    prisma.gradeLevel.findMany({ where: { archivedAt: null }, orderBy: { order: 'asc' }, select: { id: true, name: true } }),
    prisma.section.findMany({ where: { academicYearId: year?.id ?? '__none__' }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    listFeeItems(),
    feeSettings(),
  ]);
  return (
    <>
      <PageHeader title="Invoices" breadcrumbs={[{ label: 'Fees', href: '/admin/fees' }, { label: 'Invoices' }]} />
      <Suspense fallback={<LoadingSkeleton variant="table" />}>
        <InvoicesTable
          terms={terms}
          grades={grades}
          sections={sections}
          canWrite={canWrite && Boolean(year)}
          manualOptions={{ academicYearId: year?.id ?? '', terms, feeItems: items, currency }}
        />
      </Suspense>
    </>
  );
}
