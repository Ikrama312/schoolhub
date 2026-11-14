// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DATABASE_URL ??= 'postgresql://unused@localhost/unused';
  process.env.APP_URL ??= 'http://localhost:3000';
  process.env.AUTH_SECRET ??= 'test-secret';
});

// The session is whoever the test says it is; the role and bursar checks are the real logic.
type Role = 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT';
const session = vi.hoisted(() => ({ user: null as null | { id: string; role: Role; firstName: string; lastName: string; email: string } }));
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
import { createManualInvoice, recordPayment } from '@/server/fees/fees-service';
import { GET as itemsGET, POST as itemsPOST } from '@/app/api/fees/items/route';
import { GET as invoicesGET } from '@/app/api/fees/invoices/route';
import { GET as invoiceGET } from '@/app/api/fees/invoices/[id]/route';
import { POST as voidPOST } from '@/app/api/fees/invoices/[id]/void/route';
import { GET as paymentGET } from '@/app/api/fees/payments/[id]/route';
import { GET as myFeesGET } from '@/app/api/me/fees/route';
import { GET as exportGET } from '@/app/api/fees/export/invoices/route';

/** PRD-17 FR-41 / FR-45 / NFR-4: the permission matrix through the real route handlers. */
const MARK = 'qa-sh17-access';
const TODAY = '2098-05-01';
const users = {} as Record<'bursar' | 'admin' | 'teacher' | 'student' | 'parent' | 'other', { id: string; role: Role; firstName: string; lastName: string; email: string }>;
const ids = {} as Record<string, string>;

const as = (who: keyof typeof users) => {
  session.user = users[who];
};
const url = (path: string) => `http://localhost${path}`;
const status = (p: Promise<Response>) => p.then((r) => r.status);
const ctx = (id: string) => ({ params: { id } });

describe.skipIf(!process.env.TEST_DATABASE_URL)('fee permissions (integration)', () => {
  beforeAll(async () => {
    const roles: Record<keyof typeof users, Role> = { bursar: 'ADMIN', admin: 'ADMIN', teacher: 'TEACHER', student: 'STUDENT', parent: 'PARENT', other: 'PARENT' };
    for (const [key, role] of Object.entries(roles) as [keyof typeof users, Role][]) {
      const u = await prisma.user.create({
        data: { email: `${key}@${MARK}.test`, firstName: 'QA', lastName: key, role, status: 'ACTIVE', isBursar: key === 'bursar' },
      });
      users[key] = { id: u.id, role, firstName: u.firstName, lastName: u.lastName, email: u.email };
    }
    ids.grade = (await prisma.gradeLevel.create({ data: { name: MARK, shortName: MARK, order: 8000 + Math.floor(Math.random() * 900) } })).id;
    ids.year = (await prisma.academicYear.create({ data: { name: MARK, startDate: new Date('2097-09-01'), endDate: new Date('2098-07-01') } })).id;
    await prisma.studentProfile.create({ data: { userId: users.student.id, admissionNumber: `${MARK}-1`, dateOfBirth: new Date('2014-01-01'), gradeLevelId: ids.grade, enrollmentDate: new Date('2097-09-01') } });
    await prisma.parentStudentLink.create({ data: { parentId: users.parent.id, studentId: users.student.id, relationship: 'MOTHER', isPrimary: true } });
    const bursar = { id: users.bursar.id, role: 'ADMIN' as const };
    const mk = (issue: boolean) =>
      createManualInvoice(bursar, { studentId: users.student.id, academicYearId: ids.year, termId: null, lines: [{ description: 'Trip', amount: '80.00' }], dueDays: 30, issue }, { today: TODAY });
    ids.issued = (await mk(true)).id;
    ids.draft = (await mk(false)).id;
    ids.payment = (
      await recordPayment(bursar, { payerParentId: users.parent.id, amount: '20.00', method: 'CASH', receivedAt: new Date('2098-05-01T15:00:00Z'), payerName: 'QA' }, { today: TODAY })
    ).payment.id;
  });

  // QA SH-17: filters come from MARK lookups, never from ids a failed beforeAll may have left undefined.
  // Prisma reads `{ id: undefined }` as "match all"; the old `{ id: ids.payment }` wiped every payment.
  afterAll(async () => {
    const all = (await prisma.user.findMany({ where: { email: { endsWith: `@${MARK}.test` } }, select: { id: true } })).map((u) => u.id);
    await prisma.paymentAllocation.deleteMany({ where: { invoice: { studentId: { in: all } } } });
    await prisma.payment.deleteMany({ where: { recordedById: { in: all } } });
    await prisma.invoice.deleteMany({ where: { studentId: { in: all } } });
    await prisma.feeItem.deleteMany({ where: { code: { startsWith: 'QA-SH17' } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: all } } });
    await prisma.notification.deleteMany({ where: { userId: { in: all } } });
    await prisma.parentStudentLink.deleteMany({ where: { studentId: { in: all } } });
    await prisma.studentProfile.deleteMany({ where: { userId: { in: all } } });
    await prisma.user.deleteMany({ where: { id: { in: all } } });
    await prisma.academicYear.deleteMany({ where: { name: MARK } });
    await prisma.gradeLevel.deleteMany({ where: { name: MARK } });
    await prisma.$disconnect();
  });

  const postItem = () =>
    itemsPOST(new Request(url('/api/fees/items'), { method: 'POST', body: JSON.stringify({ name: 'QA', code: `qa-sh17-${Date.now()}`, defaultAmount: '10' }) }));

  it('only a bursar admin writes', async () => {
    as('bursar');
    expect(await status(postItem())).toBe(201);
    as('admin');
    expect(await status(postItem())).toBe(403);
    expect(await status(itemsGET(new Request(url('/api/fees/items'))))).toBe(200);
    expect(await status(voidPOST(new Request(url('/x'), { method: 'POST', body: JSON.stringify({ reason: 'nope' }) }), ctx(ids.issued)))).toBe(403);
    expect(await status(exportGET(new Request(url('/api/fees/export/invoices'))))).toBe(200);
  });

  it('a non-bursar flag revoked in the DB takes effect at once', async () => {
    await prisma.user.update({ where: { id: users.bursar.id }, data: { isBursar: false } });
    as('bursar');
    expect(await status(postItem())).toBe(403);
    await prisma.user.update({ where: { id: users.bursar.id }, data: { isBursar: true } });
  });

  it('teachers and students get 403 everywhere', async () => {
    for (const who of ['teacher', 'student'] as const) {
      as(who);
      expect(await status(itemsGET(new Request(url('/api/fees/items'))))).toBe(403);
      expect(await status(invoicesGET(new Request(url('/api/fees/invoices'))))).toBe(403);
      expect(await status(invoiceGET(new Request(url('/x')), ctx(ids.issued)))).toBe(403);
      expect(await status(paymentGET(new Request(url('/x')), ctx(ids.payment)))).toBe(403);
      expect(await status(myFeesGET())).toBe(403);
    }
  });

  it('a parent reads only their own children, never drafts, never setup or exports', async () => {
    as('parent');
    expect(await status(invoiceGET(new Request(url('/x')), ctx(ids.issued)))).toBe(200);
    expect(await status(invoiceGET(new Request(url('/x')), ctx(ids.draft)))).toBe(404);
    expect(await status(paymentGET(new Request(url('/x')), ctx(ids.payment)))).toBe(200);
    expect(await status(itemsGET(new Request(url('/api/fees/items'))))).toBe(403);
    expect(await status(exportGET(new Request(url('/api/fees/export/invoices'))))).toBe(403);
    const list = await (await invoicesGET(new Request(url('/api/fees/invoices')))).json();
    expect(list.data.map((r: { id: string }) => r.id)).toEqual([ids.issued]);
    const me = await (await myFeesGET()).json();
    expect(me.data.summary.outstanding).toBe('60.00');
    expect(me.data.payments[0].receiptUrl).toBe(`/fees/receipts/${ids.payment}/print`);

    as('other');
    expect(await status(invoiceGET(new Request(url('/x')), ctx(ids.issued)))).toBe(404);
    expect(await status(paymentGET(new Request(url('/x')), ctx(ids.payment)))).toBe(404);
    expect(await status(invoiceGET(new Request(url('/x')), ctx('does-not-exist')))).toBe(404);
    expect((await (await invoicesGET(new Request(url('/api/fees/invoices')))).json()).data).toEqual([]);
  });
});
