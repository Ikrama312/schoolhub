import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { signInAs } from './helpers/auth';

/**
 * PRD-11 NFR-12 / AC-7 / AC-9: an admin generates and publishes report cards for one section;
 * the parent opens the print view and, under print media, the app sidebar is hidden.
 * Builds its own section/course/users (TAG).
 */
const prisma = new PrismaClient();
const TAG = 'e2e-rc';
const PASSWORD = 'E2e-ReportCard!2026';
const email = (n: string) => `${TAG}-${n}@schoolhub.test`;
const ids = {} as Record<'year' | 'term' | 'section' | 'course' | 'admin' | 'teacher' | 'student' | 'parent', string>;

test.use({ bypassCSP: true });
test.describe.configure({ mode: 'serial' });

async function cleanup() {
  const users = (await prisma.user.findMany({ where: { email: { startsWith: `${TAG}-` } }, select: { id: true } })).map((u) => u.id);
  await prisma.reportCard.deleteMany({ where: { studentId: { in: users } } });
  await prisma.course.deleteMany({ where: { code: TAG } });
  await prisma.sectionMember.deleteMany({ where: { studentId: { in: users } } });
  await prisma.section.deleteMany({ where: { name: TAG } });
  await prisma.notification.deleteMany({ where: { userId: { in: users } } });
  await prisma.emailOutbox.deleteMany({ where: { toEmail: { startsWith: `${TAG}-` } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: users } } });
  await prisma.parentStudentLink.deleteMany({ where: { parentId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
}

test.beforeAll(async () => {
  await cleanup();
  const year = await prisma.academicYear.findFirstOrThrow({ where: { isCurrent: true } });
  ids.year = year.id;
  const today = new Date().toISOString().slice(0, 10);
  const terms = await prisma.term.findMany({ where: { academicYearId: year.id } });
  ids.term = (terms.find((t) => t.startDate.toISOString().slice(0, 10) <= today && today <= t.endDate.toISOString().slice(0, 10)) ?? terms[0]).id;
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const mk = (n: string, firstName: string, lastName: string, role: 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT') =>
    prisma.user.create({ data: { email: email(n), firstName, lastName, role, status: 'ACTIVE', passwordHash } }).then((u) => u.id);
  ids.admin = await mk('admin', 'Ada', 'Office', 'ADMIN');
  ids.teacher = await mk('teacher', 'Hal', 'Homeroom', 'TEACHER');
  ids.student = await mk('student', 'Robin', 'Report', 'STUDENT');
  ids.parent = await mk('parent', 'Pam', 'Report', 'PARENT');
  await prisma.parentStudentLink.create({ data: { parentId: ids.parent, studentId: ids.student, relationship: 'MOTHER', isPrimary: true } });
  const gl = await prisma.gradeLevel.findFirstOrThrow({ where: { archivedAt: null } });
  ids.section = (await prisma.section.create({ data: { name: TAG, academicYearId: year.id, gradeLevelId: gl.id, homeroomTeacherId: ids.teacher } })).id;
  await prisma.sectionMember.create({ data: { sectionId: ids.section, studentId: ids.student, academicYearId: year.id } });
  const subject = await prisma.subject.findFirstOrThrow();
  ids.course = (await prisma.course.create({ data: { name: 'E2E Report Maths', code: TAG, academicYearId: year.id, subjectId: subject.id, teacherId: ids.teacher, sectionId: ids.section } })).id;
  await prisma.enrollment.create({ data: { courseId: ids.course, studentId: ids.student } });
  const item = await prisma.gradeItem.create({ data: { courseId: ids.course, termId: ids.term, title: 'Project', maxPoints: '10', source: 'MANUAL' } });
  await prisma.grade.create({ data: { gradeItemId: item.id, studentId: ids.student, score: '9', updatedById: ids.teacher } });
  await prisma.termGradeOverride.create({ data: { courseId: ids.course, termId: ids.term, studentId: ids.student, teacherComment: 'A pleasure to teach', updatedById: ids.teacher } });
});

test.afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test('admin generates and publishes; parent opens the print view without the sidebar (AC-7, AC-9)', async ({ page, browser }) => {
  await signInAs(page, email('admin'), PASSWORD);
  await page.goto('/admin/report-cards');
  await expect(async () => {
    await page.getByLabel('Section').click();
    await page.getByRole('option', { name: TAG }).click({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  await expect(page.getByRole('gridcell', { name: 'Report, Robin' })).toBeVisible();
  await expect(page.getByText('Not generated')).toBeVisible();

  await page.getByRole('button', { name: /Generate drafts \(1\)/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Generate' }).click();
  await expect(page.getByRole('gridcell', { name: 'Draft' })).toBeVisible();

  await page.getByRole('button', { name: /Publish all \(1\)/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByRole('gridcell', { name: 'Published' })).toBeVisible();

  const card = await prisma.reportCard.findUniqueOrThrow({ where: { studentId_termId: { studentId: ids.student, termId: ids.term } } });
  expect(card.status).toBe('PUBLISHED');
  expect(await prisma.notification.count({ where: { type: 'report_card.published', userId: { in: [ids.student, ids.parent] } } })).toBe(2);

  const ctx = await browser.newContext();
  const parent = await ctx.newPage();
  await signInAs(parent, email('parent'), PASSWORD);
  await parent.goto(`/students/${ids.student}/report-cards`);
  await parent.getByRole('link', { name: /Published/ }).first().click();
  await expect(parent).toHaveURL(new RegExp(`/report-cards/${card.id}/print$`));
  const doc = parent.getByRole('article', { name: 'Report card for Robin Report' });
  await expect(doc).toBeVisible();
  await expect(doc.getByText('A pleasure to teach')).toBeVisible();
  await expect(doc.getByText('90.0')).toBeVisible();

  await parent.emulateMedia({ media: 'print' });
  await expect(parent.locator('.MuiDrawer-root').first()).toBeHidden();
  await expect(parent.locator('.MuiAppBar-root').first()).toBeHidden();
  await expect(parent.getByRole('button', { name: 'Print / Save as PDF' })).toBeHidden();
  await expect(doc).toBeVisible();
  await ctx.close();
});
