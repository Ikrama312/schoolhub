import NextLink from 'next/link';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { UpdatedAgo } from '@/components/Widget/Widget';
import type { AccessUser } from '@/server/auth/student-access';
import { getRiskSummary } from '@/server/dashboards/insights';

const REASON_LABELS = { ATTENDANCE: 'Attendance', GRADES: 'Grades', MISSING: 'Missing work' } as const;

/** PRD-16 FR-20: counts by level and reason, linking to the full list. */
export async function RiskSummaryWidget({ user }: { user: AccessUser }) {
  const { data, computedAt } = await getRiskSummary(user);
  return (
    <>
      <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
        <Chip color="error" label={`High: ${data.byLevel.HIGH}`} />
        <Chip color="warning" label={`Medium: ${data.byLevel.MEDIUM}`} />
      </Stack>
      <Typography variant="body2" color="text.secondary">
        By reason
      </Typography>
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', mt: 0.5 }}>
        {(Object.keys(REASON_LABELS) as (keyof typeof REASON_LABELS)[]).map((k) => (
          <Chip key={k} size="small" variant="outlined" label={`${REASON_LABELS[k]}: ${data.byReason[k]}`} />
        ))}
      </Stack>
      <Link component={NextLink} href="/insights/at-risk" sx={{ display: 'inline-block', mt: 1 }}>
        View all at-risk students
      </Link>
      <UpdatedAgo computedAt={computedAt} />
    </>
  );
}
