import { requirePageRole } from '@/server/auth/requireRole';
import { getMyFees } from '@/server/fees/reports';
import { feeSettings } from '@/server/fees/ledger';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { ParentFeesView } from './_components/ParentFeesView';

export const dynamic = 'force-dynamic';

/** /fees — PARENT only; same data as GET /api/me/fees (FR-39, FR-41). */
export default async function ParentFeesPage({ searchParams }: { searchParams: { invoice?: string } }) {
  const user = await requirePageRole('PARENT');
  const [data, { tz }] = await Promise.all([getMyFees(user), feeSettings()]);
  return (
    <>
      <PageHeader title="Fees" description="Invoices, balances and receipts for your children." />
      <ParentFeesView data={data} focusInvoiceId={searchParams.invoice} tz={tz} />
    </>
  );
}
