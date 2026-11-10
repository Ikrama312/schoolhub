import Typography from '@mui/material/Typography';
import { ChartA11y } from '@/components/charts/ChartA11y';
import { UpdatedAgo } from '@/components/Widget/Widget';
import { getGradeDistribution } from '@/server/dashboards/admin';

/** PRD-16 FR-19: histogram of course percents in 10 % buckets, with average and median. */
export async function GradeDistributionWidget() {
  const { data, computedAt } = await getGradeDistribution();
  const { average, median, ...chart } = data;
  return (
    <>
      <ChartA11y kind="bar" chart={chart} xLabel="Percent band" />
      <Typography variant="body2" color="text.secondary">
        {average === null ? 'No grades this term yet' : `Average ${average} % · Median ${median} %`}
      </Typography>
      <UpdatedAgo computedAt={computedAt} />
    </>
  );
}
