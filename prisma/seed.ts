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
