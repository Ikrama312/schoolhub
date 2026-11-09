import { test, expect, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { signInAs } from './helpers/auth';

/**
 * PRD-09 NFR-14: teacher creates an assignment with a rubric → student submits a file → teacher
 * grades with the rubric and returns → student sees the score and feedback; a parent sees their
 * child's missing assignment. Builds its own course and users (tagged TAG) so it doesn't depend
 * on seed data.
 */
const prisma = new PrismaClient();
const TAG = 'e2e-asg';
const PASSWORD = 'E2e-Assign!2026-pass';
const email = (n: string) => `${TAG}-${n}@schoolhub.test`;
const TITLE = 'E2E Fractions worksheet';
const MISSING_TITLE = 'E2E Overdue reading log';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

let courseId = '';

// bypassCSP: next.config.js's `script-src 'self'` blocks Next's inline hydration scripts (ADR-4).
test.use({ bypassCSP: true });
test.describe.configure({ mode: 'serial' });

async function cleanup() {
  const course = await prisma.course.findFirst({ where: { code: TAG } });
  if (course) {
    const rubricIds = (await prisma.assignment.findMany({ where: { courseId: course.id }, select: { rubricId: true } }))
      .map((a) => a.rubricId)
      .filter((id): id is string => !!id);
    await prisma.course.delete({ where: { id: course.id } });
    await prisma.rubric.deleteMany({ where: { id: { in: rubricIds } } });
  }
  const users = await prisma.user.findMany({ where: { email: { startsWith: `${TAG}-` } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.fileObject.deleteMany({ where: { ownerId: { in: ids } } });
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
  const year = await prisma.academicYear.findFirst({ where: { isCurrent: true } }) ?? (await prisma.academicYear.findFirstOrThrow());
  const subject = await prisma.subject.findFirstOrThrow();
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const mk = (n: string, firstName: string, lastName: string, role: 'TEACHER' | 'STUDENT' | 'PARENT') =>
    prisma.user.create({ data: { email: email(n), firstName, lastName, role, status: 'ACTIVE', passwordHash } });
  const teacher = await mk('teacher', 'Terry', 'Teach', 'TEACHER');
  const student = await mk('s1', 'Alex', 'Aardvark', 'STUDENT');
  const missing = await mk('s2', 'Morgan', 'Missing', 'STUDENT');
  const parent = await mk('parent', 'Paula', 'Parent', 'PARENT');
  await prisma.parentStudentLink.create({ data: { parentId: parent.id, studentId: missing.id, relationship: 'MOTHER', isPrimary: true } });
  courseId = (await prisma.course.create({ data: { name: 'E2E Maths', code: TAG, academicYearId: year.id, subjectId: subject.id, teacherId: teacher.id } })).id;
  await prisma.enrollment.createMany({ data: [student, missing].map((s) => ({ courseId, studentId: s.id })) });
  await prisma.assignment.create({
    data: {
      courseId,
      title: MISSING_TITLE,
      submissionType: 'ONLINE_TEXT',
      maxPoints: '10',
      dueAt: new Date(Date.now() - 2 * 86_400_000),
      status: 'PUBLISHED',
      notifiedAt: new Date(),
      createdById: teacher.id,
    },
  });
});

test.afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test('teacher creates and publishes an assignment with a rubric', async ({ page }) => {
  await signInAs(page, email('teacher'), PASSWORD);
  await page.goto(`/courses/${courseId}/assignments/new`);
  await page.getByLabel('Title').fill(TITLE);
  await page.getByLabel('Max points').first().fill('20');

  await hydratedClick(
    page,
    () => page.getByLabel('Grade with a rubric').check(),
    () => expect(page.getByRole('button', { name: 'Add criterion' })).toBeVisible({ timeout: 1000 }),
  );
  await page.getByRole('button', { name: 'Add criterion' }).click();
  await page.getByRole('button', { name: 'Add criterion' }).click();
  await page.getByLabel('Criterion 1 title').fill('Accuracy');
  await page.getByLabel('Criterion 2 title').fill('Working');
  await expect(page.getByRole('alert').filter({ hasText: 'Rubric totals' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();
  await expect(page.getByText('Accuracy')).toBeVisible();
});

test('student submits a file', async ({ page }) => {
  await signInAs(page, email('s1'), PASSWORD);
  await page.goto(`/courses/${courseId}/assignments`);
  await page.getByRole('link', { name: new RegExp(TITLE) }).click();
  await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();

  await hydratedClick(
    page,
    () => page.getByLabel('Attach files').setInputFiles({ name: 'fractions.pdf', mimeType: 'application/pdf', buffer: PDF }),
    () => expect(page.getByText('fractions.pdf')).toBeVisible({ timeout: 3000 }),
  );
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('Submitted — awaiting grading')).toBeVisible();
  await expect(page.getByText(/\(attempt 1\)/)).toBeVisible();
});

test('teacher grades with the rubric and returns', async ({ page }) => {
  await signInAs(page, email('teacher'), PASSWORD);
  await page.goto(`/courses/${courseId}/assignments`);
  await page.getByRole('row', { name: new RegExp(TITLE) }).getByRole('link', { name: 'Grade' }).click();
  await expect(page.getByText('Shortcuts:')).toBeVisible();
  await expect(page.getByRole('button', { name: /Alex Aardvark/ })).toBeVisible();

  const excellent = page.getByRole('button', { name: 'Excellent · 10' });
  await hydratedClick(
    page,
    () => excellent.first().click(),
    () => expect(excellent.first()).toHaveAttribute('aria-pressed', 'true', { timeout: 1000 }),
  );
  await excellent.nth(1).click();
  await expect(page.getByLabel('Final score')).toHaveValue('20 / 20');
  await page.getByLabel('Feedback', { exact: true }).fill('Great reasoning on question 3.');
  await page.getByRole('button', { name: 'Save & return' }).click();
  await expect(page.getByText('Saved and returned')).toBeVisible();
});

test('student sees the returned score and feedback', async ({ page }) => {
  await signInAs(page, email('s1'), PASSWORD);
  await page.goto(`/courses/${courseId}/assignments`);
  await page.getByRole('link', { name: new RegExp(TITLE) }).click();
  await expect(page.getByText('Great reasoning on question 3.')).toBeVisible();
  const scores = page.getByRole('table', { name: 'Rubric scores' });
  await expect(scores.getByRole('row', { name: /Accuracy/ })).toContainText('10 / 10');
  await expect(scores.getByRole('row', { name: /Working/ })).toContainText('10 / 10');
  await expect(page.getByText('Submitted — awaiting grading')).toHaveCount(0);
});

test('parent sees the missing assignment', async ({ page }) => {
  await signInAs(page, email('parent'), PASSWORD);
  await page.goto('/assignments');
  await hydratedClick(
    page,
    () => page.getByRole('tab', { name: /Missing/ }).click(),
    () => expect(page.getByText(MISSING_TITLE)).toBeVisible({ timeout: 1000 }),
  );
  await expect(page.getByText('Missing', { exact: true })).toBeVisible();
});
