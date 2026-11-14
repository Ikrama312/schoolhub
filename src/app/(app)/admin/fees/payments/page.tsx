import { Suspense } from 'react';
import { requirePageRole } from '@/server/auth/requireRole';
import { isBursar } from '@/server/fees/access';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { LoadingSkeleton } from '@/components/LoadingSkeleton/LoadingSkeleton';
import { PaymentsTable } from './_components/PaymentsTable';

export const dynamic = 'force-dynamic';

/** /admin/fees/payments — any ADMIN reads; bursars record (FR-32, FR-44). */
export default async function PaymentsPage() {
  const user = await requirePageRole('ADMIN');
  return (
    <>
      <PageHeader title="Payments" breadcrumbs={[{ label: 'Fees', href: '/admin/fees' }, { label: 'Payments' }]} />
      <Suspense fallback={<LoadingSkeleton variant="table" />}>
        <PaymentsTable canWrite={await isBursar(user)} />
      </Suspense>
    </>
  );
}
