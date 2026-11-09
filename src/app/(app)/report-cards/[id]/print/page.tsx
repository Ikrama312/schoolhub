import { notFound } from 'next/navigation';
import Stack from '@mui/material/Stack';
import { requirePageUser } from '@/server/auth/requireRole';
import { AppError } from '@/server/http';
import { getReportCard, type ReportCardDto } from '@/server/report-cards/report-card-service';
import { PrintButton } from '@/components/report-cards/PrintButton';
import { ReportCardDocument, ReportCardPrintStyles } from '@/components/report-cards/ReportCardDocument';

export const dynamic = 'force-dynamic';

/** /report-cards/:id/print — PRD-11 FR-35. Same access as GET /api/report-cards/:id (FR-37). */
export default async function ReportCardPrintPage({ params }: { params: { id: string } }) {
  const user = await requirePageUser();
  let card: ReportCardDto;
  try {
    card = await getReportCard(user, params.id);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  return (
    <>
      <ReportCardPrintStyles />
      <Stack direction="row" sx={{ justifyContent: 'flex-end', mb: 2 }} data-print-hide>
        <PrintButton />
      </Stack>
      <ReportCardDocument snapshot={card.snapshot} homeroomComment={card.homeroomComment} principalComment={card.principalComment} draft={card.status === 'DRAFT'} />
    </>
  );
}
