import { describe, expect, it } from 'vitest';
import { clashesForCell, type CandidateCourse, type CellCtx, type OtherSlot } from '@/server/timetable/clash-rules';

const course = (over: Partial<CandidateCourse> = {}): CandidateCourse => ({
  id: 'c-new',
  code: 'MATH-7A',
  teacherId: 'tom',
  coTeacherIds: [],
  sectionId: '7a',
  sectionName: '7A',
  subjectName: 'Mathematics',
  ...over,
});

const slot = (id: string, c: Partial<CandidateCourse>, roomId: string | null = null, roomName?: string): OtherSlot => ({
  id,
  roomId,
  roomName,
  course: course({ id: `course-${id}`, code: `X-${id}`, teacherId: `t-${id}`, sectionId: null, ...c }),
});

const cell: CellCtx = { dayLabel: 'Monday', period: { name: 'Period 2', kind: 'CLASS' }, isTeaching: true };
const names = new Map([
  ['tom', 'Tom Smith'],
  ['ann', 'Ann Lee'],
  ['bob', 'Bob Ray'],
]);
const none = new Map<string, number>();

describe('clashesForCell', () => {
  it('returns nothing for a free cell', () => {
    expect(clashesForCell(course(), 'r1', cell, [], none)).toEqual([]);
  });

  it('PERIOD_KIND rejects a non-CLASS period', () => {
    const c = clashesForCell(course(), null, { ...cell, period: { name: 'Lunch', kind: 'LUNCH' } }, [], none);
    expect(c).toEqual([{ rule: 'PERIOD_KIND', message: "Period 'Lunch' is not a class period." }]);
  });

  it('NON_TEACHING_DAY rejects a non-teaching day', () => {
    const c = clashesForCell(course(), null, { ...cell, dayLabel: 'Saturday', isTeaching: false }, [], none);
    expect(c).toEqual([{ rule: 'NON_TEACHING_DAY', message: 'Saturday is not a teaching day.' }]);
  });

  it('TEACHER: same main teacher', () => {
    const c = clashesForCell(course(), null, cell, [slot('a', { code: 'MATH-7B', teacherId: 'tom' })], none, { teacherNames: names });
    expect(c).toEqual([{ rule: 'TEACHER', message: 'Clash: Tom Smith already teaches MATH-7B on Monday, Period 2.' }]);
  });

  it('TEACHER: co-teacher of the new course is the other course teacher', () => {
    const c = clashesForCell(
      course({ coTeacherIds: ['ann'] }),
      null,
      cell,
      [slot('a', { code: 'SCI-7B', teacherId: 'ann' })],
      none,
      { teacherNames: names },
    );
    expect(c.map((x) => x.message)).toEqual(['Clash: Ann Lee already teaches SCI-7B on Monday, Period 2.']);
  });

  it('TEACHER: co-teacher on both sides', () => {
    const c = clashesForCell(
      course({ coTeacherIds: ['bob'] }),
      null,
      cell,
      [slot('a', { code: 'ART-7B', coTeacherIds: ['bob'] })],
      none,
      { teacherNames: names },
    );
    expect(c.map((x) => x.message)).toEqual(['Clash: Bob Ray already teaches ART-7B on Monday, Period 2.']);
  });

  it('ROOM: same room clashes, null room skips the rule', () => {
    const others = [slot('a', {}, 'r1', 'Room 101')];
    expect(clashesForCell(course(), 'r1', cell, others, none)).toEqual([
      { rule: 'ROOM', message: 'Clash: Room 101 is used by X-a on Monday, Period 2.' },
    ]);
    expect(clashesForCell(course(), null, cell, others, none)).toEqual([]);
  });

  it('SECTION: same section clashes, null section skips the rule', () => {
    const others = [slot('a', { sectionId: '7a', sectionName: '7A', subjectName: 'Science' })];
    expect(clashesForCell(course(), null, cell, others, none)).toEqual([
      { rule: 'SECTION', message: 'Clash: 7A already has Science on Monday, Period 2.' },
    ]);
    expect(clashesForCell(course({ sectionId: null }), null, cell, others, none)).toEqual([]);
  });

  it('STUDENT: reports the overlap count', () => {
    const c = clashesForCell(course({ sectionId: null, code: 'ROBOTICS' }), null, cell, [slot('a', { code: 'ART-7B' })], new Map([['course-a', 3]]));
    expect(c).toEqual([{ rule: 'STUDENT', message: 'Clash: 3 students in ROBOTICS also take ART-7B at this time.' }]);
  });

  it('returns every clash, in rule order', () => {
    const c = clashesForCell(
      course(),
      'r1',
      { dayLabel: 'Sunday', period: { name: 'Break', kind: 'BREAK' }, isTeaching: false },
      [slot('a', { teacherId: 'tom', sectionId: '7a', sectionName: '7A' }, 'r1', 'Room 101')],
      new Map([['course-a', 2]]),
      { teacherNames: names },
    );
    expect(c.map((x) => x.rule)).toEqual(['PERIOD_KIND', 'NON_TEACHING_DAY', 'TEACHER', 'ROOM', 'SECTION', 'STUDENT']);
  });

  it('excludes the moving slot itself', () => {
    const self = slot('self', { teacherId: 'tom', sectionId: '7a' }, 'r1');
    expect(clashesForCell(course(), 'r1', cell, [self], none, { excludeSlotId: 'self' })).toEqual([]);
    expect(clashesForCell(course(), 'r1', cell, [self], none)).not.toEqual([]);
  });
});
