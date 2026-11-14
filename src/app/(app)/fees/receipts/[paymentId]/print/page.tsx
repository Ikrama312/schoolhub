import { notFound } from 'next/navigation';
import Stack from '@mui/material/Stack';
import { requirePageRole } from '@/server/auth/requireRole';
import { AppError } from '@/server/http';
import { prisma } from '@/server/db';
import { getPayment } from '@/server/fees/fees-service';
import { FeePrintStyles } from '@/components/fees/InvoiceDocument';
import { ReceiptDocument } from '@/components/fees/ReceiptDocument';
import { PrintButton } from '@/components/fees/PrintButton';

export const dynamic = 'force-dynamic';

/** /fees/receipts/[paymentId]/print — ADMIN or a PARENT of an allocated invoice's student (FR-34, NFR-4). */
export default async function ReceiptPrintPage({ params }: { params: { paymentId: string } }) {
  const user = await requirePageRole('ADMIN', 'PARENT');
  const payment = await getPayment(user, params.paymentId).catch((e) => {
    if (e instanceof AppError && e.code === 'NOT_FOUND') notFound();
    throw e;
  });
  const school = await prisma.schoolSettings.findUniqueOrThrow({ where: { id: 'singleton' } });
  return (
    <>
      <FeePrintStyles />
      <Stack direction="row" data-print-hide sx={{ justifyContent: 'flex-end', mb: 2, maxWidth: 800, mx: 'auto' }}>
        <PrintButton />
      </Stack>
      <ReceiptDocument payment={payment} school={school} tz={school.timezone} />
    </>
  );
}
