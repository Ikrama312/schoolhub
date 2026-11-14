import Link from 'next/link';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
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
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { InvoiceStatusChip } from '@/components/fees/InvoiceStatusChip';
import { formatMoney } from '@/lib/money';
import { formatInSchoolTz } from '@/lib/dates';
import { PAYMENT_METHOD_LABELS } from '@/lib/validators/fees';
import type { getMyFees } from '@/server/fees/reports';

/** PRD-17 FR-39: summary, invoices across children, payment history and payment instructions. */
export function ParentFeesView({
  data: d,
  focusInvoiceId,
  tz,
}: {
  data: Awaited<ReturnType<typeof getMyFees>>;
  focusInvoiceId?: string;
  tz: string;
}) {
  const money = (v: string) => formatMoney(v, d.currency);
  const hasOverdue = d.summary.overdue !== '0.00';

  return (
    <Stack spacing={3}>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="body2" color="text.secondary">
                Total outstanding
              </Typography>
              <Typography variant="h4" component="p" data-testid="fees-outstanding">
                {money(d.summary.outstanding)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="body2" color="text.secondary">
                Next due date
              </Typography>
              <Typography variant="h4" component="p">
                {d.summary.nextDueDate ?? '—'}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="body2" color="text.secondary">
                Overdue
              </Typography>
              <Typography variant="h4" component="p" color={hasOverdue ? 'error' : 'text.primary'}>
                {money(d.summary.overdue)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {d.children.length > 1 && (
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
          {d.children.map((c) => (
            <Chip key={c.id} label={`${c.name}: ${money(c.outstanding)}`} variant="outlined" />
          ))}
        </Stack>
      )}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
          Invoices
        </Typography>
        {d.invoices.length === 0 ? (
          <EmptyState title="No invoices yet" description="Invoices for your children will appear here." />
        ) : (
          <Table size="small" aria-label="Invoices">
            <TableHead>
              <TableRow>
                <TableCell>Invoice</TableCell>
                <TableCell>Student</TableCell>
                <TableCell>Term</TableCell>
                <TableCell>Due</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Total</TableCell>
                <TableCell align="right">Balance</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {d.invoices.map((inv) => (
                <TableRow
                  key={inv.id}
                  id={`invoice-${inv.id}`}
                  selected={inv.id === focusInvoiceId}
                  sx={inv.status === 'VOID' ? { '& td': { color: 'text.disabled' } } : undefined}
                >
                  <TableCell>{inv.number}</TableCell>
                  <TableCell>{inv.studentName}</TableCell>
                  <TableCell>{inv.termName ?? 'Annual'}</TableCell>
                  <TableCell>{inv.dueDate}</TableCell>
                  <TableCell>
                    <InvoiceStatusChip status={inv.status} />
                  </TableCell>
                  <TableCell align="right">{money(inv.total)}</TableCell>
                  <TableCell align="right">{money(inv.balance)}</TableCell>
                  <TableCell align="right">
                    <Button size="small" component={Link} href={`/fees/invoices/${inv.id}/print`}>
                      View / print
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
          Payment history
        </Typography>
        {d.payments.length === 0 ? (
          <EmptyState title="No payments yet" description="Payments recorded by the school office will appear here." />
        ) : (
          <Table size="small" aria-label="Payments">
            <TableHead>
              <TableRow>
                <TableCell>Receipt</TableCell>
                <TableCell>Date</TableCell>
                <TableCell>Method</TableCell>
                <TableCell>For</TableCell>
                <TableCell align="right">Amount</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {d.payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    {p.receiptNumber} {p.reversed && <Chip size="small" color="error" variant="outlined" label="Reversed" />}
                  </TableCell>
                  <TableCell>{formatInSchoolTz(p.receivedAt, 'yyyy-MM-dd', tz)}</TableCell>
                  <TableCell>{PAYMENT_METHOD_LABELS[p.method]}</TableCell>
                  <TableCell>{p.studentNames.join(', ')}</TableCell>
                  <TableCell align="right">{money(p.amount)}</TableCell>
                  <TableCell align="right">
                    <Button size="small" component={Link} href={p.receiptUrl}>
                      Receipt
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>

      {d.invoiceFooter && (
        <Alert severity="info" icon={false}>
          <Typography variant="subtitle2">How to pay</Typography>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
            {d.invoiceFooter}
          </Typography>
        </Alert>
      )}
    </Stack>
  );
}
