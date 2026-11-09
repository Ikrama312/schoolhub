import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { signInAs } from './helpers/auth';

/**
 * PRD-13 NFR-8/NFR-10/FR-5/FR-13: a parent and a teacher exchange messages in two browser contexts
 * (each reply appears in the other's open thread in under 6 s, by polling), and a student can neither
 * find another student in the picker nor create the conversation through the API (403).
 * Builds its own users/course (TAG) and removes them afterwards.
 */
const prisma = new PrismaClient();
const TAG = 'e2e-msg';
const PASSWORD = 'E2e-Messaging!2026';
const email = (n: string) => `${TAG}-${n}@schoolhub.test`;
const ids = {} as Record<'course' | 'teacher' | 'parent' | 's1' | 's2', string>;

test.describe.configure({ mode: 'serial' });

async function cleanup() {
  const users = (await prisma.user.findMany({ where: { email: { startsWith: `${TAG}-` } }, select: { id: true } })).map((u) => u.id);
  await prisma.conversation.deleteMany({ where: { createdById: { in: users } } });
  await prisma.course.deleteMany({ where: { code: TAG } });
  await prisma.notification.deleteMany({ where: { userId: { in: users } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
}

test.beforeAll(async () => {
  await cleanup();
  const year = await prisma.academicYear.findFirstOrThrow({ where: { isCurrent: true } });
  const subject = await prisma.subject.findFirstOrThrow();
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const mk = (n: string, firstName: string, lastName: string, role: 'TEACHER' | 'STUDENT' | 'PARENT') =>
    prisma.user.create({ data: { email: email(n), firstName, lastName, role, status: 'ACTIVE', passwordHash } }).then((u) => u.id);
  ids.teacher = await mk('teacher', 'Mira', 'Messenger', 'TEACHER');
  ids.parent = await mk('parent', 'Pam', 'Poster', 'PARENT');
  ids.s1 = await mk('s1', 'Stu', 'Alpha', 'STUDENT');
  ids.s2 = await mk('s2', 'Sky', 'Bravo', 'STUDENT');
  await prisma.parentStudentLink.create({ data: { parentId: ids.parent, studentId: ids.s1, relationship: 'MOTHER', isPrimary: true } });
  ids.course = (await prisma.course.create({ data: { name: 'E2E Messaging', code: TAG, academicYearId: year.id, subjectId: subject.id, teacherId: ids.teacher } })).id;
  await prisma.enrollment.createMany({ data: [ids.s1, ids.s2].map((studentId) => ({ courseId: ids.course, studentId })) });
});

test.afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

/** A message bubble in the open thread (the list preview repeats the text, so scope to the thread). */
const inThread = (page: import('@playwright/test').Page, text: string) => page.getByTestId('message').filter({ hasText: text });

test('parent → teacher round trip appears in the other open thread within 6 s', async ({ browser }) => {
  const parentCtx = await browser.newContext();
  const teacherCtx = await browser.newContext();
  const parent = await parentCtx.newPage();
  const teacher = await teacherCtx.newPage();
  await signInAs(parent, email('parent'), PASSWORD);
  await signInAs(teacher, email('teacher'), PASSWORD);

  // Parent starts the conversation from the picker (contacts endpoint, grouped).
  await parent.goto('/messages');
  await parent.getByRole('button', { name: 'New message' }).click();
  const dialog = parent.getByRole('dialog', { name: 'New message' });
  await dialog.getByLabel('To').fill('Mira');
  await parent.getByRole('option', { name: 'Mira Messenger' }).click();
  await dialog.getByLabel('Message', { exact: true }).fill('Hello from Pam about Stu');
  await dialog.getByRole('button', { name: 'Send' }).click();
  await parent.waitForURL(/\/messages\/[^/]+$/);
  const threadUrl = new URL(parent.url()).pathname;

  // Teacher has the thread open; the parent's next message must arrive by polling.
  await teacher.goto(threadUrl);
  await expect(inThread(teacher, 'Hello from Pam about Stu')).toBeVisible();

  await parent.getByLabel('Message', { exact: true }).fill('Are you there?');
  await parent.keyboard.press('Enter');
  await expect(inThread(teacher, 'Are you there?')).toBeVisible({ timeout: 6_000 });

  await teacher.getByLabel('Message', { exact: true }).fill('Yes — happy to help.');
  await teacher.keyboard.press('Enter');
  await expect(inThread(parent, 'Yes — happy to help.')).toBeVisible({ timeout: 6_000 });

  await parentCtx.close();
  await teacherCtx.close();
});

test('student → student is absent from the picker and POST /api/conversations returns 403', async ({ page }) => {
  await signInAs(page, email('s1'), PASSWORD);
  await page.goto('/messages');
  await page.getByRole('button', { name: 'New message' }).click();
  const dialog = page.getByRole('dialog', { name: 'New message' });
  await dialog.getByLabel('To').fill('Sky');
  await expect(page.getByText('No one you can message matches')).toBeVisible();
  await expect(page.getByRole('option', { name: 'Sky Bravo' })).toHaveCount(0);

  const res = await page.request.post('/api/conversations', { data: { participantIds: [ids.s2], body: 'hi' } });
  expect(res.status()).toBe(403);
  expect(await prisma.conversation.count({ where: { createdById: ids.s1 } })).toBe(0);
});
