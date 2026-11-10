import { ChartA11y } from '@/components/charts/ChartA11y';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { UpdatedAgo } from '@/components/Widget/Widget';
import { getAttendanceTrend } from '@/server/dashboards/admin';

/** PRD-16 FR-17: last 30 school days, dashed reference line at the alert threshold. */
export async function AttendanceTrendWidget() {
  const { data, computedAt } = await getAttendanceTrend();
  return (
    <>
      {data.xAxis.length === 0 ? <EmptyState title="No attendance recorded yet" /> : <ChartA11y kind="line" chart={data} xLabel="School day" />}
      <UpdatedAgo computedAt={computedAt} />
    </>
  );
}
