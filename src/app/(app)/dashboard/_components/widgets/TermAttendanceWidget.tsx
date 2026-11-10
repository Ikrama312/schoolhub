import Typography from '@mui/material/Typography';
import { ChartA11y } from '@/components/charts/ChartA11y';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import type { AccessUser } from '@/server/auth/student-access';
import { getTermAttendance } from '@/server/dashboards/student';

/** PRD-16 FR-15: term attendance rate as a Gauge with an accessible summary. */
export async function TermAttendanceWidget({ user }: { user: AccessUser }) {
  const a = await getTermAttendance(user);
  if (a.rate === null) return <EmptyState title="No attendance recorded this term" />;
  const summary = `Term attendance ${a.rate} %: present ${a.present} of ${a.total} records`;
  return (
    <>
      <ChartA11y kind="gauge" value={a.rate} label="Term attendance" summary={summary} height={180} />
      <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
        Present {a.present} of {a.total}
      </Typography>
    </>
  );
}
