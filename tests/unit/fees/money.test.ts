import { describe, expect, it } from 'vitest';
import { amountInWords, formatMoney, sumMoney } from '@/lib/money';

describe('amountInWords (FR-34, D-9)', () => {
  it.each([
    ['1240.00', 'USD', 'One thousand two hundred forty dollars and 00/100'],
    ['0.50', 'USD', 'Zero dollars and 50/100'],
    ['1', 'USD', 'One dollar and 00/100'],
    ['2235.07', 'USD', 'Two thousand two hundred thirty-five dollars and 07/100'],
    ['1000000', 'USD', 'One million dollars and 00/100'],
    ['999999999.99', 'USD', 'Nine hundred ninety-nine million nine hundred ninety-nine thousand nine hundred ninety-nine dollars and 99/100'],
    ['115.10', 'EUR', 'One hundred fifteen EUR and 10/100'],
  ])('%s %s', (amount, currency, words) => {
    expect(amountInWords(amount, currency)).toBe(words);
  });
});

describe('formatMoney (FR-35)', () => {
  it('formats in the school currency', () => {
    expect(formatMoney('2235', 'USD')).toBe('$2,235.00');
    expect(formatMoney('-107.5', 'USD')).toBe('-$107.50');
    expect(formatMoney('10', 'EUR', 'en-US')).toBe('€10.00');
  });
});

describe('sumMoney (NFR-1)', () => {
  it('adds without float error', () => {
    expect(sumMoney(['0.10', '0.20']).toFixed(2)).toBe('0.30');
    expect(sumMoney(['0.1', 0.2]).eq('0.3')).toBe(true);
  });
});
