import { test, expect, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { signInAs } from './helpers/auth';

/**
 * PRD-11 NFR-12: a teacher keyboard-edits manual grades in the gradebook grid (digits + Enter,
 * E, M, Delete) and sees the FR-15 golden result 78.0 % C+. Builds its own course/users (TAG).
 */
const prisma = new PrismaClient();
const TAG = 'e2e-gb';
const PASSWORD = 'E2e-Gradebook!2026';
const email = (n: string) => `${TAG}-${n}@schoolhub.test`;
const ids = {} as Record<'course' | 'teacher' | 'sam' | 'zed' | 'hw1' | 'hw2' | 'exam', string>;
const BANDS = [
  ['A', 93], ['A-', 90], ['B+', 87], ['B', 83], ['B-', 80], ['C+', 77], ['C', 73], ['C-', 70], ['D+', 67], ['D', 63], ['D-', 60], ['F', 0],
].map(([letter, minPercent]) => ({ letter, minPercent }));

test.use({ bypassCSP: true });
test.describe.configure({ mode: 'serial' });

async function cleanup() {
  await prisma.course.deleteMany({ where: { code: TAG } });
  const users = (await prisma.user.findMany({ where: { email: { startsWith: `${TAG}-` } }, select: { id: true } })).map((u) => u.id);
  await prisma.notification.deleteMany({ where: { userId: { in: users } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.gradingScale.deleteMany({ where: { name: `${TAG} scale` } });
}

test.beforeAll(async () => {
  await cleanup();
  const year = await prisma.academicYear.findFirstOrThrow({ where: { isCurrent: true } });
  const today = new Date().toISOString().slice(0, 10);
  const terms = await prisma.term.findMany({ where: { academicYearId: year.id } });
  const term = terms.find((t) => t.startDate.toISOString().slice(0, 10) <= today && today <= t.endDate.toISOString().slice(0, 10)) ?? terms[0];
  const subject = await prisma.subject.findFirstOrThrow();
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const mk = (n: string, firstName: string, lastName: string, role: 'TEACHER' | 'STUDENT') =>
    prisma.user.create({ data: { email: email(n), firstName, lastName, role, status: 'ACTIVE', passwordHash } }).then((u) => u.id);
  ids.teacher = await mk('teacher', 'Gina', 'Grader', 'TEACHER');
  ids.sam = await mk('sam', 'Sam', 'Aardvark', 'STUDENT');
  ids.zed = await mk('zed', 'Zed', 'Zebra', 'STUDENT');
  if (!(await prisma.gradingScale.count({ where: { isDefault: true } }))) {
    await prisma.gradingScale.create({ data: { name: `${TAG} scale`, isDefault: true, bands: BANDS } });
  }
  ids.course = (await prisma.course.create({ data: { name: 'E2E Gradebook', code: TAG, academicYearId: year.id, subjectId: subject.id, teacherId: ids.teacher } })).id;
  await prisma.enrollment.createMany({ data: [ids.sam, ids.zed].map((studentId) => ({ courseId: ids.course, studentId })) });
  const hw = await prisma.gradeCategory.create({ data: { courseId: ids.course, name: 'Homework', weightPercent: '40', order: 0 } });
  const ex = await prisma.gradeCategory.create({ data: { courseId: ids.course, name: 'Exams', weightPercent: '60', order: 1 } });
  const due = (d: number) => new Date(Date.now() - d * 86_400_000);
  const item = (title: string, categoryId: string, maxPoints: string, d: number) =>
    prisma.gradeItem.create({ data: { courseId: ids.course, termId: term.id, categoryId, title, maxPoints, dueAt: due(d), source: 'MANUAL' } }).then((i) => i.id);
  ids.hw1 = await item('HW one', hw.id, '20', 3);
  ids.hw2 = await item('HW two', hw.id, '10', 2);
  ids.exam = await item('Exam', ex.id, '100', 1);
});

test.afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

const cell = (page: Page, student: string, item: string) => page.getByTestId(`cell-${student}-${item}`);
const saved = (page: Page, item: string, student: string) =>
  page.waitForResponse((r) => r.url().includes(`/api/grade-items/${item}/grades/${student}`) && r.request().method() === 'PUT' && r.ok());

async function typeScore(page: Page, student: string, item: string, value: string) {
  await cell(page, student, item).click();
  const done = saved(page, item, student);
  await page.keyboard.type(value);
  await page.keyboard.press('Enter');
  await done;
  await expect(cell(page, student, item)).toHaveText(value);
}

test('teacher edits manual grades with the keyboard and sees 78.0% C+ (AC-1)', async ({ page }) => {
  await signInAs(page, email('teacher'), PASSWORD);
  await page.goto(`/courses/${ids.course}/gradebook`);
  await expect(page.getByRole('grid')).toBeVisible();
  // Hydration: retry the first click until the grid is interactive.
  await expect(async () => {
    await cell(page, ids.sam, ids.hw1).click();
    await expect(cell(page, ids.sam, ids.hw1).locator('xpath=ancestor::*[@role="gridcell"]')).toBeFocused();
  }).toPass({ timeout: 15_000 });

  await typeScore(page, ids.sam, ids.hw1, '18');
  await typeScore(page, ids.sam, ids.hw2, '9');
  await typeScore(page, ids.sam, ids.exam, '70');
  await expect(page.getByTestId(`term-${ids.sam}`)).toHaveText('78.0% C+');

  // E = excused, M = missing, Delete = clear (FR-20).
  await cell(page, ids.zed, ids.hw1).click();
  let done = saved(page, ids.hw1, ids.zed);
  await page.keyboard.press('e');
  await done;
  await expect(cell(page, ids.zed, ids.hw1)).toHaveText('EX');

  await cell(page, ids.zed, ids.hw2).click();
  done = saved(page, ids.hw2, ids.zed);
  await page.keyboard.press('m');
  await done;
  await expect(cell(page, ids.zed, ids.hw2)).toHaveText('M');
  await expect(page.getByTestId(`term-${ids.zed}`)).toHaveText('0.0% F');

  done = saved(page, ids.hw2, ids.zed);
  await page.keyboard.press('Delete');
  await done;
  await expect(cell(page, ids.zed, ids.hw2)).toHaveText('—');

  const rows = await prisma.grade.findMany({ where: { gradeItem: { courseId: ids.course } } });
  const of = (s: string, i: string) => rows.find((r) => r.studentId === s && r.gradeItemId === i);
  expect(of(ids.sam, ids.exam)?.score?.toFixed(2)).toBe('70.00');
  expect(of(ids.zed, ids.hw1)).toMatchObject({ excused: true, score: null });
  expect(of(ids.zed, ids.hw2)).toMatchObject({ excused: false, missing: false, score: null });
  expect(await prisma.auditLog.count({ where: { action: 'grade.update', actorId: ids.teacher } })).toBe(6);
});
