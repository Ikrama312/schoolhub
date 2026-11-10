import { PrismaClient, type Prisma } from '@prisma/client';

/**
 * PRD-16 FR-45 (`npm run seed:large`): a deterministic, school-sized dataset for NFR-1 timing.
 * 600 students in Grades 6–8 (8 sections × 75), 40 teachers (one course each: 8 sections × 5 core
 * subjects), a full Mon–Fri timetable, 60 school days of attendance, 6 assignments per course with
 * submissions, and 4 manual grade items per course in the current term. Then a forced risk recompute.
 *
 * Re-runnable: everything it owns is tagged (emails `large.*@schoolhub.test`, course codes `L-*`,
 * sections `L*`) and wiped first. Run `npm run db:seed` before this (it needs the current year,
 * grade levels and subjects). No new dependencies: inline mulberry32 PRNG with a fixed seed.
 */

try {
  process.loadEnvFile();
} catch {
  // No .env file: rely on the real environment.
}

const prisma = new PrismaClient();
const DAY = 86_400_000;
const BATCH = 1000;

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(16_600);

const FIRST = ['Ava', 'Ben', 'Cara', 'Dev', 'Ella', 'Finn', 'Gia', 'Hal', 'Isla', 'Jon', 'Kai', 'Lena', 'Max', 'Nora', 'Owen', 'Pia', 'Quinn', 'Rosa', 'Sol', 'Tara', 'Uma', 'Vic', 'Wren', 'Xan', 'Yara', 'Zed'];
const LAST = ['Adams', 'Brook', 'Chen', 'Diaz', 'Evans', 'Ford', 'Gray', 'Hayes', 'Ito', 'Jones', 'Khan', 'Lopez', 'Moore', 'Nolan', 'Ortiz', 'Park', 'Reed', 'Singh', 'Tran', 'Vance', 'Walsh', 'Young'];
const SECTIONS: [string, string][] = [
  ['Grade 6', 'L6A'],
  ['Grade 6', 'L6B'],
  ['Grade 7', 'L7A'],
  ['Grade 7', 'L7B'],
  ['Grade 7', 'L7C'],
  ['Grade 8', 'L8A'],
  ['Grade 8', 'L8B'],
  ['Grade 8', 'L8C'],
];
const SUBJECTS = ['MATH', 'ELA', 'SCI', 'SOC', 'PE'];
const PER_SECTION = 75;

async function inBatches<T>(rows: T[], write: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += BATCH) await write(rows.slice(i, i + BATCH));
}

const dbDate = (d: string) => new Date(`${d}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function wipe() {
  await prisma.course.deleteMany({ where: { code: { startsWith: 'L-' } } }); // cascades enrollments, slots, sessions, assignments, grade items
  await prisma.section.deleteMany({ where: { name: { in: SECTIONS.map(([, s]) => s) } } });
  const users = await prisma.user.findMany({ where: { email: { startsWith: 'large.', endsWith: '@schoolhub.test' } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.attendanceRecord.deleteMany({ where: { studentId: { in: ids } } });
  await prisma.sectionMember.deleteMany({ where: { studentId: { in: ids } } });
  await prisma.enrollment.deleteMany({ where: { studentId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

async function main() {
  const started = Date.now();
  const { currentTerm } = await import('../src/server/dashboards/insights');
  const [year, term, gradeLevels, subjects] = await Promise.all([
    prisma.academicYear.findFirst({ where: { isCurrent: true } }),
    currentTerm(),
    prisma.gradeLevel.findMany(),
    prisma.subject.findMany({ where: { code: { in: SUBJECTS } } }),
  ]);
  if (!year || !term || subjects.length !== SUBJECTS.length) throw new Error('Run `npm run db:seed` first (current year/term, grade levels, subjects).');
  await wipe();

  // Periods: reuse the school's bell schedule, or create five teaching periods once.
  let periods = await prisma.period.findMany({ where: { kind: 'CLASS' }, orderBy: { order: 'asc' } });
  if (periods.length < SUBJECTS.length) {
    const maxOrder = (await prisma.period.aggregate({ _max: { order: true } }))._max.order ?? 0;
    for (let i = periods.length; i < SUBJECTS.length; i++) {
      const h = 8 + i;
      await prisma.period.create({ data: { name: `Period ${i + 1}`, startTime: `${String(h).padStart(2, '0')}:00`, endTime: `${String(h).padStart(2, '0')}:50`, order: maxOrder + i + 1 } });
    }
    periods = await prisma.period.findMany({ where: { kind: 'CLASS' }, orderBy: { order: 'asc' } });
  }

  // Teachers (40) and students (600).
  const teachers = Array.from({ length: 40 }, (_, i) => ({
    id: `large-t-${i}`,
    email: `large.teacher${i + 1}@schoolhub.test`,
    firstName: FIRST[i % FIRST.length],
    lastName: `${LAST[(i * 7) % LAST.length]} T${i + 1}`,
    role: 'TEACHER' as const,
    status: 'ACTIVE' as const,
  }));
  const students = Array.from({ length: SECTIONS.length * PER_SECTION }, (_, i) => ({
    id: `large-s-${i}`,
    email: `large.student${i + 1}@schoolhub.test`,
    firstName: FIRST[Math.floor(rand() * FIRST.length)],
    lastName: `${LAST[Math.floor(rand() * LAST.length)]}`,
    role: 'STUDENT' as const,
    status: 'ACTIVE' as const,
  }));
  await inBatches([...teachers, ...students], (c) => prisma.user.createMany({ data: c }));
  const gradeId = new Map(gradeLevels.map((g) => [g.name, g.id]));
  await inBatches(
    students.map((s, i) => ({
      userId: s.id,
      admissionNumber: `L-${String(i + 1).padStart(4, '0')}`,
      dateOfBirth: new Date('2013-06-01'),
      gender: (['FEMALE', 'MALE', 'FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED'] as const)[Math.floor(rand() * 6)],
      gradeLevelId: gradeId.get(SECTIONS[Math.floor(i / PER_SECTION)][0])!,
      enrollmentDate: new Date(Date.UTC(2026, 7, 17 + (i % 60))),
    })),
    (c) => prisma.studentProfile.createMany({ data: c }),
  );

  // Sections (homeroom = teachers 0..7), members, courses (teacher i ↔ course i), enrollments, timetable.
  const sections = SECTIONS.map(([grade, name], i) => ({ id: `large-sec-${i}`, academicYearId: year.id, gradeLevelId: gradeId.get(grade)!, name, homeroomTeacherId: teachers[i].id, capacity: PER_SECTION }));
  await prisma.section.createMany({ data: sections });
  await inBatches(
    students.map((s, i) => ({ sectionId: sections[Math.floor(i / PER_SECTION)].id, studentId: s.id, academicYearId: year.id })),
    (c) => prisma.sectionMember.createMany({ data: c }),
  );
  const subjectId = new Map(subjects.map((s) => [s.code, s.id]));
  const courses = sections.flatMap((sec, si) =>
    SUBJECTS.map((code, ci) => ({
      id: `large-c-${si}-${ci}`,
      academicYearId: year.id,
      subjectId: subjectId.get(code)!,
      sectionId: sec.id,
      teacherId: teachers[si * SUBJECTS.length + ci].id,
      name: `${code} ${sec.name}`,
      code: `L-${code}-${sec.name}`,
      _section: si,
      _period: ci,
    })),
  );
  await prisma.course.createMany({ data: courses.map(({ _section: _s, _period: _p, ...c }) => c) });
  const rosterOf = (si: number) => students.slice(si * PER_SECTION, (si + 1) * PER_SECTION);
  await inBatches(
    courses.flatMap((c) => rosterOf(c._section).map((s) => ({ courseId: c.id, studentId: s.id, enrolledAt: new Date('2026-08-17') }))),
    (c) => prisma.enrollment.createMany({ data: c }),
  );
  await prisma.timetableSlot.createMany({
    data: courses.flatMap((c) => [1, 2, 3, 4, 5].map((dayOfWeek) => ({ academicYearId: year.id, courseId: c.id, dayOfWeek, periodId: periods[c._period].id }))),
  });

  // Per-student profile: attendance absence probability, diligence (submission rate), ability (grade mean).
  const profile = new Map(
    students.map((s) => {
      const r = rand();
      return [
        s.id,
        {
          absent: r < 0.04 ? 0.25 : r < 0.14 ? 0.12 : 0.03,
          diligence: rand() < 0.08 ? 0.55 : 0.96,
          ability: Math.min(98, Math.max(30, 78 + (rand() + rand() + rand() - 1.5) * 24)),
        },
      ];
    }),
  );

  // 60 school days (Mon–Fri) before today, inside the term.
  const days: string[] = [];
  for (let d = new Date(Date.now() - DAY); days.length < 60; d = new Date(d.getTime() - DAY)) {
    const wd = d.getUTCDay();
    if (wd === 0 || wd === 6) continue;
    if (iso(d) < iso(term.startDate)) break;
    days.unshift(iso(d));
  }
  const sessions: Prisma.AttendanceSessionCreateManyInput[] = [];
  const records: Prisma.AttendanceRecordCreateManyInput[] = [];
  for (const day of days) {
    for (const c of courses) {
      const id = `large-as-${c.id}-${day}`;
      sessions.push({ id, courseId: c.id, periodId: periods[c._period].id, date: dbDate(day), takenById: c.teacherId, updatedById: c.teacherId });
      for (const s of rosterOf(c._section)) {
        const r = rand();
        const p = profile.get(s.id)!;
        const status = r < p.absent ? 'ABSENT' : r < p.absent + 0.03 ? 'LATE' : 'PRESENT';
        records.push({ sessionId: id, studentId: s.id, status, minutesLate: status === 'LATE' ? 5 + Math.floor(rand() * 15) : null });
      }
    }
  }
  await inBatches(sessions, (c) => prisma.attendanceSession.createMany({ data: c }));
  await inBatches(records, (c) => prisma.attendanceRecord.createMany({ data: c }));

  // Assignments: 6 per course, due every 10 days back from yesterday; submissions by diligence.
  const assignments = courses.flatMap((c) =>
    Array.from({ length: 6 }, (_, n) => ({
      id: `large-a-${c.id}-${n}`,
      courseId: c.id,
      title: `Homework ${n + 1}`,
      submissionType: 'ONLINE_TEXT' as const,
      maxPoints: '10',
      dueAt: new Date(Date.now() - (1 + n * 10) * DAY),
      status: 'PUBLISHED' as const,
      createdById: c.teacherId,
      notifiedAt: new Date(),
      _section: c._section,
    })),
  );
  await inBatches(assignments.map(({ _section: _s, ...a }) => a), (c) => prisma.assignment.createMany({ data: c }));
  const submissions = assignments.flatMap((a) =>
    rosterOf(a._section)
      .filter((s) => rand() < profile.get(s.id)!.diligence)
      .map((s) => {
        const late = rand() < 0.1;
        return { assignmentId: a.id, studentId: s.id, attemptNumber: 1, text: 'Done.', submittedAt: new Date(a.dueAt.getTime() + (late ? 0.5 : -1) * DAY), isLate: late, lateDays: late ? 1 : 0 };
      }),
  );
  await inBatches(submissions, (c) => prisma.submission.createMany({ data: c }));

  // Grades: 4 visible manual items per course in the current term.
  const items = courses.flatMap((c) =>
    Array.from({ length: 4 }, (_, n) => ({ id: `large-gi-${c.id}-${n}`, courseId: c.id, termId: term.id, title: `Test ${n + 1}`, maxPoints: '100', source: 'MANUAL' as const, _section: c._section, _teacher: c.teacherId })),
  );
  await prisma.gradeItem.createMany({ data: items.map(({ _section: _s, _teacher: _t, ...i }) => i) });
  const grades = items.flatMap((i) =>
    rosterOf(i._section).map((s) => {
      const score = Math.round(Math.min(100, Math.max(0, profile.get(s.id)!.ability + (rand() - 0.5) * 20)));
      return { gradeItemId: i.id, studentId: s.id, score: String(score), updatedById: i._teacher };
    }),
  );
  await inBatches(grades, (c) => prisma.grade.createMany({ data: c }));

  console.log(
    `seed:large: ${students.length} students, ${teachers.length} teachers, ${courses.length} courses, ${sessions.length} sessions, ${records.length} attendance records, ${assignments.length} assignments, ${submissions.length} submissions, ${grades.length} grades in ${((Date.now() - started) / 1000).toFixed(1)} s`,
  );

  const { recomputeRiskSnapshots } = await import('../src/server/dashboards/risk');
  const t0 = Date.now();
  const result = await recomputeRiskSnapshots({ force: true });
  const levels = await prisma.studentRiskSnapshot.groupBy({ by: ['level'], where: { termId: term.id }, _count: { _all: true } });
  console.log(
    `seed:large: risk recompute ${JSON.stringify(result)} in ${Date.now() - t0} ms; levels ${JSON.stringify(Object.fromEntries(levels.map((l) => [l.level ?? 'NONE', l._count._all])))}`,
  );
}

async function disconnectAll() {
  await prisma.$disconnect();
  await (await import('../src/server/db')).prisma.$disconnect();
}

main()
  .then(disconnectAll)
  .catch(async (error) => {
    console.error(error);
    await disconnectAll();
    process.exit(1);
  });
