import { describe, expect, it } from 'vitest';
import {
  attendanceSignal,
  gradesSignal,
  missingSignal,
  overallLevel,
  trendOf,
} from '@/server/dashboards/risk-rules';

const lvl = (r: { level: string } | null) => r?.level ?? null;

describe('attendanceSignal (FR-25)', () => {
  it.each([
    [90, 90, null],
    [89.9, 90, 'MEDIUM'],
    [80, 90, 'MEDIUM'],
    [79.9, 90, 'HIGH'],
    [100, 90, null],
    [null, 90, null],
    // threshold override
    [92, 95, 'MEDIUM'],
    [94.9, 95, 'MEDIUM'],
    [95, 95, null],
    [85, 85, null],
    [84.9, 85, 'MEDIUM'],
  ] as const)('pct %s, threshold %s → %s', (pct, threshold, expected) => {
    expect(lvl(attendanceSignal(pct, threshold))).toBe(expected);
  });

  it('labels with the rounded percent', () => {
    expect(attendanceSignal(78, 90)?.label).toBe('Attendance 78 %');
    expect(attendanceSignal(78.04, 90)?.label).toBe('Attendance 78 %');
  });
});

describe('gradesSignal (FR-25)', () => {
  it.each([
    [[60], null],
    [[59.9], 'MEDIUM'],
    [[50], 'MEDIUM'],
    [[49.9], 'HIGH'],
    [[59, 70, 80], 'MEDIUM'],
    [[59, 58], 'HIGH'],
    [[59.9, 59.9, 90], 'HIGH'],
    [[null, 59], 'MEDIUM'],
    [[null, null], null],
    [[], null],
  ] as const)('%j → %s', (pcts, expected) => {
    expect(lvl(gradesSignal([...pcts]))).toBe(expected);
  });

  it('value is the count of courses < 60 and the label pluralises', () => {
    expect(gradesSignal([55, 58, 90])).toMatchObject({ value: 2, label: '2 courses < 60 %' });
    expect(gradesSignal([55])).toMatchObject({ value: 1, label: '1 course < 60 %' });
  });
});

describe('missingSignal (FR-25)', () => {
  it.each([
    [0, null],
    [2, null],
    [3, 'MEDIUM'],
    [4, 'MEDIUM'],
    [5, 'HIGH'],
    [9, 'HIGH'],
  ])('%i → %s', (count, expected) => {
    expect(lvl(missingSignal(count))).toBe(expected);
  });

  it('labels the count', () => {
    expect(missingSignal(6)?.label).toBe('6 missing');
  });
});

describe('overallLevel (FR-26)', () => {
  const M = missingSignal(3);
  const H = missingSignal(5);
  const aM = attendanceSignal(85, 90);

  it('no signals → null', () => expect(overallLevel([null, null, null])).toBeNull());
  it('exactly one MEDIUM → MEDIUM', () => expect(overallLevel([null, M, null])).toBe('MEDIUM'));
  it('MEDIUM + MEDIUM → HIGH', () => expect(overallLevel([aM, M, null])).toBe('HIGH'));
  it('any HIGH → HIGH', () => expect(overallLevel([null, null, H])).toBe('HIGH'));
});

describe('trendOf (FR-28)', () => {
  it.each([
    ['HIGH', 'MEDIUM', 'up'],
    ['MEDIUM', null, 'up'],
    ['MEDIUM', 'HIGH', 'down'],
    [null, 'MEDIUM', 'down'],
    ['HIGH', 'HIGH', 'flat'],
    [null, null, 'flat'],
  ] as const)('%s since %s → %s', (now, before, expected) => {
    expect(trendOf(now, before)).toBe(expected);
  });
});
