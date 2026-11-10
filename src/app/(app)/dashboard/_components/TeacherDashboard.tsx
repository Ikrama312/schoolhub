import Grid from '@mui/material/Grid';
import { Widget } from '@/components/Widget/Widget';
import type { AccessUser } from '@/server/auth/student-access';
import { TodaysClassesWidget } from './widgets/TodaysClassesWidget';
import { ToGradeWidget } from './widgets/ToGradeWidget';
import { UpcomingDeadlinesWidget } from './widgets/UpcomingDeadlinesWidget';
import { AtRiskWidget } from './widgets/AtRiskWidget';
import { TeacherMessagesWidget } from './widgets/TeacherMessagesWidget';
import { QuickActionsWidget } from './widgets/QuickActionsWidget';

/** PRD-16 FR-4–FR-9: each widget streams independently inside <Widget>. */
export function TeacherDashboard({ user }: { user: AccessUser }) {
  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, lg: 8 }}>
        <Widget title="Today's classes">
          <TodaysClassesWidget user={user} />
        </Widget>
      </Grid>
      <Grid size={{ xs: 12, md: 6, lg: 4 }}>
        <Widget title="To grade">
          <ToGradeWidget user={user} />
        </Widget>
      </Grid>
      <Grid size={{ xs: 12, md: 6, lg: 4 }}>
        <Widget title="Upcoming deadlines">
          <UpcomingDeadlinesWidget user={user} />
        </Widget>
      </Grid>
      <Grid size={{ xs: 12, md: 6, lg: 4 }}>
        <Widget title="At-risk students">
          <AtRiskWidget user={user} />
        </Widget>
      </Grid>
      <Grid size={{ xs: 12, md: 6, lg: 4 }}>
        <Widget title="Messages">
          <TeacherMessagesWidget user={user} />
        </Widget>
      </Grid>
      <Grid size={{ xs: 12, md: 6, lg: 4 }}>
        <Widget title="Quick actions">
          <QuickActionsWidget user={user} />
        </Widget>
      </Grid>
    </Grid>
  );
}
