// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DATABASE_URL ??= 'postgresql://unused@localhost/unused';
  process.env.APP_URL ??= 'http://localhost:3000';
  process.env.AUTH_SECRET ??= 'test-secret';
});

// The session is whoever the test says it is; the role check itself is the real logic.
const session = vi.hoisted(() => ({ user: null as null | { id: string; role: 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT'; firstName: string; lastName: string; email: string } }));
vi.mock('@/server/auth/requireRole', async () => {
  const { AppError } = await import('@/server/http');
  const requireRole = async (...roles: string[]) => {
    if (!session.user) throw new AppError('UNAUTHENTICATED', 'You must be signed in.');
    if (roles.length && !roles.includes(session.user.role)) throw new AppError('FORBIDDEN', 'Forbidden');
    return session.user;
  };
  return { requireRole, requireUser: () => requireRole(), getCurrentUser: async () => session.user };
});

import { prisma } from '@/server/db';
import { currentTerm } from '@/server/dashboards/insights';
import { GET as teacherGET } from '@/app/api/dashboard/teacher/route';
import { GET as studentGET } from '@/app/api/dashboard/student/route';
import { GET as adminGET } from '@/app/api/dashboard/admin/route';
import { POST as refreshPOST } from '@/app/api/dashboard/refresh/route';

/** PRD-16 FR-41/FR-24: role guards, payload shape, safeguarding omission, refresh recompute + audit. Real Postgres. */
const MARK = 'qa-sh16-api';
const users = {} as Record<'admin' | 'teacher' | 'student', { id: string; role: 'ADMIN' | 'TEACHER' | 'STUDENT'; firstName: string; lastName: string; email: string }>;
let sectionId = '';

const as = (who: keyof typeof users | null) => {
  session.user = who ? users[who] : null;
};
const body = async (res: Response) => ({ status: res.status, json: (await res.json()) as { data: Record<string, unknown>; error?: { code: string } } });
const get = (fn: () => Promise<Response>) => fn().then(body);
const refresh = () => refreshPOST(new Request('http://localhost/api/dashboard/refresh', { method: 'POST' })).then(body);

describe.skipIf(!process.env.TEST_DATABASE_URL)('dashboard API (integration)', () => {
  beforeAll(async () => {
    for (const role of ['ADMIN', 'TEACHER', 'STUDENT'] as const) {
      const key = role.toLowerCase() as keyof typeof users;
      const u = await prisma.user.create({ data: { email: `${key}@${MARK}.test`, firstName: `Qa${key}`, lastName: MARK, role, status: 'ACTIVE' } });
      users[key] = { id: u.id, role, firstName: u.firstName, lastName: u.lastName, email: u.email };
    }
    const term = await currentTerm();
    if (term) {
      const gradeLevel = await prisma.gradeLevel.findFirstOrThrow();
      sectionId = (await prisma.section.create({ data: { academicYearId: term.academicYearId, gradeLevelId: gradeLevel.id, name: MARK } })).id;
      await prisma.sectionMember.create({ data: { sectionId, studentId: users.student.id, academicYearId: term.academicYearId } });
    }
  });

  afterAll(async () => {
    const ids = Object.values(users).map((u) => u.id);
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    if (sectionId) await prisma.section.delete({ where: { id: sectionId } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  it('role guards: 401 signed out, 403 wrong role', async () => {
    as(null);
    expect((await get(teacherGET)).status).toBe(401);
    as('student');
    expect((await get(teacherGET)).json.error?.code).toBe('FORBIDDEN');
    expect((await get(adminGET)).status).toBe(403);
    expect((await refresh()).status).toBe(403);
    as('teacher');
    expect((await get(studentGET)).status).toBe(403);
    expect((await get(adminGET)).status).toBe(403);
  });

  it('teacher payload has every widget and cached computedAt values', async () => {
    as('teacher');
    const { status, json } = await get(teacherGET);
    expect(status).toBe(200);
    expect(json.data).toMatchObject({
      greeting: { firstName: 'Qateacher', text: expect.stringMatching(/^Good (morning|afternoon|evening)$/) },
      todaysClasses: expect.any(Array),
      toGrade: { data: { count: 0, items: [] }, computedAt: expect.any(String) },
      upcomingDeadlines: { data: [], computedAt: expect.any(String) },
      atRisk: { data: [], computedAt: expect.any(String) },
      messages: { unreadCount: 0, announcementsAvailable: false, announcements: [] },
    });
  });

  it('student payload is the caller’s own data', async () => {
    as('student');
    const { status, json } = await get(studentGET);
    expect(status).toBe(200);
    expect(json.data).toMatchObject({
      today: { isSchoolDay: expect.any(Boolean), items: expect.any(Array) },
      dueSoon: [],
      recentGrades: [],
      courses: [],
      announcementsAvailable: false,
      termAttendance: { rate: null, present: 0, total: 0 },
    });
  });

  it('admin payload omits openSafeguardingReports unless the caller is a lead (FR-16)', async () => {
    as('admin');
    const plain = await get(adminGET);
    expect(plain.status).toBe(200);
    expect(plain.json.data.kpis).not.toHaveProperty('openSafeguardingReports');
    expect(plain.json.data).toMatchObject({
      attendanceTrend: { data: { series: expect.any(Array), referenceLine: expect.any(Number) } },
      gradeDistribution: { data: { xAxis: expect.arrayContaining(['90–100']) } },
      riskSummary: { data: { byLevel: expect.any(Object), byReason: expect.any(Object) } },
    });

    await prisma.user.update({ where: { id: users.admin.id }, data: { isSafeguardingLead: true } });
    const lead = await get(adminGET);
    expect(lead.json.data.kpis).toHaveProperty('openSafeguardingReports', expect.any(Number));
  });

  it('refresh recomputes snapshots (computedAt changes) and audits dashboard.refresh (FR-24)', async () => {
    as('admin');
    const first = await refresh();
    expect(first.status).toBe(200);
    expect(first.json.data).toMatchObject({ refreshedAt: expect.any(String), studentsComputed: expect.any(Number) });
    const term = await currentTerm();
    if (term) {
      const before = await prisma.studentRiskSnapshot.findUniqueOrThrow({ where: { studentId_termId: { studentId: users.student.id, termId: term.id } } });
      await new Promise((r) => setTimeout(r, 5));
      await refresh();
      const after = await prisma.studentRiskSnapshot.findUniqueOrThrow({ where: { studentId_termId: { studentId: users.student.id, termId: term.id } } });
      expect(after.computedAt.getTime()).toBeGreaterThan(before.computedAt.getTime());
    }
    expect(await prisma.auditLog.count({ where: { actorId: users.admin.id, action: 'dashboard.refresh' } })).toBeGreaterThanOrEqual(1);
  });
});
