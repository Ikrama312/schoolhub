// PRD-17 money helpers (ADR-2, ADR-8, ADR-10). Isomorphic: used by pages, services, seed and tests.
// One Decimal implementation only: re-exported from grading-math (no second wrapper).
import { Decimal, dec, fixed2, type DecimalValue } from '@/server/assignments/grading-math';

export { Decimal, dec, fixed2, type DecimalValue };

export const ZERO = new Decimal(0);

/** Σ of money values as a Decimal (never JS float addition, NFR-1). */
export function sumMoney(values: Iterable<DecimalValue>): Decimal {
  let total = ZERO;
  for (const v of values) total = total.plus(dec(v));
  return total;
}

const formatters = new Map<string, Intl.NumberFormat>();

/** FR-35: "$2,235.00" in the school currency. The value is only formatted, never added up. */
export function formatMoney(amount: DecimalValue, currency: string, locale = 'en-US'): string {
  const key = `${locale}|${currency}`;
  let fmt = formatters.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, { style: 'currency', currency });
    formatters.set(key, fmt);
  }
  // Intl takes a number; a 2-dp string from fixed2 converts exactly enough for display.
  return fmt.format(Number(fixed2(amount)));
}

const ONES = [
  '', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function under1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(n % 10 ? `${TENS[Math.floor(n / 10)]}-${ONES[n % 10]}` : TENS[Math.floor(n / 10)]);
  } else if (n > 0) {
    parts.push(ONES[n]);
  }
  return parts.join(' ');
}

/**
 * FR-34 / D-9: "One thousand two hundred forty dollars and 00/100". English only, 0–999,999,999.99.
 * Major unit "dollars" for USD, otherwise the ISO code. Works on the 2-dp string, no floats.
 */
export function amountInWords(amount: DecimalValue, currency: string): string {
  const [whole, cents] = fixed2(dec(amount).abs()).split('.');
  let n = Number(whole);
  if (n > 999_999_999) throw new RangeError('amountInWords supports up to 999,999,999.99');
  const words: string[] = [];
  for (const [size, label] of [[1_000_000, 'million'], [1_000, 'thousand'], [1, '']] as const) {
    const chunk = Math.floor(n / size);
    if (chunk) words.push(label ? `${under1000(chunk)} ${label}` : under1000(chunk));
    n %= size;
  }
  const text = words.length ? words.join(' ') : 'zero';
  const unit = currency === 'USD' ? (whole === '1' ? 'dollar' : 'dollars') : currency;
  return `${text.charAt(0).toUpperCase()}${text.slice(1)} ${unit} and ${cents}/100`;
}
