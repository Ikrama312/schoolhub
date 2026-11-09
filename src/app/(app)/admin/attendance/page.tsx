import Box from '@mui/material/Box';
import { requirePageRole } from '@/server/auth/requireRole';
import { prisma } from '@/server/db';
import { getSchoolSettings } from '@/server/services/settings';
import { getAttendanceSettings, getBelowThreshold, getOverview } from '@/server/attendance/attendance-service';
import { schoolToday } from '@/server/attendance/attendance-rules';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { AdminAttendanceClient } from './AdminAttendanceClient';

export const dynamic = 'force-dynamic';

/** /admin/attendance — ADMIN (FR-5, FR-30 to FR-33). */
export default async function AdminAttendancePage() {
  await requirePageRole('ADMIN');
  const { timezone } = await getSchoolSettings();
  const today = schoolToday(new Date(), timezone);
  const current = { academicYear: { isCurrent: true } };
  const [overview, below, settings, gradeLevels, sections, courses] = await Promise.all([
    getOverview(),
    getBelowThreshold(),
    getAttendanceSettings(),
    prisma.gradeLevel.findMany({ where: { archivedAt: null }, select: { id: true, name: true }, orderBy: { order: 'asc' } }),
    prisma.section.findMany({ where: current, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.course.findMany({ where: { ...current, archivedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);

  return (
    <Box>
      <PageHeader title="Attendance" description="Today's registers, reports and settings" />
      <AdminAttendanceClient
        overview={overview}
        below={below}
        settings={settings}
        options={{ gradeLevels, sections, courses }}
        today={today}
        monthStart={`${today.slice(0, 8)}01`}
      />
    </Box>
  );
}
