import { notFound, redirect } from 'next/navigation';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { requirePageRole } from '@/server/auth/requireRole';
import { AppError } from '@/server/http';
import { listPrintable } from '@/server/report-cards/report-card-service';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { PrintButton } from '@/components/report-cards/PrintButton';
import { ReportCardDocument, ReportCardPrintStyles } from '@/components/report-cards/ReportCardDocument';

export const dynamic = 'force-dynamic';

/** /report-cards/print?termId=&gradeLevelId=&sectionId= — bulk "Print all", PUBLISHED cards only (FR-35). */
export default async function BulkPrintPage({ searchParams }: { searchParams: { termId?: string; gradeLevelId?: string; sectionId?: string } }) {
  const user = await requirePageRole('ADMIN', 'TEACHER');
  if (!searchParams.termId) notFound();
  let cards: Awaited<ReturnType<typeof listPrintable>>;
  try {
    cards = await listPrintable(user, { termId: searchParams.termId, gradeLevelId: searchParams.gradeLevelId || undefined, sectionId: searchParams.sectionId || undefined });
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    if (error instanceof AppError && error.code === 'FORBIDDEN') redirect('/forbidden');
    throw error;
  }
  if (!cards.length) return <EmptyState title="Nothing to print" description="No published report cards match these filters." />;
  return (
    <>
      <ReportCardPrintStyles />
      <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }} data-print-hide>
        <Typography variant="body2">{cards.length} published report card{cards.length === 1 ? '' : 's'}</Typography>
        <PrintButton label="Print all" />
      </Stack>
      {cards.map((c) => (
        <ReportCardDocument key={c.id} snapshot={c.snapshot} homeroomComment={c.homeroomComment} principalComment={c.principalComment} />
      ))}
    </>
  );
}
