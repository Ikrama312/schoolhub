import { ok, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { getGreeting, getTopAtRisk } from '@/server/dashboards/insights';
import { getTeacherMessages, getToGrade, getTodaysClasses, getUpcomingDeadlines } from '@/server/dashboards/teacher';

export const dynamic = 'force-dynamic';

/** GET /api/dashboard/teacher — every teacher widget payload (FR-41). */
export const GET = withHandler(async () => {
  const user = await requireRole('TEACHER');
  const [greeting, todaysClasses, toGrade, upcomingDeadlines, atRisk, messages] = await Promise.all([
    getGreeting(user.firstName),
    getTodaysClasses(user),
    getToGrade(user),
    getUpcomingDeadlines(user),
    getTopAtRisk(user, 5),
    getTeacherMessages(user),
  ]);
  return ok({ greeting, todaysClasses, toGrade, upcomingDeadlines, atRisk, messages });
});
