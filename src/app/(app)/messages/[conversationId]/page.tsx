import { notFound } from 'next/navigation';
import { prisma } from '@/server/db';
import { requirePageUser } from '@/server/auth/requireRole';
import { getParticipation } from '@/server/messaging/access';
import { MessageThread } from '@/components/messaging/MessageThread';

export const dynamic = 'force-dynamic';

/** /messages/[conversationId]: participants only (NFR-1, A7) — everyone else gets the 404 page. */
export default async function ConversationPage({ params }: { params: { conversationId: string } }) {
  const user = await requirePageUser();
  try {
    await getParticipation(user.id, params.conversationId);
  } catch {
    notFound();
  }
  const settings = await prisma.schoolSettings.findUnique({ where: { id: 'singleton' }, select: { timezone: true } });
  return <MessageThread key={params.conversationId} conversationId={params.conversationId} timezone={settings?.timezone ?? 'UTC'} viewerId={user.id} />;
}
