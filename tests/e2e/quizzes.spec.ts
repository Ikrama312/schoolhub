import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { signInAs } from './helpers/auth';

/**
 * PRD-10 NFR-8: teacher builds a 4-question quiz (incl. an essay) and publishes → student starts,
 * answers, reloads mid-attempt (answers persist, FR-15/FR-19), submits → teacher grades the essay →
 * student sees results. Includes an axe scan of the player (NFR-3). Builds its own course/users (TAG).
 */
const prisma = new PrismaClient();
const TAG = 'e2e-quiz';
const PASSWORD = 'E2e-Quiz!2026-pass';
const email = (n: string) => `${TAG}-${n}@schoolhub.test`;
const TITLE = 'E2E Weekly check';

let courseId = '';
let quizId = '';

test.use({ bypassCSP: true });
test.describe.configure({ mode: 'serial' });

async function cleanup() {
  await prisma.course.deleteMany({ where: { code: TAG } });
  const ids = (await prisma.user.findMany({ where: { email: { startsWith: `${TAG}-` } }, select: { id: true } })).map((u) => u.id);
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.emailOutbox.deleteMany({ where: { toEmail: { startsWith: `${TAG}-` } } });
}

/** Retry until hydrated: a click on server-rendered markup before hydration is a no-op. */
async function hydratedClick(page: Page, click: () => Promise<void>, then: () => Promise<void>) {
  await expect(async () => {
    await click();
    await then();
  }).toPass({ timeout: 15_000 });
}

test.beforeAll(async () => {
  await cleanup();
  const year = (await prisma.academicYear.findFirst({ where: { isCurrent: true } })) ?? (await prisma.academicYear.findFirstOrThrow());
  const subject = await prisma.subject.findFirstOrThrow();
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const mk = (n: string, firstName: string, lastName: string, role: 'TEACHER' | 'STUDENT') =>
    prisma.user.create({ data: { email: email(n), firstName, lastName, role, status: 'ACTIVE', passwordHash } });
  const teacher = await mk('teacher', 'Quinn', 'Teach', 'TEACHER');
  const student = await mk('s1', 'Sam', 'Quizzer', 'STUDENT');
  courseId = (await prisma.course.create({ data: { name: 'E2E Quiz Maths', code: TAG, academicYearId: year.id, subjectId: subject.id, teacherId: teacher.id } })).id;
  await prisma.enrollment.create({ data: { courseId, studentId: student.id } });
});

test.afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test('teacher builds a 4-question quiz and publishes it', async ({ page }) => {
  await signInAs(page, email('teacher'), PASSWORD);
  await page.goto(`/courses/${courseId}/quizzes/new`);
  await expect(page).toHaveURL(/\/quizzes\/[^/]+\/edit$/);
  quizId = page.url().split('/quizzes/')[1].split('/')[0];
  // The builder's DateTimePickers are covered by unit-tested validation; open the window now so the student can start.
  await prisma.quiz.update({
    where: { id: quizId },
    data: { title: TITLE, availableFrom: new Date(Date.now() - 3_600_000), availableUntil: new Date(Date.now() + 86_400_000), resultsVisibility: 'IMMEDIATELY', timeLimitMinutes: 30 },
  });
  await page.reload();

  const add = page.getByRole('button', { name: 'Add question' });
  await hydratedClick(page, () => add.click(), () => expect(page.getByText('1 questions')).toBeVisible({ timeout: 2000 }));
  for (const [type, n] of [['True / false', 2], ['Short answer', 3], ['Essay', 4]] as const) {
    await page.getByLabel('Question type').click();
    await page.getByRole('option', { name: type }).click();
    await add.click();
    await expect(page.getByText(`${n} questions`)).toBeVisible();
  }
  await expect(page.getByText('4 points')).toBeVisible();

  await page.getByRole('button', { name: 'Publish' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('PUBLISHED', { exact: true })).toBeVisible();
});

test('student answers, reloads mid-attempt, answers persist, submits', async ({ page }) => {
  await signInAs(page, email('s1'), PASSWORD);
  await page.goto(`/quizzes/${quizId}/take`);
  await hydratedClick(
    page,
    () => page.getByRole('button', { name: 'Start attempt' }).click(),
    () => expect(page.getByRole('dialog')).toBeVisible({ timeout: 1000 }),
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();

  await hydratedClick(
    page,
    () => page.getByRole('radio', { name: 'Option 1' }).check(),
    () => expect(page.getByRole('radio', { name: 'Option 1' })).toBeChecked({ timeout: 1000 }),
  );
  await page.getByRole('radio', { name: 'True', exact: true }).check();
  await page.getByRole('textbox', { name: /Question 3/ }).fill('Answer');
  await page.getByRole('textbox', { name: /Question 4/ }).fill('Fractions compare by common denominators.');
  await expect(page.getByText('All answers saved')).toBeVisible({ timeout: 10_000 });

  // Scoped to the player (<main>); the app-shell sidebar is outside this PRD.
  const axe = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);

  await page.reload();
  await expect(page.getByRole('radio', { name: 'Option 1' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'True', exact: true })).toBeChecked();
  await expect(page.getByRole('textbox', { name: /Question 3/ })).toHaveValue('Answer');
  await expect(page.getByRole('textbox', { name: /Question 4/ })).toHaveValue('Fractions compare by common denominators.');

  await hydratedClick(
    page,
    () => page.getByRole('button', { name: 'Submit', exact: true }).click(),
    () => expect(page.getByRole('dialog')).toBeVisible({ timeout: 1000 }),
  );
  await expect(page.getByRole('dialog')).toContainText('All questions are answered');
  await page.getByRole('dialog').getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('Some answers are awaiting grading')).toBeVisible();
});

test('teacher grades the essay', async ({ page }) => {
  await signInAs(page, email('teacher'), PASSWORD);
  await page.goto(`/courses/${courseId}/quizzes/${quizId}/grade`);
  await expect(page.getByText('1 attempt need grading.')).toBeVisible();
  await hydratedClick(
    page,
    () => page.getByRole('tab', { name: 'By question' }).click(),
    () => expect(page.getByRole('tab', { name: 'By question' })).toHaveAttribute('aria-selected', 'true', { timeout: 1000 }),
  );
  await page.getByLabel('Points').fill('1');
  await page.getByLabel('Feedback').fill('Clear explanation.');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Grade saved')).toBeVisible();
  await expect(page.getByText('Everything is graded.')).toBeVisible();
});

test('student sees the results', async ({ page }) => {
  await signInAs(page, email('s1'), PASSWORD);
  await page.goto(`/quizzes/${quizId}/take`);
  await page.getByRole('link', { name: /Attempt 1/ }).click();
  await expect(page.getByText('4 / 4')).toBeVisible();
  await expect(page.getByText('100%')).toBeVisible();
  await expect(page.getByText('Clear explanation.')).toBeVisible();
});
