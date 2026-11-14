import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import GlobalStyles from '@mui/material/GlobalStyles';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { formatMoney } from '@/lib/money';
import type { InvoiceDetail } from '@/server/fees/fees-service';
import { INVOICE_STATUS_LABELS } from './InvoiceStatusChip';

export interface Letterhead {
  name: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
}

/** ADR-9 / NFR-12: A4 via page-scoped GlobalStyles, app chrome hidden when printing. */
export function FeePrintStyles() {
  return (
    <GlobalStyles
      styles={{
        '@page': { size: 'A4 portrait', margin: '15mm' },
        '@media print': {
          '.MuiAppBar-root, .MuiDrawer-root, [data-print-hide]': { display: 'none !important' },
          'main.MuiBox-root, main': { width: '100% !important', padding: '0 !important', margin: '0 !important' },
          'main > .MuiToolbar-root': { display: 'none !important' },
          body: { background: '#fff !important' },
          '.fee-document': { boxShadow: 'none !important', border: '0 !important', padding: '0 !important' },
          '.fee-document tr': { breakInside: 'avoid' },
        },
      }}
    />
  );
}

export function LetterheadBlock({ school, title, number }: { school: Letterhead; title: string; number: string | null }) {
  const address = [school.addressLine1, school.addressLine2, [school.city, school.country].filter(Boolean).join(', ')].filter(Boolean);
  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', mb: 3 }}>
      <Box>
        <Typography variant="h5" component="p" sx={{ fontWeight: 700 }}>
          {school.name}
        </Typography>
        {address.map((line) => (
          <Typography key={line} variant="body2" color="text.secondary">
            {line}
          </Typography>
        ))}
        {(school.phone || school.email) && (
          <Typography variant="body2" color="text.secondary">
            {[school.phone, school.email].filter(Boolean).join(' · ')}
          </Typography>
        )}
      </Box>
      <Box sx={{ textAlign: 'right' }}>
        <Typography variant="h4" component="h1">
          {title}
        </Typography>
        <Typography variant="subtitle1">{number ?? 'Draft'}</Typography>
      </Box>
    </Stack>
  );
}

export const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <Box>
    <Typography variant="caption" color="text.secondary" component="div">
      {label}
    </Typography>
    <Typography variant="body2">{value || '—'}</Typography>
  </Box>
);

/** PRD-17 FR-33: printable invoice. Renders stored lines and totals only; never recomputes. */
export function InvoiceDocument({ invoice: inv, school }: { invoice: InvoiceDetail; school: Letterhead }) {
  const money = (v: string) => formatMoney(v, inv.currency);
  const primary = inv.parents.find((p) => p.isPrimary) ?? inv.parents[0];
  return (
    <Paper variant="outlined" className="fee-document" sx={{ p: 4, maxWidth: 800, mx: 'auto', position: 'relative' }}>
      <LetterheadBlock school={school} title="Invoice" number={inv.number} />
      <Stack direction="row" spacing={4} sx={{ mb: 3, flexWrap: 'wrap' }}>
        <Field label="Bill to" value={primary ? `${primary.name} (for ${inv.studentName})` : inv.studentName} />
        <Field label="Student" value={[inv.studentName, inv.gradeLevelName, inv.sectionName].filter(Boolean).join(' · ')} />
        <Field label="Term" value={inv.termName ?? 'Annual'} />
        <Field label="Issue date" value={inv.issueDate} />
        <Field label="Due date" value={inv.dueDate} />
        <Field label="Status" value={INVOICE_STATUS_LABELS[inv.status]} />
      </Stack>
      <Table size="small" aria-label="Invoice lines">
        <TableHead>
          <TableRow>
            <TableCell>Description</TableCell>
            <TableCell align="right">Amount</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {inv.lines.map((l) => (
            <TableRow key={l.id}>
              <TableCell>
                {l.description}
                {l.isOptional && ' (optional)'}
                {l.reason && (
                  <Typography variant="caption" color="text.secondary" component="div">
                    {l.reason}
                  </Typography>
                )}
              </TableCell>
              <TableCell align="right">{money(l.amount)}</TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell sx={{ fontWeight: 700 }}>Total</TableCell>
            <TableCell align="right" sx={{ fontWeight: 700 }}>
              {money(inv.total)}
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Paid</TableCell>
            <TableCell align="right">{money(inv.amountPaid)}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell sx={{ fontWeight: 700 }}>Balance due</TableCell>
            <TableCell align="right" sx={{ fontWeight: 700 }}>
              {money(inv.balance)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
      {inv.notes && (
        <Typography variant="body2" sx={{ mt: 2 }}>
          {inv.notes}
        </Typography>
      )}
      {inv.invoiceFooter && (
        <>
          <Divider sx={{ my: 3 }} />
          <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
            {inv.invoiceFooter}
          </Typography>
        </>
      )}
      {inv.status === 'VOID' && <Watermark text="Void" />}
    </Paper>
  );
}

export function Watermark({ text }: { text: string }) {
  return (
    <Typography
      aria-hidden
      sx={{
        position: 'absolute',
        top: '40%',
        left: 0,
        right: 0,
        textAlign: 'center',
        fontSize: 96,
        fontWeight: 700,
        color: 'error.main',
        opacity: 0.15,
        transform: 'rotate(-20deg)',
        pointerEvents: 'none',
        textTransform: 'uppercase',
      }}
    >
      {text}
    </Typography>
  );
}
