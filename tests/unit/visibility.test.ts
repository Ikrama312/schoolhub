import { describe, expect, it } from 'vitest';
import { canSeeDrafts, isLessonVisible, isVisible } from '@/server/content/visibility';

const now = new Date('2026-11-07T12:00:00Z');
const at = (ms: number) => new Date(now.getTime() + ms);

describe('isVisible (FR-18)', () => {
  it('PUBLISHED is visible, DRAFT is not', () => {
    expect(isVisible({ status: 'PUBLISHED', publishAt: null }, now)).toBe(true);
    expect(isVisible({ status: 'DRAFT', publishAt: at(-1000) }, now)).toBe(false);
  });

  it('SCHEDULED flips exactly at publishAt', () => {
    expect(isVisible({ status: 'SCHEDULED', publishAt: at(1) }, now)).toBe(false);
    expect(isVisible({ status: 'SCHEDULED', publishAt: at(0) }, now)).toBe(true);
    expect(isVisible({ status: 'SCHEDULED', publishAt: at(-1) }, now)).toBe(true);
    expect(isVisible({ status: 'SCHEDULED', publishAt: null }, now)).toBe(false);
  });
});

describe('isLessonVisible', () => {
  const pub = { status: 'PUBLISHED' as const, publishAt: null };
  const draft = { status: 'DRAFT' as const, publishAt: null };
  it('requires both lesson and module', () => {
    expect(isLessonVisible(pub, pub, now)).toBe(true);
    expect(isLessonVisible(pub, draft, now)).toBe(false);
    expect(isLessonVisible(draft, pub, now)).toBe(false);
    expect(isLessonVisible(pub, { status: 'SCHEDULED', publishAt: at(60_000) }, now)).toBe(false);
  });
});

describe('canSeeDrafts (FR-19)', () => {
  const course = { teacherId: 't1', coTeacherIds: ['t2'] };
  it('admin, teacher and co-teacher only', () => {
    expect(canSeeDrafts({ id: 'a', role: 'ADMIN' }, course)).toBe(true);
    expect(canSeeDrafts({ id: 't1', role: 'TEACHER' }, course)).toBe(true);
    expect(canSeeDrafts({ id: 't2', role: 'TEACHER' }, course)).toBe(true);
    expect(canSeeDrafts({ id: 't3', role: 'TEACHER' }, course)).toBe(false);
    expect(canSeeDrafts({ id: 't1', role: 'STUDENT' }, course)).toBe(false);
  });
});
