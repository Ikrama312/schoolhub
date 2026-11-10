import { EmptyState } from '@/components/EmptyState/EmptyState';
import { ANNOUNCEMENTS_AVAILABLE, latestAnnouncements } from '@/server/dashboards/announcements';

/** PRD-16 FR-14: PRD-12 dependency gap; shows EmptyState until announcements exist. */
export async function AnnouncementsWidget() {
  const items = await latestAnnouncements();
  if (!ANNOUNCEMENTS_AVAILABLE || !items.length) return <EmptyState title="Announcements not available yet" />;
  return null;
}
