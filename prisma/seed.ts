import { PrismaClient, type Role } from '@prisma/client';
import bcrypt from 'bcrypt';
import { logger } from '../src/lib/logger';

// `npm run db:seed` is plain tsx, which doesn't read .env; env.ts (via the auth
// modules imported below) validates process.env at load, so load it first.
try {
  process.loadEnvFile();
} catch {
  // No .env file: rely on the real environment.
}

const prisma = new PrismaClient();

const SEED_PASSWORD = 'SchoolHub123!';
const SEED_USERS: { email: string; firstName: string; lastName: string; role: Role }[] = [
  { email: 'admin@schoolhub.test', firstName: 'Alice', lastName: 'Admin', role: 'ADMIN' },
  { email: 'teacher@schoolhub.test', firstName: 'Tom', lastName: 'Teacher', role: 'TEACHER' },
  { email: 'teacher2@schoolhub.test', firstName: 'Tina', lastName: 'Tutor', role: 'TEACHER' },
  { email: 'student@schoolhub.test', firstName: 'Sam', lastName: 'Student', role: 'STUDENT' },
  { email: 'student2@schoolhub.test', firstName: 'Sara', lastName: 'Scholar', role: 'STUDENT' },
  { email: 'parent@schoolhub.test', firstName: 'Pat', lastName: 'Parent', role: 'PARENT' },
];

/** PRD-01 FR-28–FR-31: demo accounts. update:{} so a re-run never resets a changed password. */
async function seedUsers() {
  // Dynamic imports: these pull in env.ts, which must see the .env loaded above.
  const { createInviteToken } = await import('../src/server/services/users');
  const { authLink } = await import('../src/server/auth/email');
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 12);
  const now = new Date();
  for (const user of SEED_USERS) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: {},
      create: { ...user, status: 'ACTIVE', passwordHash, passwordChangedAt: now },
    });
  }
  logger.info('Seed: demo users ready', { count: SEED_USERS.length });

  const invited = await prisma.user.upsert({
    where: { email: 'invited@schoolhub.test' },
    update: {},
    create: {
      email: 'invited@schoolhub.test',
      firstName: 'Ivy',
      lastName: 'Invited',
      role: 'TEACHER',
      status: 'INVITED',
      passwordHash: null,
    },
  });
  if (invited.status === 'INVITED') {
    // FR-30/FR-31: log the link instead of emailing it (no sendAuthEmail in the seed).
    const raw = await createInviteToken(invited.id);
    logger.info('Seed: invite link for invited@schoolhub.test', { link: authLink('invite', raw) });
  }
}

/**
 * Idempotent: upsert on the fixed "singleton" id, so re-running the seed
 * never creates a duplicate SchoolSettings row.
 */
async function main() {
  await prisma.schoolSettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: {
      id: 'singleton',
      name: 'SchoolHub Academy',
      shortName: 'SchoolHub',
      timezone: 'America/New_York',
      city: 'Springfield',
      country: 'USA',
      phone: '+1 555 0100',
      email: 'office@schoolhub.test',
    },
  });

  const year = await prisma.academicYear.upsert({
    where: { name: '2026-2027' },
    update: { isCurrent: true },
    create: {
      name: '2026-2027',
      startDate: new Date('2026-08-17'),
      endDate: new Date('2027-06-11'),
      isCurrent: true,
    },
  });

  const semesters: { name: string; startDate: string; endDate: string; order: number }[] = [
    { name: 'Semester 1', startDate: '2026-08-17', endDate: '2027-01-15', order: 1 },
    { name: 'Semester 2', startDate: '2027-01-18', endDate: '2027-06-11', order: 2 },
  ];
  for (const term of semesters) {
    await prisma.term.upsert({
      where: { academicYearId_name: { academicYearId: year.id, name: term.name } },
      update: {},
      create: {
        academicYearId: year.id,
        name: term.name,
        startDate: new Date(term.startDate),
        endDate: new Date(term.endDate),
        order: term.order,
      },
    });
  }

  const gradeLevels = [
    { name: 'Grade 6', shortName: 'G6', order: 1 },
    { name: 'Grade 7', shortName: 'G7', order: 2 },
    { name: 'Grade 8', shortName: 'G8', order: 3 },
  ];
  for (const grade of gradeLevels) {
    await prisma.gradeLevel.upsert({ where: { name: grade.name }, update: {}, create: grade });
  }

  const subjects = [
    { name: 'Mathematics', code: 'MATH', color: '#4F46E5' },
    { name: 'English Language Arts', code: 'ELA', color: '#0EA5E9' },
    { name: 'Science', code: 'SCI', color: '#16A34A' },
    { name: 'Social Studies', code: 'SOC', color: '#D97706' },
    { name: 'Physical Education', code: 'PE', color: '#DC2626' },
    { name: 'Art', code: 'ART', color: '#9333EA' },
  ];
  for (const subject of subjects) {
    await prisma.subject.upsert({ where: { code: subject.code }, update: {}, create: subject });
  }

  const rooms = [
    { name: 'Room 101', building: 'Main Building', capacity: 30 },
    { name: 'Room 102', building: 'Main Building', capacity: 28 },
    { name: 'Science Lab A', building: 'Science Wing', capacity: 24 },
    { name: 'Gymnasium', building: 'Athletics Building', capacity: 120 },
    { name: 'Art Studio', building: 'Main Building', capacity: 20 },
  ];
  for (const room of rooms) {
    await prisma.room.upsert({ where: { name: room.name }, update: {}, create: room });
  }

  await seedUsers();

  // PRD-04 FR-40: 3 system.test notifications (1 read, 2 unread) per demo user.
  // Users are owned by another PRD's seed, so a missing one is skipped, never created.
  for (const email of ['student@schoolhub.test', 'parent@schoolhub.test']) {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) {
      console.log(`Seed: ${email} not found, skipping demo notifications`);
      continue;
    }
    const existing = await prisma.notification.count({ where: { userId: user.id, type: 'system.test' } });
    if (existing > 0) continue;
    await prisma.notification.createMany({
      data: [
        { title: 'Welcome to SchoolHub', body: 'Your notifications will appear here.', readAt: new Date() },
        { title: 'Check your dashboard', body: 'See what is new this week.', readAt: null },
        { title: 'Notification preferences', body: 'Choose how you hear about activity.', readAt: null },
      ].map((n) => ({ ...n, userId: user.id, type: 'system.test', link: '/dashboard' })),
    });
  }

  await seedAttendance();
  await seedAssignments();
  await seedQuizzes();
  await seedGradebook();
  await seedMessaging();
  await seedParentPortal();
  await seedRiskCohort();
}

/** Deterministic PRNG so every seed run produces the same attendance (FR-38). */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * PRD-07 FR-38: 7A/7B course sessions for every timetable slot over the 15
 * teaching days before today; ~94% P / 3% L (5-20 min) / 3% A, with two named
 * Grade 7 students forced below 85%. Idempotent: the window's sessions are
 * deleted first. Sections, courses and slots are owned by other PRDs' data,
 * so if 7A/7B (or their slots) are missing this is skipped, never created.
 */
async function seedAttendance() {
  const { schoolToday, addDays } = await import('../src/server/attendance/attendance-rules');
  const settings = await prisma.schoolSettings.findUniqueOrThrow({ where: { id: 'singleton' } });
  const sections = await prisma.section.findMany({
    where: { name: { in: ['7A', '7B'] }, academicYear: { isCurrent: true } },
    select: { id: true },
  });
  const slots = await prisma.timetableSlot.findMany({
    where: { course: { sectionId: { in: sections.map((s) => s.id) }, archivedAt: null } },
    select: {
      dayOfWeek: true,
      periodId: true,
      course: {
        select: {
          id: true,
          teacherId: true,
          enrollments: { where: { status: 'ACTIVE' }, select: { student: { select: { id: true, email: true, lastName: true } } } },
        },
      },
    },
  });
  if (!slots.length) {
    console.log('Seed: no 7A/7B timetable slots found, skipping demo attendance');
    return;
  }

  const teachingDays = new Set(
    (await prisma.schoolDay.findMany({ where: { isTeaching: true } })).map((d) => d.dayOfWeek),
  );
  const isTeaching = (d: string) => {
    const iso = new Date(`${d}T12:00:00Z`).getUTCDay() || 7;
    return teachingDays.size ? teachingDays.has(iso) : iso <= 5;
  };
  const days: string[] = [];
  for (let d = addDays(schoolToday(new Date(), settings.timezone), -1); days.length < 15; d = addDays(d, -1)) {
    if (isTeaching(d)) days.unshift(d);
  }

  // Two named students forced below 85%: the demo student accounts if enrolled, else the first two by last name.
  const roster = [...new Map(slots.flatMap((s) => s.course.enrollments.map((e) => [e.student.id, e.student]))).values()];
  const named = roster.filter((s) => ['student@schoolhub.test', 'student2@schoolhub.test'].includes(s.email));
  const low = new Set(
    (named.length === 2 ? named : [...roster].sort((a, b) => a.lastName.localeCompare(b.lastName)).slice(0, 2)).map((s) => s.id),
  );

  const courseIds = [...new Set(slots.map((s) => s.course.id))];
  const dbDate = (d: string) => new Date(`${d}T00:00:00Z`);
  await prisma.attendanceSession.deleteMany({
    where: { courseId: { in: courseIds }, date: { gte: dbDate(days[0]), lte: dbDate(days[days.length - 1]) } },
  });

  const rng = mulberry32(20261107);
  let sessions = 0;
  for (const [dayIndex, day] of days.entries()) {
    const iso = new Date(`${day}T12:00:00Z`).getUTCDay() || 7;
    for (const slot of slots.filter((s) => s.dayOfWeek === iso)) {
      const records = slot.course.enrollments.map(({ student }) => {
        const r = rng();
        // Absent every 4th teaching day: 4 of 15 days -> 73% (< 85%) whatever the RNG does.
        if (low.has(student.id)) return { studentId: student.id, status: dayIndex % 4 === 0 ? ('ABSENT' as const) : ('PRESENT' as const) };
        if (r < 0.94) return { studentId: student.id, status: 'PRESENT' as const };
        if (r < 0.97) return { studentId: student.id, status: 'LATE' as const, minutesLate: 5 + Math.floor(rng() * 16) };
        return { studentId: student.id, status: 'ABSENT' as const };
      });
      await prisma.attendanceSession.create({
        data: {
          courseId: slot.course.id,
          periodId: slot.periodId,
          date: dbDate(day),
          takenById: slot.course.teacherId,
          updatedById: slot.course.teacherId,
          records: { create: records },
        },
      });
      sessions += 1;
    }
  }
  logger.info('Seed: demo attendance ready', { sessions, days: days.length, lowAttendance: low.size });
}

/**
 * PRD-09 FR-61: demo assignments. Courses are owned by other PRDs' data, so a missing course is
 * skipped, never created. Idempotent: an assignment that already exists (courseId + title) is left
 * alone, together with its submissions. Decimals are strings; no file bytes are seeded.
 */
async function seedAssignments() {
  const DAY = 86_400_000;
  const now = Date.now();
  const rand = mulberry32(909);
  const findCourse = (codes: string[]) =>
    prisma.course.findFirst({
      where: { code: { in: codes }, archivedAt: null, academicYear: { isCurrent: true } },
      select: { id: true, teacherId: true, enrollments: { where: { status: 'ACTIVE' }, select: { studentId: true }, orderBy: { studentId: 'asc' } } },
    });
  type Course = NonNullable<Awaited<ReturnType<typeof findCourse>>>;
  const pct = (lo: number, hi: number) => lo + rand() * (hi - lo);
  const money = (n: number) => n.toFixed(2);

  async function make(course: Course, title: string, data: Record<string, unknown>) {
    const existing = await prisma.assignment.findFirst({ where: { courseId: course.id, title }, select: { id: true } });
    if (existing) return null;
    const visible = data.status !== 'DRAFT';
    return prisma.assignment.create({
      data: {
        courseId: course.id,
        title,
        instructions: `## ${title}\n\nComplete every question and show your working.`,
        submissionType: 'ONLINE_TEXT',
        maxPoints: '20',
        status: 'PUBLISHED',
        createdById: course.teacherId,
        notifiedAt: visible ? new Date() : null,
        ...data,
      } as Parameters<typeof prisma.assignment.create>[0]['data'],
    });
  }

  let created = 0;
  const math = await findCourse(['MATH-7A']);
  if (!math) console.log('Seed: MATH-7A not found, skipping its assignments');
  else {
    const students = math.enrollments.map((e) => e.studentId);
    const returned = await make(math, 'Fractions worksheet', { dueAt: new Date(now - 14 * DAY) });
    if (returned) {
      created++;
      for (const studentId of students) {
        const raw = money((20 * Math.round(pct(55, 100))) / 100);
        await prisma.submission.create({
          data: {
            assignmentId: returned.id, studentId, status: 'RETURNED', text: 'My answers are attached above.', attemptNumber: 1,
            submittedAt: new Date(now - 15 * DAY), rawScore: raw, penaltyPercent: '0', finalScore: raw, feedback: 'Good effort — check question 4.',
            gradedById: math.teacherId, gradedAt: new Date(now - 12 * DAY), returnedAt: new Date(now - 12 * DAY),
          },
        });
      }
    }
    const pending = await make(math, 'Decimals practice', {
      dueAt: new Date(now - 2 * DAY), allowLate: true, latePenaltyPercentPerDay: '10', maxLatePenaltyPercent: '50',
    });
    if (pending) {
      created++;
      const submitters = students.slice(0, Math.round(students.length * 0.6));
      for (const [i, studentId] of submitters.entries()) {
        const late = i < 2;
        await prisma.submission.create({
          data: {
            assignmentId: pending.id, studentId, status: 'SUBMITTED', text: 'Worked answers: 0.25, 0.4, 1.75 …', attemptNumber: 1,
            submittedAt: new Date(pending.dueAt.getTime() + (late ? 0.5 * DAY : -DAY)), isLate: late, lateDays: late ? 1 : 0,
          },
        });
      }
    }
    if (await make(math, 'Geometry problem set', { dueAt: new Date(now + 2 * DAY), submissionType: 'TEXT_AND_FILE' })) created++;
    if (await make(math, 'Statistics project', { dueAt: new Date(now + 14 * DAY), status: 'DRAFT', maxPoints: '50' })) created++;
  }

  const eng = await findCourse(['ENG-7A', 'ELA-7A']);
  if (!eng) console.log('Seed: ENG-7A/ELA-7A not found, skipping its assignments');
  else {
    const criteria = [
      { title: 'Argument', maxPoints: '10' },
      { title: 'Evidence', maxPoints: '10' },
      { title: 'Writing style', maxPoints: '10' },
    ];
    const exists = await prisma.assignment.findFirst({ where: { courseId: eng.id, title: 'Persuasive essay' }, select: { id: true } });
    if (!exists) {
      const rubric = await prisma.rubric.create({
        data: {
          criteria: {
            create: criteria.map((c, order) => ({
              ...c, order,
              levels: [
                { label: 'Excellent', points: '10', description: '' },
                { label: 'Good', points: '7', description: '' },
                { label: 'Developing', points: '4', description: '' },
              ],
            })),
          },
        },
        include: { criteria: { orderBy: { order: 'asc' } } },
      });
      const essay = await make(eng, 'Persuasive essay', { dueAt: new Date(now - 10 * DAY), maxPoints: '30', rubricId: rubric.id });
      if (essay) {
        created++;
        for (const { studentId } of eng.enrollments) {
          const scores = rubric.criteria.map((c) => ({ criterionId: c.id, points: ['10.00', '7.00', '4.00'][Math.floor(rand() * 3)] }));
          const raw = money(scores.reduce((sum, x) => sum + Number(x.points), 0));
          await prisma.submission.create({
            data: {
              assignmentId: essay.id, studentId, status: 'RETURNED', text: 'Schools should start later because …', attemptNumber: 1,
              submittedAt: new Date(now - 11 * DAY), rawScore: raw, penaltyPercent: '0', finalScore: raw, rubricScores: scores,
              feedback: 'Clear position. Add more evidence.', gradedById: eng.teacherId, gradedAt: new Date(now - 8 * DAY), returnedAt: new Date(now - 8 * DAY),
            },
          });
        }
      }
    }
    if (await make(eng, 'Reading journal', { dueAt: new Date(now + 5 * DAY) })) created++;
  }

  const sci = await findCourse(['SCI-7A']);
  if (!sci) console.log('Seed: SCI-7A not found, skipping its assignments');
  else {
    const lab = await make(sci, 'Lab safety practical', { dueAt: new Date(now - 5 * DAY), submissionType: 'NO_SUBMISSION', maxPoints: '10' });
    if (lab) {
      created++;
      for (const { studentId } of sci.enrollments) {
        const raw = money(Math.round(pct(6, 10)));
        const at = new Date(now - 4 * DAY);
        // FR-8 offline grade: attempt 0, no text, submittedAt = gradedAt.
        await prisma.submission.create({
          data: {
            assignmentId: lab.id, studentId, status: 'RETURNED', text: null, attemptNumber: 0, submittedAt: at,
            rawScore: raw, penaltyPercent: '0', finalScore: raw, gradedById: sci.teacherId, gradedAt: at, returnedAt: at,
          },
        });
      }
    }
  }
  logger.info('Seed: demo assignments ready', { created });
}

/**
 * PRD-10 FR-36: three demo quizzes, idempotent by (courseId, title). Attempt scores come from the
 * real grading rules (src/server/quiz/grading.ts), so seeded results match what the app computes.
 */
async function seedQuizzes() {
  const { gradeAnswer, needsReview } = await import('../src/server/quiz/grading');
  const DAY = 86_400_000;
  const now = Date.now();
  const rand = mulberry32(1010);
  const findCourse = (codes: string[]) =>
    prisma.course.findFirst({
      where: { code: { in: codes }, archivedAt: null, academicYear: { isCurrent: true } },
      select: { id: true, teacherId: true, enrollments: { where: { status: 'ACTIVE' }, select: { studentId: true }, orderBy: { studentId: 'asc' } } },
    });
  type Q = { type: 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'TRUE_FALSE' | 'SHORT_ANSWER' | 'ESSAY'; prompt: string; points: string; options?: { id: string; text: string }[]; correct: Record<string, unknown>; explanation?: string };
  const opts = (...t: string[]) => t.map((text, i) => ({ id: `o${i + 1}`, text }));
  const sc = (prompt: string, choices: string[], right: number, points = '1'): Q => ({ type: 'SINGLE_CHOICE', prompt, points, options: opts(...choices), correct: { optionId: `o${right + 1}` } });
  const mc = (prompt: string, choices: string[], right: number[], points = '2'): Q => ({ type: 'MULTIPLE_CHOICE', prompt, points, options: opts(...choices), correct: { optionIds: right.map((r) => `o${r + 1}`) } });
  const tf = (prompt: string, value: boolean): Q => ({ type: 'TRUE_FALSE', prompt, points: '1', correct: { value } });
  const sa = (prompt: string, accepted: string[], points = '2'): Q => ({ type: 'SHORT_ANSWER', prompt, points, correct: { accepted } });
  const essay = (prompt: string, points = '5'): Q => ({ type: 'ESSAY', prompt, points, correct: { guidance: 'Look for a clear claim, an example and correct vocabulary.' } });

  async function make(course: { id: string; teacherId: string }, title: string, data: Record<string, unknown>, questions: Q[]) {
    if (await prisma.quiz.findFirst({ where: { courseId: course.id, title }, select: { id: true } })) return null;
    return prisma.quiz.create({
      data: {
        courseId: course.id,
        title,
        createdById: course.teacherId,
        instructions: `Answer every question. Your answers save automatically.`,
        ...data,
        questions: { create: questions.map((q, order) => ({ ...q, order, explanation: q.explanation ?? null })) },
      } as Parameters<typeof prisma.quiz.create>[0]['data'],
      include: { questions: { orderBy: { order: 'asc' } } },
    });
  }

  /** A plausible student response: right ~70 % of the time. */
  function respond(q: Q): unknown {
    const right = rand() < 0.7;
    switch (q.type) {
      case 'SINGLE_CHOICE':
        return { optionId: right ? q.correct.optionId : q.options!.find((o) => o.id !== q.correct.optionId)!.id };
      case 'MULTIPLE_CHOICE':
        return { optionIds: right ? q.correct.optionIds : [(q.correct.optionIds as string[])[0], q.options!.find((o) => !(q.correct.optionIds as string[]).includes(o.id))!.id] };
      case 'TRUE_FALSE':
        return { value: right ? q.correct.value : !q.correct.value };
      case 'SHORT_ANSWER':
        return { text: right ? ` ${(q.correct.accepted as string[])[0]} ` : 'not sure' };
      default:
        return { text: 'My answer.' };
    }
  }

  let created = 0;
  const math = await findCourse(['MATH-7A']);
  if (!math) console.log('Seed: MATH-7A not found, skipping its quizzes');
  else {
    const fractions = await make(
      math,
      'Fractions Check',
      { availableFrom: new Date(now - 10 * DAY), availableUntil: new Date(now - 7 * DAY), timeLimitMinutes: 20, resultsVisibility: 'IMMEDIATELY', status: 'CLOSED' },
      [
        sc('What is 1/2 + 1/4?', ['3/4', '2/6', '1/6', '1'], 0),
        sc('Which fraction is equivalent to 2/3?', ['4/6', '3/4', '2/5', '6/8'], 0),
        mc('Select every fraction greater than 1/2.', ['3/4', '2/5', '5/8', '1/3'], [0, 2], '4'),
        mc('Select the improper fractions.', ['7/4', '3/8', '9/5', '1/2'], [0, 2]),
        tf('3/6 is equal to 1/2.', true),
        tf('1/3 is greater than 1/2.', false),
        sa('Write 0.5 as a fraction in lowest terms.', ['1/2', 'one half']),
        sa('What is the denominator of 5/9?', ['9', 'nine'], '1'),
      ],
    );
    if (fractions) {
      created++;
      for (const { studentId } of math.enrollments) {
        const startedAt = new Date(fractions.availableFrom.getTime() + DAY + Math.floor(rand() * 3_600_000));
        const submittedAt = new Date(startedAt.getTime() + (8 + Math.floor(rand() * 10)) * 60_000);
        const answers = fractions.questions.map((q) => {
          const response = respond(q as unknown as Q);
          const g = gradeAnswer(q, response);
          // Unmatched short answers were reviewed by the teacher (kept at 0) so every attempt is GRADED.
          const gradedById = needsReview(q, { isCorrect: g.isCorrect, gradedById: null }) ? math.teacherId : null;
          return { questionId: q.id, response: response as object, pointsAwarded: g.pointsAwarded?.toFixed(2) ?? null, isCorrect: g.isCorrect, gradedById };
        });
        const score = answers.reduce((s, a) => s + Number(a.pointsAwarded ?? 0), 0);
        const maxScore = fractions.questions.reduce((s, q) => s + Number(q.points), 0);
        await prisma.quizAttempt.create({
          data: {
            quizId: fractions.id, studentId, attemptNumber: 1, status: 'GRADED', startedAt, submittedAt,
            deadlineAt: new Date(startedAt.getTime() + 20 * 60_000), questionOrder: fractions.questions.map((q) => q.id),
            score: score.toFixed(2), maxScore: maxScore.toFixed(2), answers: { create: answers },
          },
        });
      }
    }
    const unit1 = await make(
      math,
      'Unit 1 Test',
      { availableFrom: new Date(now - 60 * 60_000), availableUntil: new Date(now + 3 * DAY), timeLimitMinutes: 45, resultsVisibility: 'AFTER_CLOSE', status: 'PUBLISHED', shuffleOptions: true },
      [
        sc('Round 3.46 to one decimal place.', ['3.5', '3.4', '3.0', '4'], 0),
        sc('What is 15% of 200?', ['30', '15', '20', '45'], 0),
        sc('Which is a prime number?', ['17', '21', '27', '33'], 0),
        mc('Select the multiples of 4.', ['12', '18', '20', '30'], [0, 2]),
        mc('Select the even numbers.', ['14', '9', '22', '35'], [0, 2]),
        tf('0.25 = 1/4', true),
        tf('A negative number times a negative number is negative.', false),
        tf('The sum of angles in a triangle is 180°.', true),
        sa('What is 7 × 8?', ['56', 'fifty-six', 'fifty six'], '1'),
        sa('Name the longest side of a right-angled triangle.', ['hypotenuse']),
        essay('Explain, with an example, how you would compare two fractions with different denominators.'),
        essay('Describe a real-life situation where percentages are useful and show a calculation.'),
      ],
    );
    if (unit1) created++;
  }

  const eng = await findCourse(['ENG-7A', 'ELA-7A']);
  if (!eng) console.log('Seed: ENG-7A/ELA-7A not found, skipping its quizzes');
  else if (
    await make(
      eng,
      'Parts of Speech',
      { availableFrom: new Date(now - 7 * DAY), availableUntil: new Date(now + 30 * DAY), isPractice: true, maxAttempts: 3, scoringPolicy: 'HIGHEST', resultsVisibility: 'IMMEDIATELY', status: 'PUBLISHED' },
      [
        sc('In "The dog barked loudly", which word is the adverb?', ['loudly', 'dog', 'barked', 'the'], 0),
        sc('Which word is a noun?', ['happiness', 'quickly', 'run', 'blue'], 0),
        mc('Select the adjectives.', ['bright', 'swim', 'tall', 'under'], [0, 2]),
        tf('"And" is a conjunction.', true),
        sa('What part of speech is "under" in "under the bridge"?', ['preposition']),
      ],
    )
  )
    created++;
  logger.info('Seed: demo quizzes ready', { created });
}

/** PRD-11 seed: default scale, 7A categories, backfill, ENG-7A manual item, S1 comments, 7A drafts. Idempotent. */
const STANDARD_BANDS: { letter: string; minPercent: number; gpa: number; descriptor: string }[] = [
  { letter: 'A', minPercent: 93, gpa: 4.0, descriptor: 'Excellent' },
  { letter: 'A-', minPercent: 90, gpa: 3.7, descriptor: 'Excellent' },
  { letter: 'B+', minPercent: 87, gpa: 3.3, descriptor: 'Very good' },
  { letter: 'B', minPercent: 83, gpa: 3.0, descriptor: 'Good' },
  { letter: 'B-', minPercent: 80, gpa: 2.7, descriptor: 'Good' },
  { letter: 'C+', minPercent: 77, gpa: 2.3, descriptor: 'Satisfactory' },
  { letter: 'C', minPercent: 73, gpa: 2.0, descriptor: 'Satisfactory' },
  { letter: 'C-', minPercent: 70, gpa: 1.7, descriptor: 'Satisfactory' },
  { letter: 'D+', minPercent: 67, gpa: 1.3, descriptor: 'Needs improvement' },
  { letter: 'D', minPercent: 63, gpa: 1.0, descriptor: 'Needs improvement' },
  { letter: 'D-', minPercent: 60, gpa: 0.7, descriptor: 'Needs improvement' },
  { letter: 'F', minPercent: 0, gpa: 0, descriptor: 'Failing' },
];

async function seedGradebook() {
  if (!(await prisma.gradingScale.findFirst({ where: { name: 'Standard A–F' } }))) {
    const hasDefault = (await prisma.gradingScale.count({ where: { isDefault: true } })) > 0;
    await prisma.gradingScale.create({ data: { name: 'Standard A–F', isDefault: !hasDefault, bands: STANDARD_BANDS } });
  }

  const courses = await prisma.course.findMany({
    where: { archivedAt: null, academicYear: { isCurrent: true }, section: { name: '7A' } },
    select: { id: true, code: true, teacherId: true, _count: { select: { gradeCategories: true } } },
  });
  if (!courses.length) {
    logger.info('Seed: no 7A courses, skipping gradebook demo data');
    return;
  }
  // Categories go in before the backfill so seeded assignments/quizzes land in them (FR-41).
  for (const c of courses) {
    if (c._count.gradeCategories > 0) continue;
    const [hw, quizzes, exams] = await Promise.all([
      prisma.gradeCategory.create({ data: { courseId: c.id, name: 'Homework', weightPercent: '30', dropLowest: 1, order: 0 } }),
      prisma.gradeCategory.create({ data: { courseId: c.id, name: 'Quizzes', weightPercent: '30', order: 1 } }),
      prisma.gradeCategory.create({ data: { courseId: c.id, name: 'Exams', weightPercent: '40', order: 2 } }),
    ]);
    await prisma.assignment.updateMany({ where: { courseId: c.id, categoryId: null }, data: { categoryId: hw.id } });
    await prisma.quiz.updateMany({ where: { courseId: c.id, categoryId: null, isPractice: false, title: { contains: 'Test', mode: 'insensitive' } }, data: { categoryId: exams.id } });
    await prisma.quiz.updateMany({ where: { courseId: c.id, categoryId: null, isPractice: false }, data: { categoryId: quizzes.id } });
    await prisma.gradeItem.updateMany({ where: { courseId: c.id, categoryId: null, source: 'ASSIGNMENT' }, data: { categoryId: hw.id } });
  }

  const { backfillGradebook } = await import('../src/server/gradebook/backfill');
  logger.info('Seed: gradebook backfill', await backfillGradebook());

  const year = await prisma.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
  const s1 = year && (await prisma.term.findFirst({ where: { academicYearId: year.id, name: 'Semester 1' } }));
  if (!s1) return;

  const eng = courses.find((c) => c.code === 'ENG-7A' || c.code === 'ELA-7A');
  const math = courses.find((c) => c.code === 'MATH-7A');
  if (eng) {
    const exams = await prisma.gradeCategory.findFirst({ where: { courseId: eng.id, name: 'Exams' }, select: { id: true } });
    const item =
      (await prisma.gradeItem.findFirst({ where: { courseId: eng.id, title: 'Oral presentation', source: 'MANUAL' } })) ??
      (await prisma.gradeItem.create({
        data: { courseId: eng.id, termId: s1.id, categoryId: exams?.id ?? null, title: 'Oral presentation', maxPoints: '20', dueAt: new Date('2026-10-30T20:00:00Z'), source: 'MANUAL' },
      }));
    const roster = await prisma.enrollment.findMany({ where: { courseId: eng.id, status: 'ACTIVE' }, select: { studentId: true }, orderBy: { studentId: 'asc' } });
    await prisma.grade.createMany({
      data: roster.map((r, i) => ({ gradeItemId: item.id, studentId: r.studentId, score: String(14 + (i % 7)), updatedById: eng.teacherId })),
      skipDuplicates: true,
    });
  }
  const comments: Record<string, string> = {
    'MATH-7A': 'Works carefully and shows clear reasoning. Keep practising fractions.',
    'ENG-7A': 'Reads widely and speaks with confidence. Focus on editing written work.',
    'ELA-7A': 'Reads widely and speaks with confidence. Focus on editing written work.',
  };
  for (const c of [math, eng]) {
    if (!c) continue;
    const roster = await prisma.enrollment.findMany({ where: { courseId: c.id, status: 'ACTIVE' }, select: { studentId: true } });
    for (const r of roster) {
      await prisma.termGradeOverride.upsert({
        where: { courseId_termId_studentId: { courseId: c.id, termId: s1.id, studentId: r.studentId } },
        create: { courseId: c.id, termId: s1.id, studentId: r.studentId, teacherComment: comments[c.code], updatedById: c.teacherId },
        update: {},
      });
    }
  }

  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN', status: 'ACTIVE' }, select: { id: true } });
  const members = await prisma.sectionMember.findMany({ where: { academicYearId: year.id, section: { name: '7A' } }, select: { studentId: true } });
  if (admin && members.length) {
    const { generateDrafts } = await import('../src/server/report-cards/report-card-service');
    logger.info('Seed: 7A Semester 1 report card drafts', await generateDrafts({ id: admin.id, role: 'ADMIN' }, { termId: s1.id, studentIds: members.map((m) => m.studentId) }));
  }
}

/**
 * PRD-13 FR-29: Alice is the safeguarding lead, Pat↔Sam are linked, and four demo threads.
 * Each thread is idempotent (looked up by subject) and checked against the real contact rules;
 * a block whose prerequisites are missing is skipped with logger.warn, never forced.
 */
async function seedMessaging() {
  const { loadRelations, checkNewConversation } = await import('../src/server/messaging/contact-rules');
  const byEmail = (email: string) => prisma.user.findUnique({ where: { email }, select: { id: true, role: true } });
  const [alice, tom, tina, sam, pat] = await Promise.all(
    ['admin@schoolhub.test', 'teacher@schoolhub.test', 'teacher2@schoolhub.test', 'student@schoolhub.test', 'parent@schoolhub.test'].map(byEmail),
  );

  if (alice?.role === 'ADMIN') await prisma.user.update({ where: { id: alice.id }, data: { isSafeguardingLead: true } });
  else logger.warn('Seed: Alice Admin not found, skipping safeguarding lead');

  if (pat && sam) {
    const hasPrimary = (await prisma.parentStudentLink.count({ where: { studentId: sam.id, isPrimary: true } })) > 0;
    await prisma.parentStudentLink.upsert({
      where: { parentId_studentId: { parentId: pat.id, studentId: sam.id } },
      update: {},
      create: { parentId: pat.id, studentId: sam.id, relationship: 'GUARDIAN', isPrimary: !hasPrimary },
    });
  }

  type U = { id: string; role: Role };
  const HOUR = 3_600_000;
  /** Creates one thread; messages are [participant index, body], oldest first. Returns message ids or null if skipped. */
  async function thread(subject: string, members: (U | null | undefined)[], messages: [number, string][]): Promise<string[] | null> {
    if (members.some((m) => !m)) {
      logger.warn('Seed: messaging prerequisites missing, skipping thread', { subject });
      return null;
    }
    if (await prisma.conversation.findFirst({ where: { subject }, select: { id: true } })) return null;
    const [creator, ...others] = members as U[];
    const rel = await loadRelations(members.map((m) => m!.id));
    const problem = checkNewConversation(creator, others.map((o) => o.id), rel);
    if (problem) {
      logger.warn('Seed: thread would break contact rules, skipping', { subject, problem });
      return null;
    }
    const start = Date.now() - messages.length * 2 * HOUR;
    const at = (i: number) => new Date(start + i * 2 * HOUR);
    const last = at(messages.length - 1);
    return prisma.$transaction(async (tx) => {
      const c = await tx.conversation.create({
        data: { subject, createdById: creator.id, involvesStudent: members.some((m) => m!.role === 'STUDENT'), lastMessageAt: last, createdAt: at(0) },
      });
      const ids: string[] = [];
      for (const [i, [who, body]] of messages.entries()) {
        ids.push((await tx.message.create({ data: { conversationId: c.id, senderId: members[who]!.id, body, createdAt: at(i) } })).id);
      }
      // Whoever sent the last message has read everything; everyone else has one unread.
      const lastSender = members[messages[messages.length - 1][0]]!.id;
      await tx.conversationParticipant.createMany({
        data: (members as U[]).map((m) => ({ conversationId: c.id, userId: m.id, lastReadAt: m.id === lastSender ? last : at(messages.length - 2) })),
      });
      return ids;
    });
  }

  let created = 0;
  if (await thread("Sam's homework", [pat, tom], [
    [0, "Hi Mr Teacher, Sam has been finding this week's fractions homework hard. Is there anything we can do at home?"],
    [1, 'Thanks for letting me know. Sam is doing well in class — practising equivalent fractions for 10 minutes a day would help.'],
    [0, 'That sounds manageable. Are there worksheets you would recommend?'],
    [1, "I've put two extra worksheets in the course materials under Week 3."],
    [0, "Great, we'll work through them this weekend."],
    [1, "Perfect. Let me know how it goes — I'll check in with Sam on Monday."],
  ])) created++;

  const math = await prisma.course.findFirst({
    where: { code: 'MATH-7A', archivedAt: null, academicYear: { isCurrent: true } },
    select: { teacherId: true, enrollments: { where: { status: 'ACTIVE', student: { status: 'ACTIVE' } }, select: { studentId: true }, orderBy: { studentId: 'asc' }, take: 4 } },
  });
  const mathTeacher = math ? await prisma.user.findUnique({ where: { id: math.teacherId }, select: { id: true, role: true } }) : null;
  const four = math?.enrollments.length === 4 ? math.enrollments.map((e) => ({ id: e.studentId, role: 'STUDENT' as const })) : null;
  if (!four) logger.warn('Seed: MATH-7A with 4 ACTIVE students not found, skipping group thread');
  else if (await thread('MATH-7A fractions practice', [mathTeacher, ...four], [
    [0, "Hi all — I've set up this group for questions about the fractions practice set due Friday."],
    [1, 'Do we need to simplify every answer?'],
    [0, 'Yes please, always give answers in their simplest form.'],
  ])) created++;

  if (await thread('Staff room', [tina, tom], [
    [0, 'Are you still okay to swap duty on Thursday?'],
    [1, 'Yes, Thursday works. I can take the lunch slot.'],
    [0, "Thanks! I'll cover your Friday morning in return."],
    [1, 'Deal — see you at the staff meeting.'],
  ])) created++;

  // Student↔teacher thread with one OPEN report (teacher reports the student's message).
  const reported = await thread('Quiz retake', [sam, tom], [
    [0, 'Can I retake the quiz? I was off sick.'],
    [1, "Yes — you can retake it on Wednesday at lunch."],
    [0, 'This is so unfair, everyone else got extra time and you never help me!!!'],
    [1, "I understand you're frustrated. Let's talk about it on Wednesday."],
  ]);
  if (reported && tom) {
    created++;
    await prisma.messageReport.create({
      data: { messageId: reported[2], reporterId: tom.id, reason: 'Student seems very upset — flagging for pastoral follow-up.' },
    });
  }
  logger.info('Seed: demo messaging ready', { threadsCreated: created });
}

/**
 * PRD-15 FR-45: Grade 7 absence notes (one PENDING, one APPROVED), "Autumn conferences"
 * 3 weeks out with Tom and Tina slots 15:00–17:00 at 10 min (two booked), and a
 * "Science Museum Trip" consent form due in 10 days linked to a seeded calendar event,
 * with ~40% of responses in. Idempotent (looked up by title / a "[seed]" marker).
 * Grade 7 students and their parents are owned by other seeds: parts that need them are
 * skipped, never created.
 */
async function seedParentPortal() {
  const { schoolToday, addDays } = await import('../src/server/attendance/attendance-rules');
  const { schoolMidnight } = await import('../src/lib/dates');
  const { generateSlots } = await import('../src/server/conferences/conference-slots');
  const { fromZonedTime } = await import('date-fns-tz');
  const settings = await prisma.schoolSettings.findUniqueOrThrow({ where: { id: 'singleton' } });
  const tz = settings.timezone;
  const today = schoolToday(new Date(), tz);
  const day = (d: string) => new Date(`${d}T00:00:00Z`);
  const [grade7, admin, tom, tina] = await Promise.all([
    prisma.gradeLevel.findUnique({ where: { name: 'Grade 7' } }),
    prisma.user.findUnique({ where: { email: 'admin@schoolhub.test' } }),
    prisma.user.findUnique({ where: { email: 'teacher@schoolhub.test' } }),
    prisma.user.findUnique({ where: { email: 'teacher2@schoolhub.test' } }),
  ]);
  if (!grade7 || !admin || !tom || !tina) {
    logger.info('Seed: parent portal skipped (Grade 7 or demo staff missing)');
    return;
  }

  // Grade 7 students with at least one linked parent, in a stable order.
  const families = await prisma.user.findMany({
    where: { role: 'STUDENT', archivedAt: null, studentProfile: { gradeLevelId: grade7.id }, studentLinks: { some: {} } },
    select: { id: true, studentLinks: { select: { parent: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { createdAt: 'asc' } } },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });

  // Absence notes.
  if (families.length && (await prisma.absenceNote.count({ where: { details: { startsWith: '[seed]' } } })) === 0) {
    const [first, second = first] = families;
    await prisma.absenceNote.create({
      data: {
        studentId: first.id,
        submittedById: first.studentLinks[0].parent.id,
        fromDate: day(addDays(today, 1)),
        toDate: day(addDays(today, 1)),
        reason: 'ILLNESS',
        details: '[seed] Fever overnight; keeping them home tomorrow.',
      },
    });
    await prisma.absenceNote.create({
      data: {
        studentId: second.id,
        submittedById: second.studentLinks[0].parent.id,
        fromDate: day(addDays(today, 5)),
        toDate: day(addDays(today, 6)),
        reason: 'MEDICAL_APPOINTMENT',
        details: '[seed] Orthodontist appointment out of town.',
        status: 'APPROVED',
        reviewedById: admin.id,
        reviewNote: 'Thanks for letting us know.',
        reviewedAt: new Date(),
      },
    });
  } else if (!families.length) {
    logger.info('Seed: absence notes and responses skipped (no Grade 7 students with parents)');
  }

  // Conferences.
  let event = await prisma.conferenceEvent.findFirst({ where: { title: 'Autumn conferences' } });
  if (!event) {
    const date = addDays(today, 21);
    event = await prisma.conferenceEvent.create({
      data: {
        title: 'Autumn conferences',
        date: day(date),
        bookingOpensAt: new Date(Date.now() - 86_400_000),
        bookingClosesAt: schoolMidnight(date, tz),
        slotMinutes: 10,
        gradeLevelIds: [grade7.id],
        createdById: admin.id,
      },
    });
  }
  const date = event.date.toISOString().slice(0, 10);
  const range = [{ start: fromZonedTime(`${date}T15:00:00`, tz), end: fromZonedTime(`${date}T17:00:00`, tz) }];
  for (const teacher of [tom, tina]) {
    await prisma.conferenceSlot.createMany({
      data: generateSlots(range, event.slotMinutes).map((g) => ({ eventId: event!.id, teacherId: teacher.id, startsAt: g.startsAt, endsAt: g.endsAt, location: 'Room 101' })),
      skipDuplicates: true,
    });
  }
  if (families.length && (await prisma.conferenceSlot.count({ where: { eventId: event.id, bookedByParentId: { not: null } } })) === 0) {
    const child = families[0];
    // Tom at 15:00 and Tina at 15:20 so the two bookings don't overlap (FR-31).
    for (const [teacher, offset] of [[tom, 0], [tina, 2]] as const) {
      const slot = await prisma.conferenceSlot.findFirst({ where: { eventId: event.id, teacherId: teacher.id }, orderBy: { startsAt: 'asc' }, skip: offset });
      if (slot) {
        await prisma.conferenceSlot.update({
          where: { id: slot.id },
          data: { bookedByParentId: child.studentLinks[0].parent.id, bookedForStudentId: child.id, bookedAt: new Date(), parentNote: '[seed] Would like to discuss progress this term.' },
        });
      }
    }
  }

  // Consent form + linked calendar event.
  let trip = await prisma.calendarEvent.findFirst({ where: { title: 'Science Museum Trip' } });
  if (!trip) {
    const tripDay = addDays(today, 12);
    trip = await prisma.calendarEvent.create({
      data: {
        title: 'Science Museum Trip',
        description: 'Grade 7 visit to the Springfield Science Museum.',
        category: 'TRIP',
        startAt: fromZonedTime(`${tripDay}T09:00:00`, tz),
        endAt: fromZonedTime(`${tripDay}T15:00:00`, tz),
        location: 'Springfield Science Museum',
        createdById: admin.id,
        audiences: { create: [{ type: 'GRADE_LEVEL', refId: grade7.id }] },
      },
    });
  }
  let form = await prisma.consentForm.findFirst({ where: { title: 'Science Museum Trip' } });
  if (!form) {
    form = await prisma.consentForm.create({
      data: {
        title: 'Science Museum Trip',
        description:
          'Grade 7 will visit the **Springfield Science Museum**.\n\n- Bus leaves at 09:00, back by 15:00\n- Bring a packed lunch\n- Cost is covered by the school',
        dueAt: fromZonedTime(`${addDays(today, 10)}T23:59:00`, tz),
        eventId: trip.id,
        createdById: tom.id,
        audiences: { create: [{ type: 'GRADE_LEVEL', refId: grade7.id }] },
      },
    });
  }
  const respondents = families.slice(0, Math.round(families.length * 0.4));
  for (const [i, f] of respondents.entries()) {
    const parent = f.studentLinks[0].parent;
    await prisma.consentResponse.upsert({
      where: { formId_studentId: { formId: form.id, studentId: f.id } },
      update: {},
      create: {
        formId: form.id,
        studentId: f.id,
        respondedById: parent.id,
        value: i % 4 === 3 ? 'DECLINED' : 'GRANTED',
        signature: `${parent.firstName} ${parent.lastName}`,
      },
    });
  }
  logger.info('Seed: parent portal ready', { families: families.length, responses: respondents.length });
}

/**
 * PRD-16 FR-46: a small cohort that crosses the FR-25 thresholds, so the at-risk list is populated
 * right after seeding: 3 HIGH (5 missing; one also < 50 %), 3 MEDIUM (3 missing, or one course
 * 50–59 %), 3 none. Section 7R's homeroom teacher is the demo teacher (FR-32 notification target).
 * Idempotent: users/section/course are upserted, demo assignments keep their rows but their
 * due dates are moved back into the 30-day window on every run. Ends with a forced recompute.
 */
async function seedRiskCohort() {
  const DAY = 86_400_000;
  const now = Date.now();
  const { currentTerm } = await import('../src/server/dashboards/insights');
  const { recomputeRiskSnapshots } = await import('../src/server/dashboards/risk');
  const [year, term, grade7, math, teacher] = await Promise.all([
    prisma.academicYear.findFirst({ where: { isCurrent: true } }),
    currentTerm(new Date(now)),
    prisma.gradeLevel.findUnique({ where: { name: 'Grade 7' } }),
    prisma.subject.findUnique({ where: { code: 'MATH' } }),
    prisma.user.findUnique({ where: { email: 'teacher@schoolhub.test' } }),
  ]);
  if (!year || !term || !grade7 || !math || !teacher) {
    console.log('Seed: no current term / Grade 7 / MATH / demo teacher, skipping the risk cohort');
    return;
  }

  const section = await prisma.section.upsert({
    where: { academicYearId_name: { academicYearId: year.id, name: '7R' } },
    update: { homeroomTeacherId: teacher.id },
    create: { academicYearId: year.id, gradeLevelId: grade7.id, name: '7R', homeroomTeacherId: teacher.id },
  });
  const course = await prisma.course.upsert({
    where: { academicYearId_code: { academicYearId: year.id, code: 'STUDY-7R' } },
    update: {},
    create: { academicYearId: year.id, subjectId: math.id, sectionId: section.id, teacherId: teacher.id, name: 'Study Skills 7R', code: 'STUDY-7R' },
  });

  // [key, first, last, missing count, unit-test score]
  const cohort: [string, string, string, number, number][] = [
    ['high1', 'Harper', 'Hale', 5, 45],
    ['high2', 'Hugo', 'Hart', 5, 72],
    ['high3', 'Hana', 'Holt', 5, 68],
    ['medium1', 'Mia', 'Marsh', 3, 75],
    ['medium2', 'Milo', 'Moss', 3, 81],
    ['medium3', 'Maya', 'Mills', 0, 55],
    ['none1', 'Noah', 'North', 0, 88],
    ['none2', 'Nina', 'Nash', 0, 92],
    ['none3', 'Nate', 'Noble', 1, 79],
  ];
  const students: { id: string; missing: number; score: number }[] = [];
  for (const [i, [key, firstName, lastName, missing, score]] of cohort.entries()) {
    const u = await prisma.user.upsert({
      where: { email: `risk.${key}@schoolhub.test` },
      update: {},
      create: {
        email: `risk.${key}@schoolhub.test`,
        firstName,
        lastName,
        role: 'STUDENT',
        status: 'ACTIVE',
        studentProfile: {
          create: {
            admissionNumber: `RISK-${String(i + 1).padStart(3, '0')}`,
            dateOfBirth: new Date('2014-03-01'),
            gender: i % 2 ? 'MALE' : 'FEMALE',
            gradeLevelId: grade7.id,
            enrollmentDate: new Date('2026-08-17'),
          },
        },
      },
    });
    await prisma.sectionMember.upsert({
      where: { studentId_academicYearId: { studentId: u.id, academicYearId: year.id } },
      update: {},
      create: { sectionId: section.id, studentId: u.id, academicYearId: year.id },
    });
    students.push({ id: u.id, missing, score });
  }
  await prisma.enrollment.createMany({ data: students.map((s) => ({ courseId: course.id, studentId: s.id })), skipDuplicates: true });

  // Five published assignments due 3–15 days ago; a student with `missing` = m skips the first m.
  for (let n = 0; n < 5; n++) {
    const title = `Reading log ${n + 1}`;
    const dueAt = new Date(now - (3 + 3 * n) * DAY);
    const existing = await prisma.assignment.findFirst({ where: { courseId: course.id, title }, select: { id: true } });
    const a = existing
      ? await prisma.assignment.update({ where: { id: existing.id }, data: { dueAt } })
      : await prisma.assignment.create({
          data: { courseId: course.id, title, submissionType: 'ONLINE_TEXT', maxPoints: '10', dueAt, status: 'PUBLISHED', createdById: teacher.id, notifiedAt: new Date() },
        });
    await prisma.submission.createMany({
      data: students
        .filter((s) => n >= s.missing)
        .map((s) => ({ assignmentId: a.id, studentId: s.id, attemptNumber: 1, text: 'Done.', submittedAt: new Date(dueAt.getTime() - DAY) })),
      skipDuplicates: true,
    });
  }

  // One visible manual grade item in the current term drives the GRADES signal.
  const item =
    (await prisma.gradeItem.findFirst({ where: { courseId: course.id, termId: term.id, title: 'Unit test' } })) ??
    (await prisma.gradeItem.create({ data: { courseId: course.id, termId: term.id, title: 'Unit test', maxPoints: '100', source: 'MANUAL' } }));
  for (const s of students) {
    await prisma.grade.upsert({
      where: { gradeItemId_studentId: { gradeItemId: item.id, studentId: s.id } },
      update: { score: String(s.score) },
      create: { gradeItemId: item.id, studentId: s.id, score: String(s.score), updatedById: teacher.id },
    });
  }

  const result = await recomputeRiskSnapshots({ force: true });
  const levels = await prisma.studentRiskSnapshot.groupBy({ by: ['level'], where: { termId: term.id, studentId: { in: students.map((s) => s.id) } }, _count: { _all: true } });
  logger.info('Seed: risk cohort ready', { ...result, levels: Object.fromEntries(levels.map((l) => [l.level ?? 'NONE', l._count._all])) });
}

async function disconnectAll() {
  await prisma.$disconnect();
  // The auth services use the app's shared client (src/server/db.ts).
  await (await import('../src/server/db')).prisma.$disconnect();
}

main()
  .then(disconnectAll)
  .catch(async (error) => {
    console.error(error);
    await disconnectAll();
    process.exit(1);
  });
