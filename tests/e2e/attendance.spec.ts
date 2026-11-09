import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { formatInTimeZone } from 'date-fns-tz';
import { signInAs } from './helpers/auth';

/**
 * PRD-07 FR-41 at 375×667 (NFR-4): a teacher takes a register (mark all
 * present, one absent, one late, save); the absent student's parent sees the
 * notification and a red day on the attendance calendar (NFR-5). Builds its
 * own course/period/users so it does not depend on 7A/7B seed data.
 */
const prisma = new PrismaClient();
const TAG = 'e2e-att';
const PASSWORD = 'E2e-Attend!2026-pass';
const email = (n: string) => `${TAG}-${n}@schoolhub.test`;

let courseId = '';
let periodId = '';
let absentId = '';
let today = '';

// bypassCSP: next.config.js's `script-src 'self'` blocks Next's inline hydration scripts
// (pre-existing QA blocker 1, artifacts/qa/qa-report.md). Remove once the CSP is fixed.
test.use({ viewport: { width: 375, height: 667 }, bypassCSP: true });
test.describe.configure({ mode: 'serial' });

async function cleanup() {
  const course = await prisma.course.findFirst({ where: { code: TAG } });
  if (course) {
    await prisma.attendanceSession.deleteMany({ where: { courseId: course.id } });
    await prisma.course.delete({ where: { id: course.id } });
  }
  await prisma.section.deleteMany({ where: { name: TAG } });
  await prisma.period.deleteMany({ where: { name: TAG } });
  const users = await prisma.user.findMany({ where: { email: { startsWith: `${TAG}-` } }, select: { id: true } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: users.map((u) => u.id) } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: `${TAG}-` } } });
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

  const teacher = await mk('teacher', 'Terry', 'Teach', 'TEACHER');
  const students = [await mk('s1', 'Alex', 'Absent', 'STUDENT'), await mk('s2', 'Lee', 'Late', 'STUDENT'), await mk('s3', 'Pat', 'Present', 'STUDENT')];
  const parent = await mk('parent', 'Paula', 'Parent', 'PARENT');
  absentId = students[0].id;
  await prisma.parentStudentLink.create({ data: { parentId: parent.id, studentId: absentId, relationship: 'MOTHER', isPrimary: true } });

  const maxOrder = (await prisma.period.aggregate({ _max: { order: true } }))._max.order ?? 0;
  periodId = (await prisma.period.create({ data: { name: TAG, startTime: '00:00', endTime: '23:59', order: maxOrder + 1 } })).id;
  const section = await prisma.section.create({ data: { name: TAG, academicYearId: year.id, gradeLevelId: grade.id } });
  courseId = (
    await prisma.course.create({
      data: { name: 'E2E Attendance', code: TAG, academicYearId: year.id, subjectId: subject.id, sectionId: section.id, teacherId: teacher.id },
    })
  ).id;
  await prisma.enrollment.createMany({
    data: students.map((s) => ({ courseId, studentId: s.id, enrolledAt: new Date(Date.now() - 30 * 86_400_000) })),
  });
});

test.afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test('teacher takes a register on a phone', async ({ page }) => {
  await signInAs(page, email('teacher'), PASSWORD);
  await page.goto(`/attendance/take/${courseId}?date=${today}&periodId=${periodId}`);
  await expect(page.getByRole('heading', { name: 'E2E Attendance' })).toBeVisible();

  const save = page.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeDisabled(); // FR-13: nobody marked yet

  // Retry until hydrated: a click on server-rendered markup before hydration is a no-op.
  await expect(async () => {
    await page.getByRole('button', { name: 'Mark all present' }).click();
    await expect(page.getByText('Present 3')).toBeVisible({ timeout: 1000 });
  }).toPass();
  await page.getByRole('button', { name: 'Mark Alex Absent absent' }).click();
  await page.getByRole('button', { name: 'Mark Lee Late late' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Minutes late for Lee Late' })).toHaveValue('5');
  // FR-10: only admins can excuse.
  await expect(page.getByRole('button', { name: 'Mark Pat Present excused' })).toBeDisabled();

  await save.click();
  await expect(page.getByText('Attendance saved')).toBeVisible();
  await expect(page.getByText(/Last changed by Terry Teach/)).toBeVisible();
});

test('parent sees the absence notification and a red day', async ({ page }) => {
  await signInAs(page, email('parent'), PASSWORD);
  await page.goto('/notifications');
  await expect(page.getByText('Alex Absent was marked absent')).toBeVisible();

  await page.goto(`/students/${absentId}/attendance`);
  const day = page.getByRole('gridcell', { name: String(Number(today.slice(8))), exact: true });
  await expect(day).toHaveCSS('background-color', /rgb\((185, 28, 28|248, 113, 113)\)/); // error.main, light or dark
  await day.hover();
  await expect(page.getByRole('tooltip')).toContainText('Absent 1');
});
