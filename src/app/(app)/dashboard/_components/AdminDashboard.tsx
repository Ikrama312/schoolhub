import Grid from '@mui/material/Grid';
import { Widget } from '@/components/Widget/Widget';
import type { AccessUser } from '@/server/auth/student-access';
import { KpiRowWidget } from './widgets/KpiRowWidget';
import { AttendanceTrendWidget } from './widgets/AttendanceTrendWidget';
import { EnrollmentByGradeWidget } from './widgets/EnrollmentByGradeWidget';
import { GradeDistributionWidget } from './widgets/GradeDistributionWidget';
import { RiskSummaryWidget } from './widgets/RiskSummaryWidget';
import { UpcomingEventsWidget } from './widgets/UpcomingEventsWidget';
import { RecentActivityWidget } from './widgets/RecentActivityWidget';

/** PRD-16 FR-16–FR-22. The RefreshButton lives in the greeting header (page.tsx). */
export function AdminDashboard({ user }: { user: AccessUser }) {
  return (
    <Grid container spacing={2}>
      <Grid size={12}>
        <Widget title="Key figures">
          <KpiRowWidget user={user} />
        </Widget>
      </Grid>
      <Grid size={{ xs: 12, lg: 8 }}>
        <Widget title="Attendance trend">
          <AttendanceTrendWidget />
        </Widget>
      </Grid>
      <Grid size={{ xs: 12, md: 6, lg: 4 }}>
        <Widget title="At-risk students">
          <RiskSummaryWidget user={user} />
        </Widget>
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <Widget title="Enrollment by grade">
          <EnrollmentByGradeWidget />
        </Widget>
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <Widget title="Grade distribution">
          <GradeDistributionWidget />
        </Widget>
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <Widget title="Upcoming events">
          <UpcomingEventsWidget />
        </Widget>
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <Widget title="Recent activity">
          <RecentActivityWidget />
        </Widget>
      </Grid>
    </Grid>
  );
}
