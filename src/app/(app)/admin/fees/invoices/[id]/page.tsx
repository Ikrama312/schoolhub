import Link from 'next/link';
import { notFound } from 'next/navigation';
import Grid from '@mui/material/Grid';
import MuiLink from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import { requirePageRole } from '@/server/auth/requireRole';
import { AppError } from '@/server/http';
import { isBursar } from '@/server/fees/access';
import { feeSettings } from '@/server/fees/ledger';
import { getInvoice, listFeeItems } from '@/server/fees/fees-service';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { InvoiceStatusChip } from '@/components/fees/InvoiceStatusChip';
import { formatMoney } from '@/lib/money';
import { formatInSchoolTz } from '@/lib/dates';
import { PAYMENT_METHOD_LABELS } from '@/lib/validators/fees';
import { InvoiceActions } from './_components/InvoiceActions';

export const dynamic = 'force-dynamic';

const ACTION_LABELS: Record<string, string> = {
  'invoice.create': 'Created',
  'invoice.update': 'Draft edited',
  'invoice.issue': 'Issued',
  'invoice.adjust': 'Adjusted',
  'invoice.void': 'Voided',
  'invoice.remind': 'Reminder sent',
  'payment.create': 'Payment applied',
  'payment.reverse': 'Payment reversed',
};

const Item = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <Grid size={{ xs: 6, md: 3 }}>
    <Typography variant="caption" color="text.secondary" component="div">
      {label}
    </Typography>
    <Typography variant="body1" component="div">
      {children || '—'}
    </Typography>
  </Grid>
);

/** /admin/fees/invoices/[id] — header, lines, allocations, balance, reminders and timeline (FR-19 to FR-22). */
export default async function InvoiceDetailPage({ params }: { params: { id: string } }) {
  const user = await requirePageRole('ADMIN');
  const inv = await getInvoice(user, params.id).catch((e) => {
    if (e instanceof AppError && e.code === 'NOT_FOUND') notFound();
    throw e;
  });
  const [canWrite, { items }, { tz }] = await Promise.all([isBursar(user), listFeeItems(), feeSettings()]);
  const money = (v: string) => formatMoney(v, inv.currency);
  const at = (iso: string) => formatInSchoolTz(iso, 'yyyy-MM-dd HH:mm', tz);

  return (
    <>
      <PageHeader
        title={inv.number ? `Invoice ${inv.number}` : 'Draft invoice'}
        breadcrumbs={[{ label: 'Fees', href: '/admin/fees' }, { label: 'Invoices', href: '/admin/fees/invoices' }, { label: inv.number ?? 'Draft' }]}
        actions={<InvoiceStatusChip status={inv.status} size="medium" />}
      />
      <Stack spacing={3}>
        <InvoiceActions invoice={inv} canWrite={canWrite} feeItems={items} />

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Grid container spacing={2}>
            <Item label="Student">{[inv.studentName, inv.gradeLevelName, inv.sectionName].filter(Boolean).join(' · ')}</Item>
            <Item label="Parents">{inv.parents.map((p) => `${p.name}${p.isPrimary ? ' (primary)' : ''}`).join(', ')}</Item>
            <Item label="Term">{inv.termName ?? 'Annual / one-off'}</Item>
            <Item label="Type">{inv.isPlanInvoice ? 'Fee plan' : 'Manual'}</Item>
            <Item label="Issue date">{inv.issueDate}</Item>
            <Item label="Due date">{inv.dueDate ?? `${inv.dueDays} days after issue`}</Item>
            <Item label="Total">{money(inv.total)}</Item>
            <Item label="Balance">
              <Typography component="span" color={inv.status === 'OVERDUE' ? 'error' : 'inherit'} sx={{ fontWeight: 600 }}>
                {money(inv.balance)}
              </Typography>
            </Item>
            {inv.voidReason && <Item label="Void reason">{inv.voidReason}</Item>}
            {inv.notes && <Item label="Notes">{inv.notes}</Item>}
          </Grid>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
            Lines
          </Typography>
          <Table size="small" aria-label="Invoice lines">
            <TableHead>
              <TableRow>
                <TableCell>Description</TableCell>
                <TableCell>Type</TableCell>
                <TableCell align="right">Amount</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {inv.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>
                    {l.description}
                    {l.reason && (
                      <Typography variant="caption" color="text.secondary" component="div">
                        Reason: {l.reason}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>{l.isAdjustment ? 'Adjustment' : l.isDiscount ? 'Discount' : l.isOptional ? 'Optional fee' : 'Fee'}</TableCell>
                  <TableCell align="right">{money(l.amount)}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={2}>Subtotal</TableCell>
                <TableCell align="right">{money(inv.subtotal)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell colSpan={2}>Discounts</TableCell>
                <TableCell align="right">{money(inv.discountTotal)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell colSpan={2} sx={{ fontWeight: 700 }}>
                  Total
                </TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>
                  {money(inv.total)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell colSpan={2}>Paid</TableCell>
                <TableCell align="right">{money(inv.amountPaid)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
            Payments applied
          </Typography>
          {inv.allocations.length === 0 ? (
            <Typography color="text.secondary">No payments yet.</Typography>
          ) : (
            <Table size="small" aria-label="Payments applied">
              <TableHead>
                <TableRow>
                  <TableCell>Receipt</TableCell>
                  <TableCell>Received</TableCell>
                  <TableCell>Method</TableCell>
                  <TableCell align="right">Amount</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {inv.allocations.map((a) => (
                  <TableRow key={a.paymentId}>
                    <TableCell>
                      <MuiLink component={Link} href={`/admin/fees/payments/${a.paymentId}`}>
                        {a.receiptNumber}
                      </MuiLink>{' '}
                      <MuiLink component={Link} href={`/fees/receipts/${a.paymentId}/print`} variant="body2">
                        (print)
                      </MuiLink>{' '}
                      {a.reversed && <Chip size="small" color="error" variant="outlined" label="Reversed" />}
                    </TableCell>
                    <TableCell>{at(a.receivedAt)}</TableCell>
                    <TableCell>{PAYMENT_METHOD_LABELS[a.method]}</TableCell>
                    <TableCell align="right">{money(a.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Paper>

        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 4 }}>
            <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
              <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
                Reminders
              </Typography>
              {inv.reminders.length === 0 ? (
                <Typography color="text.secondary">None sent.</Typography>
              ) : (
                inv.reminders.map((r) => (
                  <Typography key={`${r.kind}-${r.sentAt}`} variant="body2">
                    {at(r.sentAt)} · {r.kind.replaceAll('_', ' ').toLowerCase()}
                  </Typography>
                ))
              )}
            </Paper>
          </Grid>
          <Grid size={{ xs: 12, md: 8 }}>
            <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
              <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
                Activity
              </Typography>
              {inv.timeline.map((t, i) => (
                <Typography key={i} variant="body2">
                  {at(t.at)} · {ACTION_LABELS[t.action] ?? t.action} by {t.actorName}
                </Typography>
              ))}
            </Paper>
          </Grid>
        </Grid>
      </Stack>
    </>
  );
}
