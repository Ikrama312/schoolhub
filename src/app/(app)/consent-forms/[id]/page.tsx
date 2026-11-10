import Link from 'next/link';
import { notFound } from 'next/navigation';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { requirePageRole } from '@/server/auth/requireRole';
import { get } from '@/server/consent-forms/consent-forms-service';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { MarkdownView } from '@/components/MarkdownView/MarkdownView';
import { ConsentResponseForm } from './ConsentResponseForm';

/** /consent-forms/[id] — read the form; parents respond per child until dueAt (FR-37, FR-38). */
export default async function ConsentFormPage({ params }: { params: { id: string } }) {
  const user = await requirePageRole('ADMIN', 'TEACHER', 'PARENT');
  const form = await get(user, params.id).catch(() => notFound());
  const open = Date.parse(form.dueAt) > Date.now();
  return (
    <>
      <PageHeader
        title={form.title}
        description={`Respond by ${new Date(form.dueAt).toLocaleString()} · from ${form.createdBy.name}`}
        breadcrumbs={[{ label: 'Consent forms', href: '/consent-forms' }, { label: form.title }]}
        actions={
          'counts' in form ? (
            <Button variant="outlined" component={Link} href={`/consent-forms/${form.id}/tracking`}>
              Tracking
            </Button>
          ) : undefined
        }
      />
      <Stack spacing={3} sx={{ maxWidth: 760 }}>
        <Paper variant="outlined" sx={{ p: 3 }}>
          {form.event && (
            <Chip sx={{ mb: 2 }} label={`Event: ${form.event.title}, ${new Date(form.event.startsAt).toLocaleDateString()}`} />
          )}
          <MarkdownView source={form.description} />
        </Paper>
        {'children' in form &&
          form.children.map((c) => (
            <Paper key={c.studentId} variant="outlined" sx={{ p: 3 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                {c.firstName}
              </Typography>
              <ConsentResponseForm formId={form.id} studentId={c.studentId} childName={c.firstName} open={open} initial={c.response} />
            </Paper>
          ))}
      </Stack>
    </>
  );
}
