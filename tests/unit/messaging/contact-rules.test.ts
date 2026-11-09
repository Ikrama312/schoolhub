import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  user: { findMany: vi.fn() },
  parentStudentLink: { findMany: vi.fn() },
  enrollment: { findMany: vi.fn() },
  sectionMember: { findMany: vi.fn() },
}));
vi.mock('@/server/db', () => ({ prisma: db }));

import {
  canMessageWith,
  canSendInWith,
  checkNewConversation,
  loadRelations,
  type Relations,
  type RelUser,
} from '@/server/messaging/contact-rules';

/**
 * Fixture world:
 *   admin A; teachers T (teaches S1 via course), H (S2's current homeroom), X (no students);
 *   students S1, S2, S3 (S3 has no teacher); parents P1 (of S1), P2 (of S2), P3 (of S3).
 */
const u = (id: string, role: RelUser['role'], status: RelUser['status'] = 'ACTIVE'): RelUser => ({ id, role, status });
const users = [
  u('A', 'ADMIN'),
  u('T', 'TEACHER'),
  u('H', 'TEACHER'),
  u('X', 'TEACHER'),
  u('S1', 'STUDENT'),
  u('S2', 'STUDENT'),
  u('S3', 'STUDENT'),
  u('P1', 'PARENT'),
  u('P2', 'PARENT'),
  u('P3', 'PARENT'),
  u('D', 'TEACHER', 'DISABLED'),
];
const rel: Relations = {
  users: new Map(users.map((x) => [x.id, x])),
  teaches: new Set(['T|S1', 'H|S2', 'D|S1']),
  children: new Map([
    ['P1', ['S1']],
    ['P2', ['S2']],
    ['P3', ['S3']],
  ]),
};
const can = (from: string, to: string) => canMessageWith(rel.users.get(from)!, rel.users.get(to)!, rel);

describe('canMessageWith — full role×role matrix (FR-5)', () => {
  // [sender, recipient, expected]
  const matrix: [string, string, boolean][] = [
    // ADMIN → anyone
    ['A', 'T', true], ['A', 'X', true], ['A', 'S3', true], ['A', 'P3', true],
    // TEACHER → ADMIN / TEACHER always
    ['T', 'A', true], ['T', 'X', true], ['X', 'H', true],
    // TEACHER → STUDENT via managed course or homeroom only
    ['T', 'S1', true], ['H', 'S2', true], ['T', 'S2', false], ['X', 'S1', false], ['X', 'S3', false],
    // TEACHER → PARENT via a taught child
    ['T', 'P1', true], ['H', 'P2', true], ['T', 'P2', false], ['X', 'P3', false],
    // STUDENT → own teachers / ADMIN; never student or parent
    ['S1', 'T', true], ['S2', 'H', true], ['S1', 'H', false], ['S1', 'A', true],
    ['S1', 'S2', false], ['S1', 'P1', false], ['S1', 'P2', false],
    // PARENT → linked child's teachers / ADMIN; never parent or student
    ['P1', 'T', true], ['P2', 'H', true], ['P1', 'H', false], ['P1', 'A', true],
    ['P1', 'P2', false], ['P1', 'S1', false], ['P1', 'S2', false],
  ];
  it.each(matrix)('%s → %s = %s', (from, to, expected) => {
    expect(can(from, to)).toBe(expected);
  });

  it('never allows messaging yourself', () => {
    expect(can('A', 'A')).toBe(false);
  });

  it('refuses non-ACTIVE recipients even when the relationship exists', () => {
    expect(can('S1', 'D')).toBe(false);
    expect(can('A', 'D')).toBe(false);
  });
});

describe('checkNewConversation (FR-6)', () => {
  const T = rel.users.get('T')!;
  const S1 = rel.users.get('S1')!;

  it('allows a staff-created group with a student', () => {
    expect(checkNewConversation(T, ['S1', 'P1', 'X'], rel)).toBeNull();
  });

  it('students cannot start conversations with each other or with parents (no staff in the group)', () => {
    expect(checkNewConversation(S1, ['S2'], rel)).toBe('CONTACT_RULES');
    expect(checkNewConversation(S1, ['T', 'S2'], rel)).toBe('CONTACT_RULES');
    expect(checkNewConversation(rel.users.get('P1')!, ['S1'], rel)).toBe('CONTACT_RULES');
  });

  it('a student may start a 1:1 with their own teacher', () => {
    expect(checkNewConversation(S1, ['T'], rel)).toBeNull();
  });

  it('rejects any unreachable participant', () => {
    expect(checkNewConversation(T, ['S1', 'S2'], rel)).toBe('CONTACT_RULES');
    expect(checkNewConversation(T, ['missing'], rel)).toBe('CONTACT_RULES');
  });

  it('enforces 2..25 participants (creator included)', () => {
    expect(checkNewConversation(T, [], rel)).toBe('TOO_FEW_PARTICIPANTS');
    expect(checkNewConversation(T, ['T'], rel)).toBe('TOO_FEW_PARTICIPANTS');
    const many = Array.from({ length: 25 }, (_, i) => `t${i}`);
    const big: Relations = { ...rel, users: new Map([...rel.users, ...many.map((id) => [id, u(id, 'TEACHER')] as const)]) };
    expect(checkNewConversation(T, many.slice(0, 24), big)).toBeNull(); // 25 total
    expect(checkNewConversation(T, many, big)).toBe('TOO_MANY_PARTICIPANTS'); // 26 total
  });
});

describe('canSendInWith (A4 / FR-7)', () => {
  it('staff can always send, even after the relationship ended', () => {
    expect(canSendInWith(rel.users.get('X')!, ['S3'], rel)).toBe(true);
    expect(canSendInWith(rel.users.get('A')!, ['P3'], rel)).toBe(true);
  });

  it('a student in a staff group can reply while a live staff relationship remains', () => {
    expect(canSendInWith(rel.users.get('S1')!, ['T', 'S2'], rel)).toBe(true);
  });

  it('refuses a non-staff sender once the relationship has ended', () => {
    const ended: Relations = { ...rel, teaches: new Set() };
    expect(canSendInWith(rel.users.get('S1')!, ['T', 'S2'], ended)).toBe(false);
    expect(canSendInWith(rel.users.get('P1')!, ['T'], ended)).toBe(false);
  });

  it('an ADMIN participant keeps the conversation sendable for parents', () => {
    const ended: Relations = { ...rel, teaches: new Set() };
    expect(canSendInWith(rel.users.get('P1')!, ['T', 'A'], ended)).toBe(true);
  });
});

describe('loadRelations queries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.user.findMany.mockResolvedValue([
      { id: 'T', role: 'TEACHER', status: 'ACTIVE', archivedAt: null },
      { id: 'C', role: 'TEACHER', status: 'ACTIVE', archivedAt: null },
      { id: 'S1', role: 'STUDENT', status: 'ACTIVE', archivedAt: null },
      { id: 'P1', role: 'PARENT', status: 'ACTIVE', archivedAt: new Date() },
    ]);
    db.parentStudentLink.findMany.mockResolvedValue([{ parentId: 'P1', studentId: 'S1' }]);
    db.enrollment.findMany.mockResolvedValue([{ studentId: 'S1', course: { teacherId: 'Other', coTeacherIds: ['C'] } }]);
    db.sectionMember.findMany.mockResolvedValue([{ studentId: 'S1', section: { homeroomTeacherId: 'T' } }]);
  });

  it('counts co-teachers (FR-32) and current-year homerooms; only ACTIVE enrollments', async () => {
    const r = await loadRelations(['T', 'C', 'S1', 'P1']);
    expect(r.teaches).toEqual(new Set(['C|S1', 'T|S1']));
    expect(r.children.get('P1')).toEqual(['S1']);
    const enrollWhere = db.enrollment.findMany.mock.calls[0][0].where;
    expect(enrollWhere.status).toBe('ACTIVE'); // DROPPED enrollments never count
    expect(enrollWhere.course.OR).toEqual([{ teacherId: { in: ['T', 'C'] } }, { coTeacherIds: { hasSome: ['T', 'C'] } }]);
    const homeWhere = db.sectionMember.findMany.mock.calls[0][0].where;
    expect(homeWhere.section.academicYear).toEqual({ isCurrent: true }); // previous-year homeroom never counts
  });

  it('treats archived users as non-ACTIVE', async () => {
    const r = await loadRelations(['P1']);
    expect(r.users.get('P1')!.status).toBe('ARCHIVED');
  });
});
