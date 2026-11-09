import { notFound } from 'next/navigation';
import { requirePageUser } from '@/server/auth/requireRole';
import { AppError } from '@/server/http';
import { getReportCard, type ReportCardDto } from '@/server/report-cards/report-card-service';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { ReportCardReviewClient } from './ReportCardReviewClient';

export const dynamic = 'force-dynamic';

/** /report-cards/:id — PRD-11 FR-32 review page. Field permissions come from the service. */
export default async function ReportCardReviewPage({ params }: { params: { id: string } }) {
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
      <PageHeader title={`Report card — ${card.snapshot.student.name}`} description={`${card.snapshot.term.name}, ${card.snapshot.term.academicYear}`} />
      <ReportCardReviewClient initial={JSON.parse(JSON.stringify(card))} />
    </>
  );
}
