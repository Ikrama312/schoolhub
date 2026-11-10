import { ChartA11y } from '@/components/charts/ChartA11y';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { UpdatedAgo } from '@/components/Widget/Widget';
import { getEnrollmentByGrade } from '@/server/dashboards/admin';

/** PRD-16 FR-18: active students per grade level, stacked by gender (legend labels each series). */
export async function EnrollmentByGradeWidget() {
  const { data, computedAt } = await getEnrollmentByGrade();
  return (
    <>
      {data.series.length === 0 ? <EmptyState title="No active students" /> : <ChartA11y kind="bar" chart={data} xLabel="Grade level" />}
      <UpdatedAgo computedAt={computedAt} />
    </>
  );
}
