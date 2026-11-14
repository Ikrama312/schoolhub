// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DATABASE_URL ??= 'postgresql://unused@localhost/unused';
  process.env.APP_URL ??= 'http://localhost:3000';
  process.env.AUTH_SECRET ??= 'test-secret';
});

// Services take an explicit actor here; stub the session module so next-auth is never loaded.
vi.mock('@/server/auth/requireRole', () => ({ requireRole: async () => { throw new Error('no session in this test'); } }));

import { prisma } from '@/server/db';
import { createManualInvoice, issue, recordPayment } from '@/server/fees/fees-service';

/**
 * PRD-17 FR-16 / FR-50 / NFR-3: N parallel issues and N parallel payments, each in its own
 * transaction, get numbers forming exactly 1..N. Year 2099 keeps the sequence isolated from real data.
 */
const MARK = 'qa-sh17-num';
const N = 8;
const TODAY = '2099-01-15';
const ids = {} as Record<string, string>;
const students: string[] = [];
const admin = () => ({ id: ids.admin, role: 'ADMIN' as const });

describe.skipIf(!process.env.TEST_DATABASE_URL)('fee document numbering (integration)', () => {
  beforeAll(async () => {
    await prisma.documentSequence.deleteMany({ where: { year: 2099 } });
    const mk = (n: string, role: 'ADMIN' | 'STUDENT' | 'PARENT') =>
      prisma.user.create({ data: { email: `${n}@${MARK}.test`, firstName: 'QA', lastName: n, role, status: 'ACTIVE', isBursar: role === 'ADMIN' } }).then((u) => u.id);
    ids.admin = await mk('admin', 'ADMIN');
    ids.parent = await mk('parent', 'PARENT');
    ids.grade = (await prisma.gradeLevel.create({ data: { name: MARK, shortName: MARK, order: 8000 + Math.floor(Math.random() * 900) } })).id;
    ids.year = (await prisma.academicYear.create({ data: { name: MARK, startDate: new Date('2098-09-01'), endDate: new Date('2099-07-01') } })).id;
    for (let i = 0; i < N; i++) {
      const s = await mk(`s${i}`, 'STUDENT');
      students.push(s);
      await prisma.studentProfile.create({ data: { userId: s, admissionNumber: `${MARK}-${i}`, dateOfBirth: new Date('2014-01-01'), gradeLevelId: ids.grade, enrollmentDate: new Date('2098-09-01') } });
      await prisma.parentStudentLink.create({ data: { parentId: ids.parent, studentId: s, relationship: 'MOTHER', isPrimary: true } });
    }
  });

  afterAll(async () => {
    const users = (await prisma.user.findMany({ where: { email: { endsWith: `@${MARK}.test` } }, select: { id: true } })).map((u) => u.id);
    await prisma.paymentAllocation.deleteMany({ where: { invoice: { studentId: { in: users } } } });
    await prisma.payment.deleteMany({ where: { recordedById: { in: users } } });
    await prisma.invoice.deleteMany({ where: { studentId: { in: users } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: users } } });
    await prisma.notification.deleteMany({ where: { userId: { in: users } } });
    await prisma.studentProfile.deleteMany({ where: { userId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.academicYear.deleteMany({ where: { name: MARK } });
    await prisma.gradeLevel.deleteMany({ where: { name: MARK } });
    await prisma.documentSequence.deleteMany({ where: { year: 2099 } });
    await prisma.$disconnect();
  });

  it('parallel issues get INV-2099-000001..N with no gaps or duplicates', async () => {
    const drafts = await Promise.all(
      students.map((studentId) =>
        createManualInvoice(admin(), { studentId, academicYearId: ids.year, termId: null, lines: [{ description: 'Trip', amount: '100.00' }], dueDays: 30, issue: false }, { today: TODAY }),
      ),
    );
    const issued = await Promise.all(drafts.map((d) => issue(admin(), d.id, { today: TODAY })));
    const numbers = issued.map((i) => i.number).sort();
    expect(numbers).toEqual(Array.from({ length: N }, (_, i) => `INV-2099-${String(i + 1).padStart(6, '0')}`));
    expect(issued.every((i) => i.status === 'ISSUED' && i.issueDate === TODAY && i.dueDate === '2099-02-14')).toBe(true);
  });

  it('parallel payments get RCT-2099-000001..N', async () => {
    const results = await Promise.all(
      Array.from({ length: N }, () =>
        recordPayment(
          admin(),
          { payerParentId: ids.parent, amount: '10.00', method: 'CASH', receivedAt: new Date('2099-01-15T15:00:00Z'), payerName: 'QA parent' },
          { today: TODAY },
        ),
      ),
    );
    const numbers = results.map((r) => r.payment.receiptNumber).sort();
    expect(numbers).toEqual(Array.from({ length: N }, (_, i) => `RCT-2099-${String(i + 1).padStart(6, '0')}`));
    // Σ allocations equals Σ amountPaid: every lock-and-reload saw the previous payment.
    const agg = await prisma.invoice.aggregate({ where: { studentId: { in: students } }, _sum: { amountPaid: true } });
    expect(agg._sum.amountPaid?.toFixed(2)).toBe((10 * N).toFixed(2));
  });
});
