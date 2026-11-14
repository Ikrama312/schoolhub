import Link from 'next/link';
import { notFound } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
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
import { requirePageRole } from '@/server/auth/requireRole';
import { AppError } from '@/server/http';
import { isBursar } from '@/server/fees/access';
import { feeSettings } from '@/server/fees/ledger';
import { getPayment } from '@/server/fees/fees-service';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { formatMoney } from '@/lib/money';
import { formatInSchoolTz } from '@/lib/dates';
import { PAYMENT_METHOD_LABELS } from '@/lib/validators/fees';
import { ReversePaymentButton } from './_components/ReversePaymentButton';

export const dynamic = 'force-dynamic';

const Item = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <Grid size={{ xs: 6, md: 3 }}>
    <Typography variant="caption" color="text.secondary" component="div">
      {label}
    </Typography>
    <Typography component="div">{children || '—'}</Typography>
  </Grid>
);

/** /admin/fees/payments/[id] — payment detail; bursars can reverse (FR-31, FR-32). */
export default async function PaymentDetailPage({ params }: { params: { id: string } }) {
  const user = await requirePageRole('ADMIN');
  const p = await getPayment(user, params.id).catch((e) => {
    if (e instanceof AppError && e.code === 'NOT_FOUND') notFound();
    throw e;
  });
  const [canWrite, { tz }] = await Promise.all([isBursar(user), feeSettings()]);
  const money = (v: string) => formatMoney(v, p.currency);
  const at = (iso: string) => formatInSchoolTz(iso, 'yyyy-MM-dd HH:mm', tz);

  return (
    <>
      <PageHeader
        title={`Payment ${p.receiptNumber}`}
        breadcrumbs={[{ label: 'Fees', href: '/admin/fees' }, { label: 'Payments', href: '/admin/fees/payments' }, { label: p.receiptNumber }]}
        actions={
          <Stack direction="row" spacing={1}>
            <Button component={Link} href={`/fees/receipts/${p.id}/print`} variant="outlined">
              Print receipt
            </Button>
            {canWrite && !p.reversed && <ReversePaymentButton paymentId={p.id} receiptNumber={p.receiptNumber} />}
          </Stack>
        }
      />
      <Stack spacing={3}>
        {p.reversed && (
          <Alert severity="error">
            Reversed {p.reversedAt ? at(p.reversedAt) : ''} by {p.reversedByName}: {p.reversalReason}
          </Alert>
        )}
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Grid container spacing={2}>
            <Item label="Amount">{money(p.amount)}</Item>
            <Item label="In words">{p.amountInWords}</Item>
            <Item label="Received">{at(p.receivedAt)}</Item>
            <Item label="Method">{PAYMENT_METHOD_LABELS[p.method]}</Item>
            <Item label="Payer">{p.payerName}</Item>
            <Item label="Reference">{p.reference}</Item>
            <Item label="Recorded by">{p.recordedByName}</Item>
            <Item label="Status">{p.reversed ? <Chip size="small" color="error" variant="outlined" label="Reversed" /> : <Chip size="small" color="success" label="Received" />}</Item>
            {p.notes && <Item label="Notes">{p.notes}</Item>}
          </Grid>
        </Paper>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
            Allocations
          </Typography>
          <Table size="small" aria-label="Allocations">
            <TableHead>
              <TableRow>
                <TableCell>Invoice</TableCell>
                <TableCell>Student</TableCell>
                <TableCell align="right">Amount</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {p.allocations.map((a) => (
                <TableRow key={a.invoiceId}>
                  <TableCell>
                    <MuiLink component={Link} href={`/admin/fees/invoices/${a.invoiceId}`}>
                      {a.invoiceNumber}
                    </MuiLink>
                  </TableCell>
                  <TableCell>{a.studentName}</TableCell>
                  <TableCell align="right">{money(a.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      </Stack>
    </>
  );
}
