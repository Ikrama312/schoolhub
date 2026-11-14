import Typography, { type TypographyProps } from '@mui/material/Typography';
import { formatMoney } from '@/lib/money';

/** PRD-17 FR-35: an amount formatted in the school currency. Formats only; never adds up. */
export function MoneyText({
  amount,
  currency,
  ...props
}: { amount: string; currency: string } & Omit<TypographyProps, 'children'>) {
  return (
    <Typography component="span" variant="inherit" {...props} sx={{ fontVariantNumeric: 'tabular-nums', ...props.sx }}>
      {formatMoney(amount, currency)}
    </Typography>
  );
}
