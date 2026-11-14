import Link from 'next/link';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import { requirePageRole } from '@/server/auth/requireRole';
import { prisma } from '@/server/db';
import { getAging, getDashboard } from '@/server/fees/reports';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { FeesDashboard } from './_components/FeesDashboard';

export const dynamic = 'force-dynamic';

/** /admin/fees — fees dashboard, any ADMIN (FR-42, FR-44). */
export default async function FeesDashboardPage({ searchParams }: { searchParams: { termId?: string } }) {
  await requirePageRole('ADMIN');
  const [dashboard, aging, terms] = await Promise.all([
    getDashboard(searchParams.termId || undefined),
    getAging(),
    prisma.term.findMany({ where: { academicYear: { isCurrent: true } }, orderBy: { order: 'asc' }, select: { id: true, name: true } }),
  ]);
  return (
    <>
      <PageHeader
        title="Fees"
        description="Billing and collections at a glance."
        actions={
          <Stack direction="row" spacing={1}>
            <Button component={Link} href="/admin/fees/invoices">
              Invoices
            </Button>
            <Button component={Link} href="/admin/fees/payments">
              Payments
            </Button>
            <Button component={Link} href="/admin/fees/setup">
              Setup
            </Button>
          </Stack>
        }
      />
      <FeesDashboard dashboard={dashboard} aging={aging} terms={terms} />
    </>
  );
}
