import { redirect } from 'next/navigation';
import Alert from '@mui/material/Alert';
import { requirePageRole } from '@/server/auth/requireRole';
import { prisma } from '@/server/db';
import { isBursar } from '@/server/fees/access';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { GenerateInvoices } from './_components/GenerateInvoices';

export const dynamic = 'force-dynamic';

/** /admin/fees/invoices/generate — bursar only (FR-12 to FR-14, FR-45). */
export default async function GenerateInvoicesPage() {
  const user = await requirePageRole('ADMIN');
  if (!(await isBursar(user))) redirect('/forbidden');
  const year = await prisma.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true, name: true } });
  const [terms, grades] = await Promise.all([
    prisma.term.findMany({ where: { academicYearId: year?.id ?? '__none__' }, orderBy: { order: 'asc' }, select: { id: true, name: true } }),
    prisma.gradeLevel.findMany({ where: { archivedAt: null }, orderBy: { order: 'asc' }, select: { id: true, name: true } }),
  ]);
  return (
    <>
      <PageHeader
        title="Generate invoices"
        description={year ? `Academic year ${year.name}` : undefined}
        breadcrumbs={[{ label: 'Fees', href: '/admin/fees' }, { label: 'Invoices', href: '/admin/fees/invoices' }, { label: 'Generate' }]}
      />
      {year ? <GenerateInvoices academicYearId={year.id} terms={terms} grades={grades} /> : <Alert severity="warning">Set a current academic year first.</Alert>}
    </>
  );
}
