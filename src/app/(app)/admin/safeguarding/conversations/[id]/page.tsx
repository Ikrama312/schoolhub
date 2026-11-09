import { notFound } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import { requirePageSafeguardingLead } from '@/server/messaging/access';
import { getConversationForSafeguarding } from '@/server/messaging/safeguarding';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { SafeguardingThreadView } from '@/components/messaging/SafeguardingConversations';

export const dynamic = 'force-dynamic';

/** Read-only safeguarding view (FR-24, FR-25): goes through the service so every visit is audited. */
export default async function SafeguardingConversationPage({ params }: { params: { id: string } }) {
  const lead = await requirePageSafeguardingLead();
  const data = await getConversationForSafeguarding(lead, params.id).catch((e) => {
    if (e instanceof AppError && e.code === 'NOT_FOUND') notFound();
    throw e;
  });
  const settings = await prisma.schoolSettings.findUnique({ where: { id: 'singleton' }, select: { timezone: true } });
  const { conversation, messages } = data;
  return (
    <>
      <PageHeader
        title={conversation.subject ?? 'Conversation'}
        breadcrumbs={[{ label: 'Safeguarding', href: '/admin/safeguarding?tab=conversations' }, { label: 'Conversation' }]}
      />
      <Alert severity="info" sx={{ mb: 2 }}>
        Read-only. Deleted messages and earlier versions of edited messages are shown. This view has been recorded in the audit log.
      </Alert>
      <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', rowGap: 1 }}>
        {conversation.participants.map((p) => (
          <Chip key={p.id} variant="outlined" label={`${p.name} · ${p.role}${p.leftAt ? ' (left)' : ''}`} />
        ))}
      </Stack>
      <SafeguardingThreadView messages={messages} timezone={settings?.timezone ?? 'UTC'} />
    </>
  );
}
