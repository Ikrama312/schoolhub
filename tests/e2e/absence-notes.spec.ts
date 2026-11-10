import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { formatInTimeZone } from 'date-fns-tz';
import { signInAs } from './helpers/auth';

/**
 * PRD-15 FR-46: a parent reports an absence → the homeroom teacher approves it →
 * the course register shows the student EXCUSED with an "Absence note" badge.
 * Builds its own users/section/course; removed afterwards.
 */
const prisma = new PrismaClient();
const TAG = 'e2e-abs';
const PASSWORD = 'E2e-Absence!2026-pass';
const email = (n: string) => `${TAG}-${n}@schoolhub.test`;
let studentId = '';
let courseId = '';
let periodId = '';
let today = '';

test.use({ bypassCSP: true });
test.describe.configure({ mode: 'serial' });

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: `${TAG}-` } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.absenceNote.deleteMany({ where: { studentId: { in: ids } } });
  const course = await prisma.course.findFirst({ where: { code: TAG } });
  if (course) {
    await prisma.attendanceSession.deleteMany({ where: { courseId: course.id } });
    await prisma.course.delete({ where: { id: course.id } });
  }
  await prisma.sectionMember.deleteMany({ where: { studentId: { in: ids } } });
  await prisma.section.deleteMany({ where: { name: TAG } });
  await prisma.period.deleteMany({ where: { name: TAG } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.emailOutbox.deleteMany({ where: { toEmail: { startsWith: `${TAG}-` } } });
}

test.beforeAll(async () => {
  await cleanup();
  const settings = await prisma.schoolSettings.findUniqueOrThrow({ where: { id: 'singleton' } });
  today = formatInTimeZone(new Date(), settings.timezone, 'yyyy-MM-dd');
  const year = await prisma.academicYear.findFirstOrThrow({ where: { isCurrent: true } });
  const grade = await prisma.gradeLevel.findFirstOrThrow({ orderBy: { order: 'asc' } });
  const subject = await prisma.subject.findFirstOrThrow();
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const mk = (n: string, firstName: string, lastName: string, role: 'TEACHER' | 'STUDENT' | 'PARENT') =>
    prisma.user.create({ data: { email: email(n), firstName, lastName, role, status: 'ACTIVE', passwordHash } });
  const teacher = await mk('teacher', 'Hana', 'Homeroom', 'TEACHER');
  const student = await mk('student', 'Ivy', 'Ill', 'STUDENT');
  const parent = await mk('parent', 'Paul', 'Parent', 'PARENT');
  studentId = student.id;
  await prisma.parentStudentLink.create({ data: { parentId: parent.id, studentId, relationship: 'FATHER', isPrimary: true } });
  const maxOrder = (await prisma.period.aggregate({ _max: { order: true } }))._max.order ?? 0;
  periodId = (await prisma.period.create({ data: { name: TAG, startTime: '00:00', endTime: '23:59', order: maxOrder + 1 } })).id;
  const section = await prisma.section.create({ data: { name: TAG, academicYearId: year.id, gradeLevelId: grade.id, homeroomTeacherId: teacher.id } });
  await prisma.sectionMember.create({ data: { sectionId: section.id, studentId, academicYearId: year.id } });
  courseId = (await prisma.course.create({ data: { name: 'E2E Absence', code: TAG, academicYearId: year.id, subjectId: subject.id, sectionId: section.id, teacherId: teacher.id } })).id;
  await prisma.enrollment.create({ data: { courseId, studentId, enrolledAt: new Date(Date.now() - 30 * 86_400_000) } });
});

test.afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test('parent reports an absence for today', async ({ page }) => {
  await signInAs(page, email('parent'), PASSWORD);
  await page.goto(`/my-children/${studentId}/absence/new`);
  await expect(page.getByRole('heading', { name: 'Report an absence' })).toBeVisible();
  await expect(async () => {
    await page.getByLabel('Details (optional)').fill('Stomach bug');
    await expect(page.getByLabel('Details (optional)')).toHaveValue('Stomach bug', { timeout: 1000 });
  }).toPass();
  await page.getByRole('button', { name: 'Send note' }).click();
  await expect(page.getByText('Absence note sent to the school')).toBeVisible();
  await expect(page.getByText('Pending')).toBeVisible();
});

test('homeroom teacher approves; the register shows EXCUSED with a badge', async ({ page }) => {
  await signInAs(page, email('teacher'), PASSWORD);
  await page.goto('/attendance/absence-notes');
  await page.getByRole('button', { name: 'Review' }).click();
  await expect(page.getByRole('dialog')).toContainText('Ivy Ill');
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText(/^Approved\./)).toBeVisible();

  await page.goto(`/attendance/take/${courseId}?date=${today}&periodId=${periodId}`);
  await expect(page.getByText('Absence note', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark Ivy Ill excused' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Mark Ivy Ill excused' })).toBeEnabled();
});
