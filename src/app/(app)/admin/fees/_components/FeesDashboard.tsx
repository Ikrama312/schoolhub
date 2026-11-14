import Link from 'next/link';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import { StatCard } from '@/components/StatCard/StatCard';
import { ChartA11y } from '@/components/charts/ChartA11y';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { formatMoney } from '@/lib/money';
import type { getAging, getDashboard } from '@/server/fees/reports';

const BUCKET_LABELS = { current: 'Not yet due', '1-30': '1–30 days', '31-60': '31–60 days', '61-90': '61–90 days', '90+': '90+ days' } as const;

/**
 * PRD-17 FR-42: KPIs, weekly collection trend, aging buckets and the top 10 overdue families.
 * Server component; charts get serialisable props. Number() only at the chart edge (ADR-2).
 */
export function FeesDashboard({
  dashboard: d,
  aging,
  terms,
}: {
  dashboard: Awaited<ReturnType<typeof getDashboard>>;
  aging: Awaited<ReturnType<typeof getAging>>;
  terms: { id: string; name: string }[];
}) {
  const money = (v: string) => formatMoney(v, d.currency);
  const kpis = [
    { label: `Billed${d.termName ? ` · ${d.termName}` : ''}`, value: money(d.kpis.billed) },
    { label: 'Collected', value: money(d.kpis.collected) },
    { label: 'Outstanding', value: money(d.kpis.outstanding) },
    { label: 'Overdue', value: money(d.kpis.overdue) },
    { label: 'Collection rate', value: `${d.kpis.collectionRatePct} %` },
  ];
  const trendTotal = d.trend.reduce((n, w) => n + Number(w.collected), 0);

  return (
    <Stack spacing={3}>
      {terms.length > 1 && (
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }} aria-label="Term">
          {terms.map((t) => (
            <Chip
              key={t.id}
              label={t.name}
              component={Link}
              href={`/admin/fees?termId=${t.id}`}
              clickable
              color={t.id === d.termId ? 'primary' : 'default'}
              variant={t.id === d.termId ? 'filled' : 'outlined'}
            />
          ))}
        </Stack>
      )}
      <Grid container spacing={2}>
        {kpis.map((k) => (
          <Grid key={k.label} size={{ xs: 12, sm: 6, md: 4, lg: 'grow' }}>
            <StatCard label={k.label} value={k.value} />
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="h6" component="h2">
              Weekly collections
            </Typography>
            <ChartA11y
              kind="line"
              xLabel="Week starting"
              chart={{
                summary: `Collections over the last 12 weeks: ${formatMoney(trendTotal.toFixed(2), d.currency)} in total.`,
                xAxis: d.trend.map((w) => w.weekStart.slice(5)),
                series: [{ id: 'collected', label: `Collected (${d.currency})`, data: d.trend.map((w) => Number(w.collected)) }],
              }}
            />
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="h6" component="h2">
                Aging
              </Typography>
              <Button size="small" startIcon={<DownloadOutlinedIcon />} href="/api/fees/export/aging">
                Aging CSV
              </Button>
            </Stack>
            <ChartA11y
              kind="bar"
              xLabel="Days overdue"
              chart={{
                summary: aging.buckets.map((b) => `${BUCKET_LABELS[b.bucket]}: ${money(b.amount)}`).join('; '),
                xAxis: aging.buckets.map((b) => BUCKET_LABELS[b.bucket]),
                series: [{ id: 'balance', label: `Balance (${d.currency})`, data: aging.buckets.map((b) => Number(b.amount)) }],
              }}
            />
          </Paper>
        </Grid>
      </Grid>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
          Top overdue families
        </Typography>
        {aging.topOverdueFamilies.length === 0 ? (
          <EmptyState title="No overdue families" description="Every issued invoice is within its due date or paid." />
        ) : (
          <Table size="small" aria-label="Top overdue families">
            <TableHead>
              <TableRow>
                <TableCell>Primary parent</TableCell>
                <TableCell>Children</TableCell>
                <TableCell align="right">Invoices</TableCell>
                <TableCell>Oldest due</TableCell>
                <TableCell align="right">Overdue</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {aging.topOverdueFamilies.map((f) => (
                <TableRow key={f.parentId}>
                  <TableCell>{f.parentName}</TableCell>
                  <TableCell>{f.children.join(', ')}</TableCell>
                  <TableCell align="right">{f.invoiceCount}</TableCell>
                  <TableCell>{f.oldestDueDate}</TableCell>
                  <TableCell align="right">{money(f.overdue)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>
    </Stack>
  );
}
