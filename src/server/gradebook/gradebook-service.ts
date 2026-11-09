import type { Grade, GradeItem, ScoringPolicy, Term } from '@prisma/client';
import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import { audit } from '@/server/audit';
import { toCsv } from '@/server/csv';
import { assertCanManageCourse } from '@/server/auth/course-access';
import type { AccessUser } from '@/server/auth/student-access';
import { notifyStudentAndParents } from '@/server/notifications/notify';
import { getSchoolTimezone } from '@/server/assignments/assignments-service';
import { schoolToday } from '@/server/attendance/attendance-rules';
import { dec, fixed2 } from '@/server/assignments/grading-math';
import { percentOf } from '@/server/quiz/grading';
import type { GradePut, ItemPatch, ManualItemInput, TermOverrideInput } from '@/lib/validators/gradebook';
import { toCategoryDto } from './categories-service';
import { courseTerms } from './gradebook-sync';
import { computeCourseResult, loadCourseTermData } from './load';
import { UNCATEGORISED, type StudentTermResult } from './grade-calc';

/**
 * PRD-11 teacher gradebook (FR-9, FR-18–FR-25, FR-38, NFR-2, NFR-4). Every function asserts
 * manage access on the item's course. Synced items are read-only here except comment/isVisible.
 */

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const day = (d: Date) => d.toISOString().slice(0, 10);
const invalid = (message: string, details?: unknown) => new AppError('VALIDATION_ERROR', message, details);
const SOURCE_EDIT = 'Edit this item at its source.';

export function toItemDto(i: GradeItem) {
  return {
    id: i.id,
    courseId: i.courseId,
    termId: i.termId,
    categoryId: i.categoryId,
    title: i.title,
    maxPoints: fixed2(i.maxPoints),
    dueAt: iso(i.dueAt),
    source: i.source,
    sourceId: i.sourceId,
    isVisible: i.isVisible,
  };
}
export type GradeItemDto = ReturnType<typeof toItemDto>;

function toCell(itemId: string, studentId: string, g: Grade | undefined) {
  return {
    gradeItemId: itemId,
    studentId,
    score: g?.score == null ? null : fixed2(g.score),
    excused: g?.excused ?? false,
    missing: g?.missing ?? false,
    comment: g?.comment ?? null,
    updatedAt: iso(g?.updatedAt ?? null),
  };
}

export function toTermRef(t: Term, today: string) {
  return { id: t.id, name: t.name, startDate: day(t.startDate), endDate: day(t.endDate), isCurrent: day(t.startDate) <= today && today <= day(t.endDate) };
}
export type TermRef = ReturnType<typeof toTermRef>;

/** Requested term (must belong to the course's year), else the current one, else the first. */
export async function resolveTerm(terms: Term[], termId: string | undefined) {
  const today = schoolToday(new Date(), await getSchoolTimezone());
  const refs = terms.map((t) => toTermRef(t, today));
  if (termId) {
    const t = refs.find((r) => r.id === termId);
    if (!t) throw invalid('That term is not part of this course’s academic year.', { fieldErrors: { termId: ['Unknown term'] } });
    return { term: t, terms: refs };
  }
  const t = refs.find((r) => r.isCurrent) ?? refs[0];
  if (!t) throw new AppError('NOT_FOUND', 'This course’s academic year has no terms yet.');
  return { term: t, terms: refs };
}

async function loadItem(user: AccessUser, itemId: string) {
  const item = await prisma.gradeItem.findUnique({ where: { id: itemId } });
  if (!item) throw new AppError('NOT_FOUND', 'Grade item not found');
  await assertCanManageCourse(user, item.courseId);
  return item;
}

async function assertEnrolled(courseId: string, studentId: string) {
  const e = await prisma.enrollment.findFirst({ where: { courseId, studentId, status: 'ACTIVE' }, select: { id: true } });
  if (!e) throw new AppError('NOT_FOUND', 'Student not found in this course');
}

async function assertCategory(courseId: string, categoryId: string | null | undefined) {
  if (!categoryId) return;
  const c = await prisma.gradeCategory.findUnique({ where: { id: categoryId }, select: { courseId: true } });
  if (c?.courseId !== courseId) throw invalid('That category does not belong to this course.', { fieldErrors: { categoryId: ['Unknown category'] } });
}

async function assertTerm(courseId: string, termId: string | undefined) {
  if (!termId) return;
  const terms = await courseTerms(prisma, courseId);
  if (!terms.some((t) => t.id === termId)) throw invalid('That term is not part of this course’s academic year.', { fieldErrors: { termId: ['Unknown term'] } });
}

async function studentResult(courseId: string, termId: string, studentId: string): Promise<StudentTermResult> {
  const data = await loadCourseTermData([courseId], termId, [studentId]);
  return computeCourseResult(data, courseId, studentId, new Date());
}

/** The attempt whose score the policy uses, for click-through (FR-21). AVERAGE → latest. */
function pickAttempt(policy: ScoringPolicy, attempts: { id: string; score: unknown; maxScore: unknown; submittedAt: Date | null }[]) {
  if (!attempts.length) return null;
  if (policy === 'HIGHEST') {
    return attempts.reduce((a, b) => ((percentOf(String(b.score ?? 0), String(b.maxScore)) ?? 0) > (percentOf(String(a.score ?? 0), String(a.maxScore)) ?? 0) ? b : a)).id;
  }
  return attempts.reduce((a, b) => ((b.submittedAt?.getTime() ?? 0) > (a.submittedAt?.getTime() ?? 0) ? b : a)).id;
}

// ---------------------------------------------------------------------------
// Read (FR-18, FR-19, FR-21, NFR-2)
// ---------------------------------------------------------------------------

export async function getGradebook(user: AccessUser, courseId: string, termId?: string) {
  await assertCanManageCourse(user, courseId);
  const course = await prisma.course.findUniqueOrThrow({ where: { id: courseId }, select: { id: true, code: true, name: true } });
  const { term, terms } = await resolveTerm(await courseTerms(prisma, courseId), termId);

  const enrollments = await prisma.enrollment.findMany({
    where: { courseId, status: 'ACTIVE' },
    select: { student: { select: { id: true, firstName: true, lastName: true, studentProfile: { select: { admissionNumber: true } } } } },
    orderBy: [{ student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }],
  });
  const students = enrollments.map((e) => e.student);
  const data = await loadCourseTermData([courseId], term.id, students.map((s) => s.id));
  const categories = data.categories.get(courseId) ?? [];
  const order = new Map(categories.map((c) => [c.id, c.order]));
  const items = [...(data.items.get(courseId) ?? [])].sort(
    (a, b) =>
      (order.get(a.categoryId ?? '') ?? Infinity) - (order.get(b.categoryId ?? '') ?? Infinity) ||
      (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity) ||
      a.title.localeCompare(b.title),
  );

  const assignmentIds = items.filter((i) => i.source === 'ASSIGNMENT' && i.sourceId).map((i) => i.sourceId!);
  const quizIds = items.filter((i) => i.source === 'QUIZ' && i.sourceId).map((i) => i.sourceId!);
  const [subs, attempts, quizzes] = await Promise.all([
    assignmentIds.length ? prisma.submission.findMany({ where: { assignmentId: { in: assignmentIds } }, select: { id: true, assignmentId: true, studentId: true, isLate: true } }) : [],
    quizIds.length
      ? prisma.quizAttempt.findMany({ where: { quizId: { in: quizIds }, status: 'GRADED' }, select: { id: true, quizId: true, studentId: true, score: true, maxScore: true, submittedAt: true } })
      : [],
    quizIds.length ? prisma.quiz.findMany({ where: { id: { in: quizIds } }, select: { id: true, scoringPolicy: true } }) : [],
  ]);
  const subBy = new Map(subs.map((s) => [`${s.assignmentId}:${s.studentId}`, s]));
  const policy = new Map(quizzes.map((q) => [q.id, q.scoringPolicy]));
  const attemptsBy = new Map<string, typeof attempts>();
  for (const a of attempts) attemptsBy.set(`${a.quizId}:${a.studentId}`, [...(attemptsBy.get(`${a.quizId}:${a.studentId}`) ?? []), a]);

  const now = new Date();
  const rows = students.map((s) => {
    const cells: Record<string, ReturnType<typeof toCell> & { isLate: boolean; submissionId: string | null; attemptId: string | null }> = {};
    for (const i of items) {
      const sub = i.source === 'ASSIGNMENT' ? subBy.get(`${i.sourceId}:${s.id}`) : undefined;
      const atts = i.source === 'QUIZ' ? attemptsBy.get(`${i.sourceId}:${s.id}`) ?? [] : [];
      cells[i.id] = {
        ...toCell(i.id, s.id, data.grades.get(i.id)?.get(s.id)),
        isLate: sub?.isLate ?? false,
        submissionId: sub?.id ?? null,
        attemptId: i.source === 'QUIZ' ? pickAttempt(policy.get(i.sourceId!) ?? 'HIGHEST', atts) : null,
      };
    }
    return {
      student: { id: s.id, firstName: s.firstName, lastName: s.lastName, admissionNumber: s.studentProfile?.admissionNumber ?? null },
      cells,
      result: computeCourseResult(data, courseId, s.id, now),
    };
  });

  const scale = data.scales.get(courseId);
  return {
    course,
    term,
    terms,
    scale: scale ? { id: scale.id, name: scale.name, bands: scale.bands } : null,
    categories: categories.map(toCategoryDto),
    items: items.map(toItemDto),
    rows,
  };
}
export type GradebookPayload = Awaited<ReturnType<typeof getGradebook>>;

/** FR-25: the grid as displayed — same rows, columns, hidden items included. */
export async function exportGradebookCsv(user: AccessUser, courseId: string, termId?: string) {
  const gb = await getGradebook(user, courseId, termId);
  const catNames = [...gb.categories.map((c) => ({ id: c.id as string | null, name: c.name }))];
  if (gb.rows[0]?.result.categories.some((c) => c.id === null)) catNames.push({ id: null, name: UNCATEGORISED });
  const columns = [
    { key: 'lastName', header: 'Last name' },
    { key: 'firstName', header: 'First name' },
    ...gb.items.map((i) => ({ key: `i:${i.id}`, header: `${i.title} (/${dec(i.maxPoints).toString()})` })),
    ...catNames.map((c) => ({ key: `c:${c.id ?? ''}`, header: `${c.name} %` })),
    { key: 'percent', header: 'Term %' },
    { key: 'letter', header: 'Letter' },
  ];
  const rows = gb.rows.map((r) => {
    const out: Record<string, string | null> = { lastName: r.student.lastName, firstName: r.student.firstName, percent: r.result.percent, letter: r.result.letter };
    for (const i of gb.items) {
      const c = r.cells[i.id];
      out[`i:${i.id}`] = c.excused ? 'EX' : c.score ?? (c.missing ? 'M' : null);
    }
    for (const c of r.result.categories) out[`c:${c.id ?? ''}`] = c.percent;
    return out;
  });
  return { csv: toCsv(columns, rows), filename: `${gb.course.code}-${gb.term.name}-gradebook.csv`.replace(/[^\w.-]+/g, '_') };
}

// ---------------------------------------------------------------------------
// Items (FR-22, FR-24, FR-9)
// ---------------------------------------------------------------------------

export async function createManualItem(user: AccessUser, courseId: string, input: ManualItemInput, request?: Request) {
  await assertCanManageCourse(user, courseId);
  await Promise.all([assertCategory(courseId, input.categoryId), assertTerm(courseId, input.termId)]);
  const item = await prisma.gradeItem.create({
    data: { courseId, termId: input.termId, categoryId: input.categoryId ?? null, title: input.title, maxPoints: input.maxPoints, dueAt: input.dueAt ?? null, source: 'MANUAL' },
  });
  await audit({ actorId: user.id, action: 'gradeItem.create', entityType: 'GradeItem', entityId: item.id, metadata: { courseId, title: item.title }, request });
  return toItemDto(item);
}

export async function updateItem(user: AccessUser, itemId: string, patch: ItemPatch, request?: Request) {
  const item = await loadItem(user, itemId);
  const keys = Object.keys(patch).filter((k) => patch[k as keyof ItemPatch] !== undefined);
  if (item.source !== 'MANUAL' && keys.some((k) => k !== 'isVisible')) throw invalid(SOURCE_EDIT);
  await Promise.all([assertCategory(item.courseId, patch.categoryId), assertTerm(item.courseId, patch.termId)]);
  if (patch.maxPoints !== undefined) {
    const top = await prisma.grade.aggregate({ where: { gradeItemId: itemId }, _max: { score: true } });
    if (top._max.score && dec(top._max.score).gt(dec(patch.maxPoints))) {
      throw invalid(`A student already has ${fixed2(top._max.score)} points.`, { fieldErrors: { maxPoints: ['Lower than an existing score'] } });
    }
  }
  const updated = await prisma.gradeItem.update({
    where: { id: itemId },
    data: {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.categoryId !== undefined ? { categoryId: patch.categoryId } : {}),
      ...(patch.maxPoints !== undefined ? { maxPoints: patch.maxPoints } : {}),
      ...(patch.dueAt !== undefined ? { dueAt: patch.dueAt } : {}),
      ...(patch.termId !== undefined ? { termId: patch.termId } : {}),
      ...(patch.isVisible !== undefined ? { isVisible: patch.isVisible } : {}),
    },
  });
  await audit({ actorId: user.id, action: 'gradeItem.update', entityType: 'GradeItem', entityId: itemId, metadata: { old: toItemDto(item), new: toItemDto(updated) }, request });
  return toItemDto(updated);
}

export async function deleteItem(user: AccessUser, itemId: string, request?: Request) {
  const item = await loadItem(user, itemId);
  if (item.source !== 'MANUAL') throw invalid('Synced items are removed by deleting their source.');
  const grades = await prisma.grade.findMany({ where: { gradeItemId: itemId } });
  await prisma.gradeItem.delete({ where: { id: itemId } });
  await audit({
    actorId: user.id,
    action: 'gradeItem.delete',
    entityType: 'GradeItem',
    entityId: itemId,
    metadata: { old: { item: toItemDto(item), grades: grades.map((g) => toCell(itemId, g.studentId, g)) } },
    request,
  });
  return { id: itemId };
}

/** FR-24: every enrolled student with no score, not excused and not missing → missing. */
export async function markAllMissing(user: AccessUser, itemId: string, request?: Request, now = new Date()) {
  const item = await loadItem(user, itemId);
  if (!item.dueAt || now.getTime() <= item.dueAt.getTime()) throw invalid('Items can be marked missing only after their due date.');
  const [enrolled, grades] = await Promise.all([
    prisma.enrollment.findMany({ where: { courseId: item.courseId, status: 'ACTIVE' }, select: { studentId: true } }),
    prisma.grade.findMany({ where: { gradeItemId: itemId }, select: { studentId: true, score: true, excused: true, missing: true } }),
  ]);
  const byStudent = new Map(grades.map((g) => [g.studentId, g]));
  const noRow = enrolled.map((e) => e.studentId).filter((id) => !byStudent.has(id));
  const blank = grades.filter((g) => g.score === null && !g.excused && !g.missing && enrolled.some((e) => e.studentId === g.studentId)).map((g) => g.studentId);
  const studentIds = [...noRow, ...blank];
  if (studentIds.length) {
    await prisma.$transaction([
      prisma.grade.createMany({ data: noRow.map((studentId) => ({ gradeItemId: itemId, studentId, missing: true, updatedById: user.id })), skipDuplicates: true }),
      prisma.grade.updateMany({ where: { gradeItemId: itemId, studentId: { in: blank }, score: null }, data: { missing: true, updatedById: user.id } }),
    ]);
  }
  await audit({ actorId: user.id, action: 'grade.markMissing', entityType: 'GradeItem', entityId: itemId, metadata: { itemId, studentIds }, request });
  return { updatedCount: studentIds.length, studentIds };
}

// ---------------------------------------------------------------------------
// Grades and overrides (FR-20, FR-23, FR-38, NFR-4)
// ---------------------------------------------------------------------------

export async function putGrade(user: AccessUser, itemId: string, studentId: string, input: GradePut, request?: Request) {
  const item = await loadItem(user, itemId);
  await assertEnrolled(item.courseId, studentId);
  const keys = Object.keys(input).filter((k) => input[k as keyof GradePut] !== undefined);
  if (item.source !== 'MANUAL' && keys.some((k) => k !== 'comment')) throw invalid(`Only the comment can be changed here. ${SOURCE_EDIT}`);
  if (input.score != null && dec(input.score).gt(dec(item.maxPoints))) {
    throw invalid(`Score must be between 0 and ${dec(item.maxPoints).toString()}.`, { fieldErrors: { score: ['Above max points'] } });
  }
  const data = {
    ...(input.score !== undefined ? { score: input.score } : {}),
    ...(input.excused !== undefined ? { excused: input.excused } : {}),
    ...(input.missing !== undefined ? { missing: input.missing } : {}),
    ...(input.comment !== undefined ? { comment: input.comment || null } : {}),
    updatedById: user.id,
  };
  const key = { gradeItemId_studentId: { gradeItemId: itemId, studentId } };
  const { old, saved } = await prisma.$transaction(async (tx) => {
    const old = await tx.grade.findUnique({ where: key });
    const saved = await tx.grade.upsert({ where: key, create: { gradeItemId: itemId, studentId, ...data }, update: data });
    return { old, saved };
  });
  const oldCell = old ? toCell(itemId, studentId, old) : null;
  const newCell = toCell(itemId, studentId, saved);
  await audit({ actorId: user.id, action: 'grade.update', entityType: 'GradeItem', entityId: itemId, metadata: { studentId, old: oldCell, new: newCell }, request });
  // A9: one notification per student per item — the first time a manual score appears.
  if (item.source === 'MANUAL' && oldCell?.score == null && newCell.score !== null) {
    await notifyStudentAndParents({
      type: 'grade.posted',
      studentIds: [studentId],
      title: `Grade posted: ${item.title}`,
      body: `${newCell.score.replace(/\.00$/, '')}/${dec(item.maxPoints).toString()}`,
      link: `/students/${studentId}/grades`,
    });
  }
  return { grade: newCell, result: await studentResult(item.courseId, item.termId, studentId) };
}

export async function putTermOverride(user: AccessUser, courseId: string, studentId: string, input: TermOverrideInput, request?: Request) {
  await assertCanManageCourse(user, courseId);
  await Promise.all([assertTerm(courseId, input.termId), assertEnrolled(courseId, studentId)]);
  if (input.letter) {
    const data = await loadCourseTermData([courseId], input.termId, [studentId]);
    const bands = data.scales.get(courseId)?.bands ?? [];
    if (!bands.some((b) => b.letter === input.letter)) {
      throw invalid('That letter is not in the course’s grading scale.', { fieldErrors: { letter: ['Unknown letter'] } });
    }
  }
  const data = {
    ...(input.percent !== undefined ? { percent: input.percent } : {}),
    ...(input.letter !== undefined ? { letter: input.letter || null } : {}),
    ...(input.teacherComment !== undefined ? { teacherComment: input.teacherComment || null } : {}),
    updatedById: user.id,
  };
  const key = { courseId_termId_studentId: { courseId, termId: input.termId, studentId } };
  const dto = (o: { percent: unknown; letter: string | null; teacherComment: string | null } | null) =>
    o ? { percent: o.percent == null ? null : fixed2(String(o.percent)), letter: o.letter, teacherComment: o.teacherComment } : null;
  const { old, saved } = await prisma.$transaction(async (tx) => {
    const old = await tx.termGradeOverride.findUnique({ where: key });
    const saved = await tx.termGradeOverride.upsert({ where: key, create: { courseId, termId: input.termId, studentId, ...data }, update: data });
    return { old, saved };
  });
  await audit({
    actorId: user.id,
    action: 'termOverride.upsert',
    entityType: 'Course',
    entityId: courseId,
    metadata: { studentId, termId: input.termId, old: dto(old), new: dto(saved) },
    request,
  });
  return { override: dto(saved)!, result: await studentResult(courseId, input.termId, studentId) };
}
