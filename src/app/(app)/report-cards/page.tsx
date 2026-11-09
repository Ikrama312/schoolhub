import NextLink from 'next/link';
import { redirect } from 'next/navigation';
import Chip from '@mui/material/Chip';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import { prisma } from '@/server/db';
import { requirePageRole } from '@/server/auth/requireRole';
import { listReportCards } from '@/server/report-cards/report-card-service';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { EmptyState } from '@/components/EmptyState/EmptyState';

export const dynamic = 'force-dynamic';

const STATUS = { NOT_GENERATED: 'Not generated', DRAFT: 'Draft', PUBLISHED: 'Published' } as const;

/** /report-cards — PRD-11 FR-33: a homeroom teacher's section cards for the selected term. */
export default async function HomeroomReportCardsPage({ searchParams }: { searchParams: { termId?: string } }) {
  const user = await requirePageRole('TEACHER', 'ADMIN');
  if (user.role === 'ADMIN') redirect('/admin/report-cards');
  const terms = await prisma.term.findMany({ where: { academicYear: { isCurrent: true } }, orderBy: { order: 'asc' } });
  const today = new Date().toISOString().slice(0, 10);
  const term =
    terms.find((t) => t.id === searchParams.termId) ??
    terms.find((t) => t.startDate.toISOString().slice(0, 10) <= today && today <= t.endDate.toISOString().slice(0, 10)) ??
    terms[0];
  if (!term) return <EmptyState title="No terms" description="The current academic year has no terms yet." />;
  const rows = await listReportCards(user, { termId: term.id });

  return (
    <>
      <PageHeader title="Report cards" description="Your homeroom students. Open a draft to write the homeroom comment." />
      <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
        {terms.map((t) => (
          <Chip key={t.id} label={t.name} component={NextLink} href={`/report-cards?termId=${t.id}`} clickable color={t.id === term.id ? 'primary' : 'default'} />
        ))}
      </Stack>
      {rows.length === 0 ? (
        <EmptyState title="No homeroom students" description="You are not the homeroom teacher of a section this year." />
      ) : (
        <Paper variant="outlined">
          <List disablePadding>
            {rows.map((r) => {
              const secondary = [r.student.section.name, ...r.warningText].join(' · ');
              const label = `${r.student.lastName}, ${r.student.firstName}`;
              const chip = <Chip size="small" label={STATUS[r.status]} color={r.status === 'PUBLISHED' ? 'success' : r.status === 'DRAFT' ? 'warning' : 'default'} />;
              return r.reportCard ? (
                <ListItemButton key={r.student.id} component={NextLink} href={`/report-cards/${r.reportCard.id}`} divider>
                  <ListItemText primary={label} secondary={secondary} />
                  {chip}
                </ListItemButton>
              ) : (
                <ListItemButton key={r.student.id} disabled divider>
                  <ListItemText primary={label} secondary={secondary} />
                  {chip}
                </ListItemButton>
              );
            })}
          </List>
        </Paper>
      )}
    </>
  );
}
