import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import { requirePageUser } from '@/server/auth/requireRole';
import { EmptyState } from '@/components/EmptyState/EmptyState';

/** /messages: the thread pane is empty until a conversation is picked (hidden below 768 px). */
export default async function MessagesPage() {
  await requirePageUser();
  return <EmptyState icon={<ForumOutlinedIcon sx={{ fontSize: 48 }} />} title="Select a conversation" description="Or start a new one with “New message”." />;
}
