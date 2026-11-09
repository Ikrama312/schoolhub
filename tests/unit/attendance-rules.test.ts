import { describe, expect, it } from 'vitest';
import {
  addDays,
  attendanceRate,
  canEdit,
  canOpen,
  countStatuses,
  dayColour,
  diffRecords,
  notificationsFor,
  schoolToday,
  type Rec,
} from '@/server/attendance/attendance-rules';
import { registerPutBody, registerRecord, reportFilters } from '@/lib/validators/attendance';

const today = '2026-11-20';

describe('canOpen / canEdit (FR-8, FR-19)', () => {
  it('teacher: 14 days back is allowed, 15 is not', () => {
    expect(canOpen('TEACHER', addDays(today, -14), today).ok).toBe(true);
    expect(canOpen('TEACHER', addDays(today, -15), today).ok).toBe(false);
    expect(canEdit('TEACHER', addDays(today, -14), today).ok).toBe(true);
    expect(canEdit('TEACHER', addDays(today, -15), today)).toMatchObject({ ok: false, reason: expect.stringContaining('14 days') });
  });
  it('admin any past date; nobody the future', () => {
    expect(canOpen('ADMIN', '2020-01-01', today).ok).toBe(true);
    expect(canEdit('ADMIN', '2020-01-01', today).ok).toBe(true);
    expect(canOpen('ADMIN', addDays(today, 1), today)).toMatchObject({ ok: false, code: 'FUTURE' });
    expect(canOpen('TEACHER', addDays(today, 1), today)).toMatchObject({ ok: false, code: 'FUTURE' });
  });
  it('students/parents cannot open', () => {
    expect(canOpen('STUDENT', today, today).ok).toBe(false);
  });
});

describe('schoolToday', () => {
  it('uses the school timezone, not UTC', () => {
    // 03:00 UTC on the 21st is still the 20th in New York.
    expect(schoolToday(new Date('2026-11-21T03:00:00Z'), 'America/New_York')).toBe('2026-11-20');
    expect(schoolToday(new Date('2026-11-21T03:00:00Z'), 'UTC')).toBe('2026-11-21');
  });
});

describe('diffRecords / notificationsFor (FR-21, FR-22)', () => {
  const p = (studentId: string, status: Rec['status'], extra: Partial<Rec> = {}): Rec => ({ studentId, status, ...extra });

  it('first save notifies absent and late once', () => {
    const diff = diffRecords(new Map(), [p('a', 'PRESENT'), p('b', 'ABSENT'), p('c', 'LATE', { minutesLate: 5 })]);
    expect(diff.created).toHaveLength(3);
    const n = notificationsFor(diff);
    expect(n.absent.map((r) => r.studentId)).toEqual(['b']);
    expect(n.late.map((r) => r.studentId)).toEqual(['c']);
    expect(n.corrected).toEqual([]);
  });

  it('re-saving with no change writes and sends nothing', () => {
    const prev = new Map([['b', p('b', 'ABSENT')], ['c', p('c', 'LATE', { minutesLate: 5 })]]);
    const diff = diffRecords(prev, [p('b', 'ABSENT'), p('c', 'LATE', { minutesLate: 5 })]);
    expect(diff).toEqual({ created: [], changed: [] });
    expect(notificationsFor(diff)).toEqual({ absent: [], late: [], corrected: [] });
  });

  it('note/minutes-only edits are changes but not notifications', () => {
    const prev = new Map([['c', p('c', 'LATE', { minutesLate: 5 })]]);
    const diff = diffRecords(prev, [p('c', 'LATE', { minutesLate: 10 })]);
    expect(diff.changed).toHaveLength(1);
    expect(notificationsFor(diff).late).toEqual([]);
  });

  it('ABSENT→PRESENT is corrected; PRESENT→ABSENT is absent; LATE→PRESENT is silent', () => {
    const prev = new Map([['a', p('a', 'ABSENT')], ['b', p('b', 'PRESENT')], ['c', p('c', 'LATE', { minutesLate: 3 })]]);
    const n = notificationsFor(diffRecords(prev, [p('a', 'PRESENT'), p('b', 'ABSENT'), p('c', 'PRESENT')]));
    expect(n.corrected.map((r) => r.studentId)).toEqual(['a']);
    expect(n.absent.map((r) => r.studentId)).toEqual(['b']);
    expect(n.late).toEqual([]);
  });
});

describe('attendanceRate / countStatuses / dayColour (FR-26, FR-28)', () => {
  it('rate counts late and excused as attended, 1 dp, null when empty', () => {
    expect(attendanceRate({ present: 0, absent: 0, late: 0, excused: 0 })).toBeNull();
    expect(attendanceRate({ present: 1, absent: 2, late: 0, excused: 0 })).toBe(33.3);
    expect(attendanceRate({ present: 5, absent: 0, late: 3, excused: 2 })).toBe(100);
    expect(countStatuses(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'])).toEqual({
      records: 4, present: 1, absent: 1, late: 1, excused: 1, rate: 75,
    });
  });
  it('day colour precedence', () => {
    expect(dayColour([])).toBe('default');
    expect(dayColour(['PRESENT', 'LATE', 'ABSENT'])).toBe('error');
    expect(dayColour(['PRESENT', 'LATE'])).toBe('warning');
    expect(dayColour(['PRESENT', 'EXCUSED'])).toBe('success');
  });
});

describe('validators (FR-12, FR-36)', () => {
  it('minutesLate required 1–240 for LATE, forbidden otherwise', () => {
    expect(registerRecord.safeParse({ studentId: 'a', status: 'LATE' }).success).toBe(false);
    expect(registerRecord.safeParse({ studentId: 'a', status: 'LATE', minutesLate: 241 }).success).toBe(false);
    expect(registerRecord.safeParse({ studentId: 'a', status: 'LATE', minutesLate: 5 }).success).toBe(true);
    expect(registerRecord.safeParse({ studentId: 'a', status: 'PRESENT', minutesLate: 5 }).success).toBe(false);
    expect(registerRecord.safeParse({ studentId: 'a', status: 'ABSENT', note: 'x'.repeat(501) }).success).toBe(false);
  });
  it('put body: course xor section key, unique students', () => {
    const records = [{ studentId: 'a', status: 'PRESENT' }];
    expect(registerPutBody.safeParse({ courseId: 'c', periodId: 'p', date: today, records }).success).toBe(true);
    expect(registerPutBody.safeParse({ sectionId: 's', date: today, records }).success).toBe(true);
    expect(registerPutBody.safeParse({ courseId: 'c', sectionId: 's', periodId: 'p', date: today, records }).success).toBe(false);
    expect(registerPutBody.safeParse({ sectionId: 's', date: today, records: [] }).success).toBe(false);
    expect(registerPutBody.safeParse({ sectionId: 's', date: today, records: [...records, ...records] }).success).toBe(false);
    expect(registerPutBody.safeParse({ sectionId: 's', date: '2026-02-30', records }).success).toBe(false);
  });
  it('report range <= 366 days and to >= from', () => {
    expect(reportFilters.safeParse({ from: '2026-01-01', to: '2027-01-02' }).success).toBe(true);
    expect(reportFilters.safeParse({ from: '2026-01-01', to: '2027-01-03' }).success).toBe(false);
    expect(reportFilters.safeParse({ from: '2026-02-01', to: '2026-01-01' }).success).toBe(false);
  });
});
