import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { signInAs } from './helpers/auth';

/**
 * PRD-17 FR-51: a bursar generates term invoices, records a payment and prints the receipt, then the
 * parent sees the updated balance. Own fixtures (a dedicated grade, plan and family), like the other specs.
 */
const prisma = new PrismaClient();
const TAG = 'e2e-fees';
const PASSWORD = 'E2e-Fees!2026-pass';
const email = (n: string) => `${TAG}-${n}@schoolhub.test`;
const ids = {} as Record<string, string>;

test.use({ bypassCSP: true });

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: `${TAG}-` } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  await prisma.paymentAllocation.deleteMany({ where: { invoice: { studentId: { in: userIds } } } });
  await prisma.payment.deleteMany({ where: { recordedById: { in: userIds } } });
  await prisma.invoice.deleteMany({ where: { studentId: { in: userIds } } });
  await prisma.feePlan.deleteMany({ where: { name: TAG } });
  await prisma.feeItem.deleteMany({ where: { code: 'E2E-FEES' } });
  await prisma.studentProfile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.gradeLevel.deleteMany({ where: { name: TAG } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

test.beforeAll(async () => {
  await cleanup();
  const year = await prisma.academicYear.findFirstOrThrow({ where: { isCurrent: true } });
  // The generate page preselects the first term of the current year.
  const term = await prisma.term.findFirstOrThrow({ where: { academicYearId: year.id }, orderBy: { order: 'asc' } });
  const maxOrder = (await prisma.gradeLevel.aggregate({ _max: { order: true } }))._max.order ?? 0;
  const grade = await prisma.gradeLevel.create({ data: { name: TAG, shortName: TAG, order: maxOrder + 1 + Math.floor(Math.random() * 1000) } });
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const mk = (n: string, firstName: string, lastName: string, role: 'ADMIN' | 'STUDENT' | 'PARENT') =>
    prisma.user.create({ data: { email: email(n), firstName, lastName, role, status: 'ACTIVE', passwordHash, isBursar: role === 'ADMIN' } });
  await mk('bursar', 'Bea', 'Bursar', 'ADMIN');
  const student = await mk('student', 'Fern', 'Feeling', 'STUDENT');
  const parent = await mk('parent', 'Paula', 'Payer', 'PARENT');
  ids.parent = parent.id;
  await prisma.studentProfile.create({
    data: { userId: student.id, admissionNumber: TAG, dateOfBirth: new Date('2014-01-01'), gradeLevelId: grade.id, enrollmentDate: new Date('2026-08-17') },
  });
  await prisma.parentStudentLink.create({ data: { parentId: parent.id, studentId: student.id, relationship: 'MOTHER', isPrimary: true } });
  const item = await prisma.feeItem.create({ data: { code: 'E2E-FEES', name: 'E2E tuition', defaultAmount: '500.00' } });
  await prisma.feePlan.create({
    data: { name: TAG, academicYearId: year.id, termId: term.id, gradeLevelId: grade.id, lines: { create: [{ feeItemId: item.id, amount: '500.00' }] } },
  });
});

test.afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test('bursar generates, records a payment and prints the receipt; the parent sees the balance', async ({ page, browser }) => {
  await signInAs(page, email('bursar'), PASSWORD);

  // Generate and issue (FR-12 to FR-14).
  await page.goto('/admin/fees/invoices/generate');
  await expect(page.getByRole('heading', { name: 'Generate invoices' })).toBeVisible();
  await page.getByLabel('Grades').fill(TAG);
  await page.getByRole('option', { name: TAG }).click();
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByRole('cell', { name: 'Fern Feeling' })).toBeVisible();
  await page.getByRole('button', { name: 'Create and issue' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Create and issue' }).click();
  await expect(page).toHaveURL(/\/admin\/fees\/invoices/);
  await expect
    .poll(async () => (await prisma.invoice.findFirst({ where: { student: { email: email('student') } } }))?.status)
    .toBe('ISSUED');

  // Record a payment for the family (FR-26 to FR-30) → receipt.
  await page.goto(`/admin/fees/payments/new?parentId=${ids.parent}`);
  await expect(page.getByText('Open invoices')).toBeVisible();
  await page.getByRole('textbox', { name: /^Amount/ }).fill('120');
  await expect(page.getByLabel(/Allocation to INV-/)).toHaveValue('120.00');
  await page.getByRole('button', { name: 'Save and open receipt' }).click();
  await expect(page).toHaveURL(/\/fees\/receipts\/.+\/print/);
  await expect(page.getByRole('heading', { name: 'Receipt' })).toBeVisible();
  await expect(page.getByText('One hundred twenty dollars and 00/100')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Print / Save as PDF' })).toBeVisible();

  // The parent sees the updated balance (FR-39).
  const parentContext = await browser.newContext({ bypassCSP: true });
  const parentPage = await parentContext.newPage();
  await signInAs(parentPage, email('parent'), PASSWORD);
  await parentPage.goto('/fees');
  await expect(parentPage.getByTestId('fees-outstanding')).toHaveText('$380.00');
  await expect(parentPage.getByRole('cell', { name: 'Partially paid' })).toBeVisible();
  await parentContext.close();
});
