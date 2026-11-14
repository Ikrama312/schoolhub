import Grid from '@mui/material/Grid';
import { StatCard } from '@/components/StatCard/StatCard';
import { UpdatedAgo } from '@/components/Widget/Widget';
import type { AccessUser } from '@/server/auth/student-access';
import { getKpis, getSafeguardingCount } from '@/server/dashboards/admin';
import { formatMoney } from '@/lib/money';

/** PRD-16 FR-16. The safeguarding card is a separate, uncached call and only for leads. */
export async function KpiRowWidget({ user }: { user: AccessUser }) {
  const [{ data: k, computedAt }, safeguarding] = await Promise.all([getKpis(), getSafeguardingCount(user)]);
  const delta = k.attendanceRateDelta;
  const cards = [
    { label: 'Active students', value: k.activeStudents },
    { label: 'Active teachers', value: k.activeTeachers },
    {
      label: "Today's attendance",
      value: k.attendanceRateToday === null ? '—' : `${k.attendanceRateToday} %`,
      delta:
        delta === null
          ? undefined
          : {
              value: `${delta > 0 ? '+' : ''}${delta} pts vs last week`,
              direction: delta > 0 ? ('up' as const) : delta < 0 ? ('down' as const) : ('flat' as const),
            },
    },
    { label: 'Registers missing today', value: k.registersMissingToday },
    { label: 'Pending absence notes', value: k.pendingAbsenceNotes },
    // PRD-17 FR-43
    { label: 'Outstanding fees', value: formatMoney(k.outstandingFees.amount, k.outstandingFees.currency) },
    ...(safeguarding === null ? [] : [{ label: 'Open safeguarding reports', value: safeguarding }]),
  ];
  return (
    <>
      <Grid container spacing={2}>
        {cards.map((c) => (
          <Grid key={c.label} size={{ xs: 12, sm: 6, md: 4, xl: 2 }}>
            <StatCard {...c} />
          </Grid>
        ))}
      </Grid>
      <UpdatedAgo computedAt={computedAt} />
    </>
  );
}
