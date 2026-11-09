import NextLink from 'next/link';
import { notFound, redirect } from 'next/navigation';
import Chip from '@mui/material/Chip';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';
import { prisma } from '@/server/db';
import { requirePageUser } from '@/server/auth/requireRole';
import { AppError } from '@/server/http';
import { listForStudent } from '@/server/report-cards/report-card-service';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { EmptyState } from '@/components/EmptyState/EmptyState';

export const dynamic = 'force-dynamic';

/** Student "Report cards" tab — PRD-11 FR-36. Published only for students/parents (in the service). */
export default async function StudentReportCardsPage({ params }: { params: { id: string } }) {
  const user = await requirePageUser();
  let cards: Awaited<ReturnType<typeof listForStudent>>;
  try {
    cards = await listForStudent(user, params.id);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    if (error instanceof AppError && error.code === 'FORBIDDEN') redirect('/forbidden');
    throw error;
  }
  const student = await prisma.user.findUnique({ where: { id: params.id }, select: { firstName: true, lastName: true } });
  if (!student) notFound();
  return (
    <>
      <PageHeader title="Report cards" description={`${student.firstName} ${student.lastName}`} />
      {cards.length === 0 ? (
        <EmptyState title="No report cards yet" description="Report cards appear here once the school publishes them." />
      ) : (
        <Paper variant="outlined">
          <List disablePadding>
            {cards.map((c) => (
              <ListItemButton key={c.id} component={NextLink} href={`/report-cards/${c.id}/print`} divider>
                <ListItemText primary={`${c.term.name} — ${c.term.academicYear}`} secondary={c.publishedAt ? `Published ${c.publishedAt.slice(0, 10)}` : 'Not published'} />
                <Chip size="small" label={c.status === 'PUBLISHED' ? 'Published' : 'Draft'} color={c.status === 'PUBLISHED' ? 'success' : 'warning'} />
              </ListItemButton>
            ))}
          </List>
        </Paper>
      )}
    </>
  );
}
