import { requirePageUser } from '@/server/auth/requireRole';
import { MessagesLayout } from '@/components/messaging/MessagesLayout';
import { ConversationList } from '@/components/messaging/ConversationList';

export const metadata = { title: 'Messages' };

/** PRD-13 FR-9/NFR-7: inbox shell — list pane + thread pane (children). */
export default async function MessagesShellLayout({ children }: { children: React.ReactNode }) {
  await requirePageUser();
  return <MessagesLayout list={<ConversationList />}>{children}</MessagesLayout>;
}
