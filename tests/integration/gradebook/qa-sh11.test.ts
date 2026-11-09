// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DATABASE_URL ??= 'postgresql://unused@localhost/unused';
  process.env.APP_URL ??= 'http://localhost:3000';
  process.env.AUTH_SECRET ??= 'test-secret';
});

import { prisma } from '@/server/db';
import { createAssignment, gradeSubmission, submit } from '@/server/assignments/assignments-service';
import { assignmentInput, gradeInput } from '@/lib/validators/assignments';
import { categoriesPutSchema, manualItemSchema } from '@/lib/validators/gradebook';
import { replaceCategories } from '@/server/gradebook/categories-service';
import { createManualItem, getGradebook, markAllMissing, putGrade, putTermOverride, updateItem } from '@/server/gradebook/gradebook-service';
import { getStudentGrades } from '@/server/gradebook/student-grades-service';

/**
 * QA (SH-11) gap coverage, run against a real migrated Postgres: FR-9, FR-15 end to end, FR-24, FR-38,
 * FR-40, FR-42 / NFR-5, NFR-4, NFR-6. Fixtures are tagged with MARK and removed afterwards. Skipped without TEST_DATABASE_URL.
 */
const MARK = 'qa-sh11-gap';
const DAY = 86_400_000;
const ids = {} as Record<'year' | 'term' | 'subject' | 'course' | 'scale' | 'teacher' | 'other' | 's1' | 's2' | 'parent', string>;
const T = () => ({ id: ids.teacher, role: 'TEACHER' as const });
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const code = (p: Promise<unknown>) => p.then(() => 'OK', (e: { code?: string }) => e.code ?? String(e));

const BANDS = [
  ['A', 93], ['A-', 90], ['B+', 87], ['B', 83], ['B-', 80], ['C+', 77],
  ['C', 73], ['C-', 70], ['D+', 67], ['D', 63], ['D-', 60], ['F', 0],
].map(([letter, minPercent]) => ({ letter, minPercent }));

const manual = (title: string, maxPoints: number, extra: Record<string, unknown> = {}) =>
  createManualItem(T(), ids.course, manualItemSchema.parse({ title: `${MARK} ${title}`, maxPoints, termId: ids.term, dueAt: new Date(Date.now() - DAY), ...extra }));

describe.skipIf(!process.env.TEST_DATABASE_URL)('gradebook QA gaps (SH-11)', () => {
  beforeAll(async () => {
    const mk = (n: string, role: 'TEACHER' | 'STUDENT' | 'PARENT', lastName = n) =>
      prisma.user.create({ data: { email: `${n}@${MARK}.test`, firstName: 'QA', lastName, role, status: 'ACTIVE' } }).then((u) => u.id);
    Object.assign(ids, {
      teacher: await mk('teacher', 'TEACHER'),
      other: await mk('other', 'TEACHER'),
      s1: await mk('s1', 'STUDENT', 'Alpha'),
      s2: await mk('s2', 'STUDENT', 'Beta'),
      parent: await mk('parent', 'PARENT'),
    });
    await prisma.parentStudentLink.create({ data: { parentId: ids.parent, studentId: ids.s1, relationship: 'MOTHER', isPrimary: true } });
    const now = Date.now();
    ids.year = (await prisma.academicYear.create({ data: { name: MARK, startDate: new Date(isoDay(now - 200 * DAY)), endDate: new Date(isoDay(now + 200 * DAY)) } })).id;
    ids.term = (await prisma.term.create({ data: { academicYearId: ids.year, name: 'T1', order: 1, startDate: new Date(isoDay(now - 100 * DAY)), endDate: new Date(isoDay(now + 100 * DAY)) } })).id;
    ids.subject = (await prisma.subject.create({ data: { name: MARK, code: MARK.toUpperCase() } })).id;
    // Non-default course scale so the test never touches the school default.
    ids.scale = (await prisma.gradingScale.create({ data: { name: MARK, isDefault: false, bands: BANDS } })).id;
    ids.course = (await prisma.course.create({ data: { name: MARK, code: MARK, academicYearId: ids.year, subjectId: ids.subject, teacherId: ids.teacher, gradingScaleId: ids.scale } })).id;
    await prisma.enrollment.createMany({ data: [ids.s1, ids.s2].map((studentId) => ({ courseId: ids.course, studentId })) });
  });

  afterAll(async () => {
    const users = [ids.teacher, ids.other, ids.s1, ids.s2, ids.parent].filter(Boolean);
    await prisma.course.deleteMany({ where: { code: MARK } });
    await prisma.gradingScale.deleteMany({ where: { name: MARK } });
    await prisma.term.deleteMany({ where: { academicYearId: ids.year } });
    await prisma.notification.deleteMany({ where: { userId: { in: users } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.subject.deleteMany({ where: { code: MARK.toUpperCase() } });
    await prisma.academicYear.deleteMany({ where: { name: MARK } });
  });

  it('FR-40: categories must total 100; FR-15: worked example is 78.0 % C+ in both the gradebook and the student view', async () => {
    const bad = categoriesPutSchema.parse({ categories: [{ name: 'Homework', weightPercent: 40, order: 0 }, { name: 'Exams', weightPercent: 50, order: 1 }] });
    expect(await code(replaceCategories(T(), ids.course, bad))).toBe('VALIDATION_ERROR');

    const cats = await replaceCategories(
      T(),
      ids.course,
      categoriesPutSchema.parse({ categories: [{ name: 'Homework', weightPercent: 40, order: 0 }, { name: 'Exams', weightPercent: 60, order: 1 }] }),
    );
    const hw = cats.categories.find((c) => c.name === 'Homework')!.id;
    const ex = cats.categories.find((c) => c.name === 'Exams')!.id;
    const [h1, h2, e1] = [await manual('HW1', 20, { categoryId: hw }), await manual('HW2', 10, { categoryId: hw }), await manual('Exam', 100, { categoryId: ex })];
    await putGrade(T(), h1.id, ids.s1, { score: '18' });
    await putGrade(T(), h2.id, ids.s1, { score: '9' });
    const last = await putGrade(T(), e1.id, ids.s1, { score: '70' });
    expect(last.result).toMatchObject({ percent: '78.0', letter: 'C+' });

    const gb = await getGradebook(T(), ids.course, ids.term);
    expect(gb.rows.map((r) => r.student.lastName)).toEqual(['Alpha', 'Beta']); // FR-18 last-name sort
    expect(gb.rows[0].result).toMatchObject({ percent: '78.0', letter: 'C+' });

    const mine = await getStudentGrades({ id: ids.s1, role: 'STUDENT' }, ids.s1, ids.term);
    expect(mine.courses.find((c) => c.course.id === ids.course)).toMatchObject({ percent: '78.0', letter: 'C+', colour: 'warning' });
  });

  it('FR-38 / NFR-4: a manual grade notifies the student and parent once and audits old → new', async () => {
    const it1 = await manual('Oral', 10);
    await putGrade(T(), it1.id, ids.s2, { score: '7' });
    await putGrade(T(), it1.id, ids.s2, { score: '8' }); // edit: no second notification
    await putGrade(T(), it1.id, ids.s1, { score: '6' });
    const posted = (userId: string) => prisma.notification.count({ where: { userId, type: 'grade.posted', title: { contains: `${MARK} Oral` } } });
    expect(await posted(ids.s2)).toBe(1);
    expect(await posted(ids.s1)).toBe(1);
    expect(await posted(ids.parent)).toBe(1);

    const rows = await prisma.auditLog.findMany({ where: { actorId: ids.teacher, action: 'grade.update', entityId: it1.id }, orderBy: { createdAt: 'asc' } });
    const s2Rows = rows.filter((r) => (r.metadata as { studentId: string }).studentId === ids.s2);
    expect(s2Rows).toHaveLength(2);
    expect(s2Rows[1].metadata).toMatchObject({ old: { score: '7.00' }, new: { score: '8.00' } });
  });

  it('FR-9: synced grades accept a comment only; manual grades are fully editable', async () => {
    const a = await createAssignment(
      T(),
      ids.course,
      assignmentInput.parse({ title: `${MARK} synced`, submissionType: 'ONLINE_TEXT', maxPoints: 20, dueAt: new Date(Date.now() + DAY), status: 'PUBLISHED' }),
    );
    const sub = (await submit({ id: ids.s1, role: 'STUDENT' }, a.id, { text: 'x', fileIds: [] })).submission.id;
    await gradeSubmission(T(), sub, gradeInput.parse({ rawScore: 15, penaltyPercent: 0, return: true }));
    const item = await prisma.gradeItem.findUniqueOrThrow({ where: { sourceId: a.id } });

    expect(await code(putGrade(T(), item.id, ids.s1, { score: '20' }))).toBe('VALIDATION_ERROR');
    expect(await code(putGrade(T(), item.id, ids.s1, { excused: true }))).toBe('VALIDATION_ERROR');
    expect(await code(updateItem(T(), item.id, { maxPoints: '50' }))).toBe('VALIDATION_ERROR');
    const ok = await putGrade(T(), item.id, ids.s1, { comment: 'Nice work' });
    expect(ok.grade).toMatchObject({ score: '15.00', comment: 'Nice work' });
    // Hiding a synced item is allowed (FR-24).
    expect(await code(updateItem(T(), item.id, { isVisible: false }))).toBe('OK');
    await updateItem(T(), item.id, { isVisible: true });
  });

  it('FR-42 / NFR-5: student view hides hidden items and unreturned scores', async () => {
    const hidden = await manual('Hidden', 10);
    await putGrade(T(), hidden.id, ids.s1, { score: '1' });
    await updateItem(T(), hidden.id, { isVisible: false });

    const a = await createAssignment(
      T(),
      ids.course,
      assignmentInput.parse({ title: `${MARK} unreturned`, submissionType: 'ONLINE_TEXT', maxPoints: 20, dueAt: new Date(Date.now() + DAY), status: 'PUBLISHED' }),
    );
    const sub = (await submit({ id: ids.s1, role: 'STUDENT' }, a.id, { text: 'x', fileIds: [] })).submission.id;
    await gradeSubmission(T(), sub, gradeInput.parse({ rawScore: 3, penaltyPercent: 0, return: false }));

    for (const viewer of [{ id: ids.s1, role: 'STUDENT' as const }, { id: ids.parent, role: 'PARENT' as const }]) {
      const view = await getStudentGrades(viewer, ids.s1, ids.term, ids.course);
      const items = view.courses[0].items;
      expect(items.some((i) => i.id === hidden.id)).toBe(false);
      expect(items.find((i) => i.title === `${MARK} unreturned`)).toMatchObject({ score: null, percent: null });
      expect(view.courses[0].percent).toBe('78.0'); // unchanged: the hidden 1/10 and the unreturned 3/20 do not count
    }
  });

  it('NFR-6 / FR-42: other students, unlinked parents and non-course teachers are refused', async () => {
    expect(await code(getStudentGrades({ id: ids.s2, role: 'STUDENT' }, ids.s1))).not.toBe('OK');
    expect(await code(getStudentGrades({ id: ids.parent, role: 'PARENT' }, ids.s2))).not.toBe('OK');
    expect(await code(getGradebook({ id: ids.other, role: 'TEACHER' }, ids.course))).toBe('FORBIDDEN');
    const it1 = await manual('Guard', 10);
    expect(await code(putGrade({ id: ids.other, role: 'TEACHER' }, it1.id, ids.s1, { score: '5' }))).toBe('FORBIDDEN');
    expect(await code(putGrade({ id: ids.s1, role: 'STUDENT' }, it1.id, ids.s1, { score: '10' }))).toBe('FORBIDDEN');
  });

  it('FR-24: mark missing only after the due date; FR-14 / NFR-4: override is applied and audited', async () => {
    const future = await manual('Future', 10, { dueAt: new Date(Date.now() + DAY) });
    expect(await code(markAllMissing(T(), future.id))).toBe('VALIDATION_ERROR');
    const past = await manual('Past', 10);
    await putGrade(T(), past.id, ids.s2, { score: '10' });
    const r = await markAllMissing(T(), past.id);
    expect(r.studentIds).toEqual([ids.s1]);
    // ids.s1: now 0/10 counts in Uncategorised (weight 0 when categories exist), so the course % is still 78.0.

    const o = await putTermOverride(T(), ids.course, ids.s1, { termId: ids.term, letter: 'B' });
    expect(o.result).toMatchObject({ percent: '78.0', letter: 'B', computedLetter: 'C+', overridden: true });
    expect(await code(putTermOverride(T(), ids.course, ids.s1, { termId: ids.term, letter: 'Z' }))).toBe('VALIDATION_ERROR');
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { actorId: ids.teacher, action: 'termOverride.upsert' } });
    expect(audit.metadata).toMatchObject({ studentId: ids.s1, old: null, new: { letter: 'B' } });
  });

  it('NFR-2: gradebook for 35 students × 80 items loads in under 800 ms', async () => {
    const perfCode = `${MARK}-perf`;
    const perfUsers = { email: { startsWith: 'perf', endsWith: `@${MARK}.test` } };
    try {
      const big = await prisma.course.create({ data: { name: perfCode, code: perfCode, academicYearId: ids.year, subjectId: ids.subject, teacherId: ids.teacher } });
      await prisma.user.createMany({
        data: Array.from({ length: 35 }, (_, i) => ({ email: `perf${i}@${MARK}.test`, firstName: 'P', lastName: `P${String(i).padStart(2, '0')}`, role: 'STUDENT' as const, status: 'ACTIVE' as const })),
      });
      const students = await prisma.user.findMany({ where: perfUsers, select: { id: true } });
      expect(students).toHaveLength(35);
      await prisma.enrollment.createMany({ data: students.map((s) => ({ courseId: big.id, studentId: s.id })) });
      await prisma.gradeItem.createMany({
        data: Array.from({ length: 80 }, (_, i) => ({ courseId: big.id, termId: ids.term, title: `${MARK} perf ${i}`, maxPoints: '10', dueAt: new Date(Date.now() - DAY), source: 'MANUAL' as const })),
      });
      const items = await prisma.gradeItem.findMany({ where: { courseId: big.id }, select: { id: true } });
      await prisma.grade.createMany({ data: items.flatMap((it, j) => students.map((s, k) => ({ gradeItemId: it.id, studentId: s.id, score: String((j + k) % 11), updatedById: ids.teacher }))) });

      await getGradebook(T(), big.id, ids.term); // warm-up (connection pool, JIT)
      const t0 = performance.now();
      const gb = await getGradebook(T(), big.id, ids.term);
      const ms = performance.now() - t0;
      expect(gb.rows).toHaveLength(35);
      expect(gb.items).toHaveLength(80);
      expect(ms).toBeLessThan(800);
    } finally {
      await prisma.course.deleteMany({ where: { code: perfCode } });
      await prisma.user.deleteMany({ where: perfUsers });
    }
  });
});
