import Grid from '@mui/material/Grid';
import { Widget } from '@/components/Widget/Widget';
import type { AccessUser } from '@/server/auth/student-access';
import { StudentTodayWidget } from './widgets/StudentTodayWidget';
import { DueSoonWidget } from './widgets/DueSoonWidget';
import { RecentGradesWidget } from './widgets/RecentGradesWidget';
import { MyCoursesWidget } from './widgets/MyCoursesWidget';
import { AnnouncementsWidget } from './widgets/AnnouncementsWidget';
import { TermAttendanceWidget } from './widgets/TermAttendanceWidget';

/** PRD-16 FR-10–FR-15. */
export function StudentDashboard({ user }: { user: AccessUser }) {
  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 6, lg: 4 }}>
        <Widget title="Today">
          <StudentTodayWidget user={user} />
        </Widget>
      </Grid>
      <Grid size={{ xs: 12, md: 6, lg: 4 }}>
        <Widget title="Due soon">
          <DueSoonWidget user={user} />
        </Widget>
      </Grid>
      <Grid size={{ xs: 12, md: 6, lg: 4 }}>
        <Widget title="Term attendance">
          <TermAttendanceWidget user={user} />
        </Widget>
      </Grid>
      <Grid size={{ xs: 12, lg: 8 }}>
        <Widget title="My courses">
          <MyCoursesWidget user={user} />
        </Widget>
      </Grid>
      <Grid size={{ xs: 12, md: 6, lg: 4 }}>
        <Widget title="Recent grades">
          <RecentGradesWidget user={user} />
        </Widget>
      </Grid>
      <Grid size={{ xs: 12, md: 6, lg: 4 }}>
        <Widget title="Announcements">
          <AnnouncementsWidget />
        </Widget>
      </Grid>
    </Grid>
  );
}
