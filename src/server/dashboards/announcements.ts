/**
 * PRD-16 dependency gap on PRD-12 (FR-8, FR-14, FR-38): there is no Announcement model yet.
 * This one flag hides the "New announcement" quick action, shows EmptyState in the
 * announcement widgets and adds a note to the engagement report. Flip it when PRD-12 lands.
 */
export const ANNOUNCEMENTS_AVAILABLE = false;

export async function latestAnnouncements(): Promise<never[]> {
  return [];
}
