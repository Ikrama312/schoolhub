import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/server/http';
import {
  checkCapacityOrThrow,
  dropSectionCoreCourses,
  enrollSectionCoreCourses,
  moveStudentSection,
  type Tx,
} from '@/server/enrollment/roster-engine';

vi.mock('@/server/audit', () => ({ audit: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

function fakeTx() {
  const tx = {
    section: { findUnique: vi.fn() },
    course: { findUnique: vi.fn(), findMany: vi.fn() },
    enrollment: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  };
  return { tx, asTx: tx as unknown as Tx };
}

describe('checkCapacityOrThrow', () => {
  it('throws CONFLICT with the section message when full', async () => {
    const { tx, asTx } = fakeTx();
    tx.section.findUnique.mockResolvedValue({ name: '7A', capacity: 30, _count: { members: 30 } });
    const err = await checkCapacityOrThrow(asTx, { sectionId: 's1', addingCount: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('CONFLICT');
    expect(err.message).toBe('Section 7A is full (30/30).');
  });

  it('throws CONFLICT with the course message when full', async () => {
    const { tx, asTx } = fakeTx();
    tx.course.findUnique.mockResolvedValue({ code: 'MATH-7A', capacity: 30 });
    tx.enrollment.count.mockResolvedValue(30);
    await expect(checkCapacityOrThrow(asTx, { courseId: 'c1', addingCount: 1 })).rejects.toThrow(
      'Course MATH-7A is full (30/30).',
    );
  });

  it('allows filling exactly to capacity and skips null course capacity', async () => {
    const { tx, asTx } = fakeTx();
    tx.section.findUnique.mockResolvedValue({ name: '7A', capacity: 30, _count: { members: 29 } });
    await expect(checkCapacityOrThrow(asTx, { sectionId: 's1', addingCount: 1 })).resolves.toBeUndefined();
    tx.course.findUnique.mockResolvedValue({ code: 'ROBO', capacity: null });
    await expect(checkCapacityOrThrow(asTx, { courseId: 'c1', addingCount: 99 })).resolves.toBeUndefined();
  });

  it('overrideCapacity bypasses the check without querying', async () => {
    const { tx, asTx } = fakeTx();
    await checkCapacityOrThrow(asTx, { sectionId: 's1', addingCount: 5, overrideCapacity: true });
    expect(tx.section.findUnique).not.toHaveBeenCalled();
  });
});

describe('enrollSectionCoreCourses', () => {
  let ctx: ReturnType<typeof fakeTx>;
  beforeEach(() => {
    ctx = fakeTx();
    ctx.tx.course.findMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
    ctx.tx.course.findUnique.mockResolvedValue({ code: 'X', capacity: null });
  });

  it('issues exactly one createMany + one updateMany for mixed new/DROPPED pairs', async () => {
    ctx.tx.enrollment.findMany.mockResolvedValue([
      { id: 'e1', courseId: 'c1', studentId: 'sam', status: 'DROPPED' },
      { id: 'e2', courseId: 'c2', studentId: 'sam', status: 'ACTIVE' },
    ]);
    const result = await enrollSectionCoreCourses(ctx.asTx, 'sec7a', ['sam', 'sara']);

    expect(ctx.tx.course.findMany).toHaveBeenCalledWith({
      where: { sectionId: 'sec7a', kind: 'CORE', archivedAt: null },
      select: { id: true },
    });
    expect(ctx.tx.enrollment.createMany).toHaveBeenCalledTimes(1);
    expect(ctx.tx.enrollment.createMany).toHaveBeenCalledWith({
      data: [
        { courseId: 'c1', studentId: 'sara' },
        { courseId: 'c2', studentId: 'sara' },
      ],
      skipDuplicates: true,
    });
    expect(ctx.tx.enrollment.updateMany).toHaveBeenCalledTimes(1);
    expect(ctx.tx.enrollment.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['e1'] } },
      data: { status: 'ACTIVE', droppedAt: null },
    });
    expect(result).toEqual({ enrolled: 2, reactivated: 1, alreadyActive: 1 });
  });

  it('checks course capacity before writing anything', async () => {
    ctx.tx.course.findUnique.mockResolvedValue({ code: 'MATH-7A', capacity: 1 });
    ctx.tx.enrollment.count.mockResolvedValue(1);
    await expect(enrollSectionCoreCourses(ctx.asTx, 'sec7a', ['sam'])).rejects.toThrow('MATH-7A is full');
    expect(ctx.tx.enrollment.createMany).not.toHaveBeenCalled();
    expect(ctx.tx.enrollment.updateMany).not.toHaveBeenCalled();
  });

  it('does nothing when the section has no core courses', async () => {
    ctx.tx.course.findMany.mockResolvedValue([]);
    const result = await enrollSectionCoreCourses(ctx.asTx, 'sec7a', ['sam']);
    expect(result).toEqual({ enrolled: 0, reactivated: 0, alreadyActive: 0 });
    expect(ctx.tx.enrollment.findMany).not.toHaveBeenCalled();
  });
});

describe('dropSectionCoreCourses', () => {
  it('drops only ACTIVE enrollments in CORE courses of that section', async () => {
    const { tx, asTx } = fakeTx();
    tx.enrollment.updateMany.mockResolvedValue({ count: 6 });
    const dropped = await dropSectionCoreCourses(asTx, 'sec7a', ['sam']);
    expect(dropped).toBe(6);
    const call = tx.enrollment.updateMany.mock.calls[0] as unknown as [
      { where: unknown; data: { status: string; droppedAt: Date } },
    ];
    expect(call[0].where).toEqual({
      studentId: { in: ['sam'] },
      status: 'ACTIVE',
      course: { sectionId: 'sec7a', kind: 'CORE' },
    });
    expect(call[0].data.status).toBe('DROPPED');
    expect(call[0].data.droppedAt).toBeInstanceOf(Date);
  });
});

describe('moveStudentSection', () => {
  it('drops from the source section, then enrolls in the destination', async () => {
    const { tx, asTx } = fakeTx();
    const order: string[] = [];
    tx.enrollment.updateMany.mockImplementation(async () => {
      order.push('drop');
      return { count: 2 };
    });
    tx.course.findMany.mockImplementation(async () => {
      order.push('enroll');
      return [{ id: 'c7b' }];
    });
    tx.course.findUnique.mockResolvedValue({ code: 'X', capacity: null });

    const result = await moveStudentSection(asTx, 'sam', 'sec7a', 'sec7b');
    expect(order).toEqual(['drop', 'enroll']);
    expect(tx.course.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ sectionId: 'sec7b' }) }));
    expect(result).toEqual({ dropped: 2, enrollments: { enrolled: 1, reactivated: 0, alreadyActive: 0 } });
  });
});
