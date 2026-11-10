import NextLink from 'next/link';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import type { AccessUser } from '@/server/auth/student-access';
import { getTeacherMessages } from '@/server/dashboards/teacher';

/** PRD-16 FR-8: unread conversations; announcements are a PRD-12 dependency gap. */
export async function TeacherMessagesWidget({ user }: { user: AccessUser }) {
  const m = await getTeacherMessages(user);
  return (
    <>
      <Typography variant="body1">
        <Link component={NextLink} href="/messages">
          {m.unreadCount === 0 ? 'No unread conversations' : `${m.unreadCount} unread conversation${m.unreadCount === 1 ? '' : 's'}`}
        </Link>
      </Typography>
      {!m.announcementsAvailable && <EmptyState title="Announcements not available yet" />}
    </>
  );
}
