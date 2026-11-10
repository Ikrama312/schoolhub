import { ok, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { getGreeting } from '@/server/dashboards/insights';
import { ANNOUNCEMENTS_AVAILABLE, latestAnnouncements } from '@/server/dashboards/announcements';
import { getDueSoon, getMyCourses, getRecentGrades, getStudentToday, getTermAttendance } from '@/server/dashboards/student';

export const dynamic = 'force-dynamic';

/** GET /api/dashboard/student — the caller's own widget data, uncached (FR-41). */
export const GET = withHandler(async () => {
  const user = await requireRole('STUDENT');
  const [greeting, today, dueSoon, recentGrades, courses, announcements, termAttendance] = await Promise.all([
    getGreeting(user.firstName),
    getStudentToday(user),
    getDueSoon(user),
    getRecentGrades(user),
    getMyCourses(user),
    latestAnnouncements(),
    getTermAttendance(user),
  ]);
  return ok({ greeting, today, dueSoon, recentGrades, courses, announcementsAvailable: ANNOUNCEMENTS_AVAILABLE, announcements, termAttendance });
});
