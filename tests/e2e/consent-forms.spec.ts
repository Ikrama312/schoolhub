import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { signInAs } from './helpers/auth';

/** PRD-15 FR-46: a parent signs a consent form; the signature must match their name (own fixtures). */
const prisma = new PrismaClient();
const TAG = 'e2e-consent';
const PASSWORD = 'E2e-Consent!2026-pass';
const email = (n: string) => `${TAG}-${n}@schoolhub.test`;
let formId = '';

test.use({ bypassCSP: true });

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: `${TAG}-` } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.consentForm.deleteMany({ where: { title: TAG } });
  await prisma.studentProfile.deleteMany({ where: { userId: { in: ids } } });
  await prisma.gradeLevel.deleteMany({ where: { name: TAG } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

test.beforeAll(async () => {
  await cleanup();
  const maxOrder = (await prisma.gradeLevel.aggregate({ _max: { order: true } }))._max.order ?? 0;
  const grade = await prisma.gradeLevel.create({ data: { name: TAG, shortName: TAG, order: maxOrder + 1 + Math.floor(Math.random() * 1000) } }); // random: parallel specs read the same max
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const mk = (n: string, firstName: string, lastName: string, role: 'TEACHER' | 'STUDENT' | 'PARENT') =>
    prisma.user.create({ data: { email: email(n), firstName, lastName, role, status: 'ACTIVE', passwordHash } });
  const teacher = await mk('teacher', 'Fran', 'Fieldtrip', 'TEACHER');
  const student = await mk('student', 'Max', 'Museum', 'STUDENT');
  const parent = await mk('parent', 'Polly', 'Parent', 'PARENT');
  await prisma.studentProfile.create({ data: { userId: student.id, admissionNumber: TAG, dateOfBirth: new Date('2014-01-01'), gradeLevelId: grade.id, enrollmentDate: new Date('2026-08-17') } });
  await prisma.parentStudentLink.create({ data: { parentId: parent.id, studentId: student.id, relationship: 'MOTHER', isPrimary: true } });
  formId = (
    await prisma.consentForm.create({
      data: {
        title: TAG,
        description: 'Trip to the **museum**.',
        dueAt: new Date(Date.now() + 5 * 86_400_000),
        createdById: teacher.id,
        audiences: { create: [{ type: 'GRADE_LEVEL', refId: grade.id }] },
      },
    })
  ).id;
});

test.afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test('parent signs a consent form', async ({ page }) => {
  await signInAs(page, email('parent'), PASSWORD);
  await page.goto(`/consent-forms/${formId}`);
  await expect(page.getByRole('heading', { name: TAG })).toBeVisible();
  await expect(async () => {
    await page.getByLabel('I give consent').check();
    await expect(page.getByLabel('I give consent')).toBeChecked({ timeout: 1000 });
  }).toPass();

  const signature = page.getByLabel('Signature — type your full name');
  await signature.fill('Someone Else');
  await page.getByRole('button', { name: 'Sign and submit' }).click();
  await expect(page.getByText('Type your full name: Polly Parent')).toBeVisible();

  await signature.fill('  polly parent ');
  await page.getByRole('button', { name: 'Sign and submit' }).click();
  await expect(page.getByText(/Consent granted by Polly Parent/)).toBeVisible();
  expect(await prisma.consentResponse.count({ where: { formId, value: 'GRANTED' } })).toBe(1);
});
