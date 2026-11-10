import { ok, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { getGreeting, getRiskSummary } from '@/server/dashboards/insights';
import {
  getAttendanceTrend,
  getEnrollmentByGrade,
  getGradeDistribution,
  getKpis,
  getRecentActivity,
  getSafeguardingCount,
  getUpcomingEvents,
} from '@/server/dashboards/admin';

export const dynamic = 'force-dynamic';

/** GET /api/dashboard/admin — admin widget data; openSafeguardingReports only for leads, never cached (FR-41, FR-16). */
export const GET = withHandler(async () => {
  const user = await requireRole('ADMIN');
  const [greeting, kpis, safeguarding, attendanceTrend, enrollmentByGrade, gradeDistribution, riskSummary, upcomingEvents, recentActivity] =
    await Promise.all([
      getGreeting(user.firstName),
      getKpis(),
      getSafeguardingCount(user),
      getAttendanceTrend(),
      getEnrollmentByGrade(),
      getGradeDistribution(),
      getRiskSummary(user),
      getUpcomingEvents(),
      getRecentActivity(),
    ]);
  return ok({
    greeting,
    kpis: safeguarding === null ? kpis : { ...kpis, openSafeguardingReports: safeguarding },
    attendanceTrend,
    enrollmentByGrade,
    gradeDistribution,
    riskSummary,
    upcomingEvents,
    recentActivity,
  });
});
