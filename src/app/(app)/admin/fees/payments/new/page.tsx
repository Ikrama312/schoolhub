import { redirect } from 'next/navigation';
import { requirePageRole } from '@/server/auth/requireRole';
import { isBursar } from '@/server/fees/access';
import { listPayerOptions } from '@/server/fees/fees-service';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { RecordPaymentForm } from './_components/RecordPaymentForm';

export const dynamic = 'force-dynamic';

/** /admin/fees/payments/new — bursar only (FR-26 to FR-30, FR-45). ?parentId= preselects the family. */
export default async function RecordPaymentPage({ searchParams }: { searchParams: { parentId?: string } }) {
  const user = await requirePageRole('ADMIN');
  if (!(await isBursar(user))) redirect('/forbidden');
  return (
    <>
      <PageHeader
        title="Record payment"
        breadcrumbs={[{ label: 'Fees', href: '/admin/fees' }, { label: 'Payments', href: '/admin/fees/payments' }, { label: 'Record' }]}
      />
      <RecordPaymentForm payers={await listPayerOptions()} initialParentId={searchParams.parentId} />
    </>
  );
}
