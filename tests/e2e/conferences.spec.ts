import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { signInAs } from './helpers/auth';

/** PRD-15 FR-46: a parent books a conference slot for their child (own fixtures). */
const prisma = new PrismaClient();
const TAG = 'e2e-conf';
const PASSWORD = 'E2e-Conference!2026-pass';
const email = (n: string) => `${TAG}-${n}@schoolhub.test`;
let eventId = '';
let studentId = '';

test.use({ bypassCSP: true });

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: `${TAG}-` } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.conferenceEvent.deleteMany({ where: { title: TAG } });
  await prisma.course.deleteMany({ where: { code: TAG } });
  await prisma.section.deleteMany({ where: { name: TAG } });
  await prisma.studentProfile.deleteMany({ where: { userId: { in: ids } } });
  await prisma.gradeLevel.deleteMany({ where: { name: TAG } });
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.emailOutbox.deleteMany({ where: { toEmail: { startsWith: `${TAG}-` } } });
}

test.beforeAll(async () => {
  await cleanup();
  const settings = await prisma.schoolSettings.findUniqueOrThrow({ where: { id: 'singleton' } });
  const tz = settings.timezone;
  const date = formatInTimeZone(new Date(Date.now() + 7 * 86_400_000), tz, 'yyyy-MM-dd');
  const year = await prisma.academicYear.findFirstOrThrow({ where: { isCurrent: true } });
  const subject = await prisma.subject.findFirstOrThrow();
  const maxOrder = (await prisma.gradeLevel.aggregate({ _max: { order: true } }))._max.order ?? 0;
  const grade = await prisma.gradeLevel.create({ data: { name: TAG, shortName: TAG, order: maxOrder + 1 + Math.floor(Math.random() * 1000) } }); // random: parallel specs read the same max
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const mk = (n: string, firstName: string, lastName: string, role: 'TEACHER' | 'STUDENT' | 'PARENT') =>
    prisma.user.create({ data: { email: email(n), firstName, lastName, role, status: 'ACTIVE', passwordHash } });
  const teacher = await mk('teacher', 'Carl', 'Conference', 'TEACHER');
  const student = await mk('student', 'Bea', 'Booked', 'STUDENT');
  const parent = await mk('parent', 'Pia', 'Parent', 'PARENT');
  studentId = student.id;
  await prisma.studentProfile.create({ data: { userId: studentId, admissionNumber: TAG, dateOfBirth: new Date('2014-01-01'), gradeLevelId: grade.id, enrollmentDate: new Date('2026-08-17') } });
  await prisma.parentStudentLink.create({ data: { parentId: parent.id, studentId, relationship: 'MOTHER', isPrimary: true } });
  const section = await prisma.section.create({ data: { name: TAG, academicYearId: year.id, gradeLevelId: grade.id } });
  const course = await prisma.course.create({ data: { name: 'E2E Conf', code: TAG, academicYearId: year.id, subjectId: subject.id, sectionId: section.id, teacherId: teacher.id } });
  await prisma.enrollment.create({ data: { courseId: course.id, studentId } });
  const event = await prisma.conferenceEvent.create({
    data: {
      title: TAG,
      date: new Date(`${date}T00:00:00Z`),
      bookingOpensAt: new Date(Date.now() - 3_600_000),
      bookingClosesAt: fromZonedTime(`${date}T00:00:00`, tz),
      slotMinutes: 10,
      gradeLevelIds: [grade.id],
      createdById: teacher.id,
    },
  });
  eventId = event.id;
  await prisma.conferenceSlot.createMany({
    data: ['15:00', '15:10'].map((t) => {
      const startsAt = fromZonedTime(`${date}T${t}:00`, tz);
      return { eventId, teacherId: teacher.id, startsAt, endsAt: new Date(startsAt.getTime() + 600_000) };
    }),
  });
});

test.afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test('parent books a slot with a note', async ({ page }) => {
  await signInAs(page, email('parent'), PASSWORD);
  await page.goto(`/conferences/${eventId}?studentId=${studentId}`);
  await expect(page.getByRole('heading', { name: TAG })).toBeVisible();
  await expect(async () => {
    await page.getByRole('button', { name: 'Book 15:00 with Carl Conference' }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 1000 });
  }).toPass();
  await page.getByLabel('Note for the teacher (optional)').fill('Reading progress');
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(page.getByText('Booked for Bea: 15:00–15:10')).toBeVisible();
  const slot = await prisma.conferenceSlot.findFirstOrThrow({ where: { eventId, bookedForStudentId: studentId } });
  expect(slot.parentNote).toBe('Reading progress');
});
