import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { formatMoney } from '@/lib/money';
import { PAYMENT_METHOD_LABELS } from '@/lib/validators/fees';
import { formatInSchoolTz } from '@/lib/dates';
import type { PaymentDetail } from '@/server/fees/fees-service';
import { Field, LetterheadBlock, Watermark, type Letterhead } from './InvoiceDocument';

/** PRD-17 FR-34: printable receipt with the amount in words and a "Reversed" watermark (FR-31). */
export function ReceiptDocument({ payment: p, school, tz }: { payment: PaymentDetail; school: Letterhead; tz: string }) {
  const money = (v: string) => formatMoney(v, p.currency);
  return (
    <Paper variant="outlined" className="fee-document" sx={{ p: 4, maxWidth: 800, mx: 'auto', position: 'relative' }}>
      <LetterheadBlock school={school} title="Receipt" number={p.receiptNumber} />
      <Stack direction="row" spacing={4} sx={{ mb: 3, flexWrap: 'wrap' }}>
        <Field label="Received from" value={p.payerName} />
        <Field label="Received on" value={formatInSchoolTz(p.receivedAt, 'yyyy-MM-dd HH:mm', tz)} />
        <Field label="Method" value={PAYMENT_METHOD_LABELS[p.method]} />
        <Field label="Reference" value={p.reference} />
        <Field label="Recorded by" value={p.recordedByName} />
      </Stack>
      <Table size="small" aria-label="Payment allocations">
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
              <TableCell>{a.invoiceNumber}</TableCell>
              <TableCell>{a.studentName}</TableCell>
              <TableCell align="right">{money(a.amount)}</TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell colSpan={2} sx={{ fontWeight: 700 }}>
              Total received
            </TableCell>
            <TableCell align="right" sx={{ fontWeight: 700 }}>
              {money(p.amount)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <Typography variant="body2" sx={{ mt: 2 }}>
        Amount in words: <strong>{p.amountInWords}</strong>
      </Typography>
      {p.reversed && (
        <>
          <Typography variant="body2" color="error" sx={{ mt: 2 }}>
            Reversed{p.reversedAt ? ` on ${formatInSchoolTz(p.reversedAt, 'yyyy-MM-dd', tz)}` : ''}
            {p.reversalReason ? `: ${p.reversalReason}` : ''}
          </Typography>
          <Watermark text="Reversed" />
        </>
      )}
    </Paper>
  );
}
