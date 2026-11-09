import { Prisma, type AssignmentStatus, type FileObject, type SubmissionType } from '@prisma/client';
import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import { audit } from '@/server/audit';
import { assertCanManageCourse, assertCanViewCourse } from '@/server/auth/course-access';
import { assertCanViewStudent, type AccessUser } from '@/server/auth/student-access';
import { canSeeDrafts, isVisible } from '@/server/content/visibility';
import { notify, notifyStudentAndParents } from '@/server/notifications/notify';
import { attachFiles, detachFiles } from '@/server/files/files-service';
import { extOf } from '@/server/files/validate';
import { readFile, saveFile } from '@/server/storage';
import { formatInSchoolTz } from '@/lib/dates';
import { logger } from '@/lib/logger';
import {
  assignmentInput,
  type AssignmentInput,
  type AssignmentPatch,
  type GradeInput,
  type OfflineGradeInput,
  type RubricCriterionValues,
} from '@/lib/validators/assignments';
import {
  computeFinalScore,
  dec,
  fixed2,
  lateDays as computeLateDays,
  maxRawScore,
  submissionChipStatus,
  type ChipStatus,
} from './grading-math';

/**
 * PRD-09 assignments service (system-design §2.2, NFR-8). All assignment/submission DB logic
 * lives here; route handlers and server pages stay thin. "now" is always the server clock (NFR-2).
 *
 * Privacy (NFR-4): student/parent paths scope by resolveViewedStudent and every submission they
 * receive goes through toStudentSubmission.
 */

type Tx = Prisma.TransactionClient;
type Group = 'UPCOMING' | 'MISSING' | 'SUBMITTED' | 'RETURNED' | 'CLOSED';

const fullName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`;
const userRef = (u: { id: string; firstName: string; lastName: string } | null) => (u ? { id: u.id, name: fullName(u) } : null);
const fileRef = (f: Pick<FileObject, 'id' | 'originalName' | 'mimeType' | 'sizeBytes'>) => ({
  id: f.id,
  filename: f.originalName,
  mimeType: f.mimeType,
  size: f.sizeBytes,
});
const iso = (d: Date | null) => (d ? d.toISOString() : null);
/** Prisma.Decimal → "14.40" on the way out (NFR-1, D5). */
export const serializeDecimal = (d: Prisma.Decimal | null) => (d === null ? null : fixed2(d));
/** "18.00" → "18", "14.40" stays — for human copy like "18/20". */
const pts = (d: Prisma.Decimal | string) => fixed2(d).replace(/\.00$/, '');

export async function getSchoolTimezone(): Promise<string> {
  return (await prisma.schoolSettings.findUnique({ where: { id: 'singleton' }, select: { timezone: true } }))?.timezone ?? 'UTC';
}

const notFound = () => new AppError('NOT_FOUND', 'Assignment not found');

// ---------------------------------------------------------------------------
// Visibility (FR-13, FR-52, FR-60)
// ---------------------------------------------------------------------------

type VisibilityFields = { status: AssignmentStatus; availableFrom: Date | null; archivedAt: Date | null };

export function isAssignmentVisible(a: VisibilityFields, now: Date): boolean {
  return !a.archivedAt && isVisible({ status: a.status, publishAt: a.availableFrom }, now);
}

export function visibleWhere(now: Date): Prisma.AssignmentWhereInput {
  return { archivedAt: null, OR: [{ status: 'PUBLISHED' }, { status: 'SCHEDULED', availableFrom: { lte: now } }] };
}

/** Visible, past due, not NO_SUBMISSION, and this student has no submission and no exemption. */
export function missingWhere(now: Date, studentId: string): Prisma.AssignmentWhereInput {
  return {
    AND: [
      visibleWhere(now),
      {
        dueAt: { lt: now },
        submissionType: { not: 'NO_SUBMISSION' },
        submissions: { none: { studentId } },
        exemptions: { none: { studentId } },
      },
    ],
  };
}

/** Server-computed list group; first match wins (api-contracts StudentAssignmentRow). */
function groupOf(
  a: { dueAt: Date; submissionType: SubmissionType },
  sub: { status: string } | null,
  exempt: boolean,
  now: Date,
): Group {
  if (sub?.status === 'RETURNED') return 'RETURNED';
  if (sub) return 'SUBMITTED';
  if (a.dueAt > now) return 'UPCOMING';
  if (!exempt && a.submissionType !== 'NO_SUBMISSION') return 'MISSING';
  return 'CLOSED';
}

// ---------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------

const assignmentInclude = {
  course: { select: { id: true, name: true, teacherId: true, coTeacherIds: true } },
  rubric: { include: { criteria: { orderBy: { order: 'asc' } } } },
  attachments: { include: { file: true } },
} satisfies Prisma.AssignmentInclude;
type FullAssignment = Prisma.AssignmentGetPayload<{ include: typeof assignmentInclude }>;
type AssignmentRow = Prisma.AssignmentGetPayload<{ include: { course: { select: { name: true } } } }> | FullAssignment;

type Level = { label: string; points: string; description?: string };

function toSummary(a: AssignmentRow) {
  return {
    id: a.id,
    courseId: a.courseId,
    courseName: a.course.name,
    title: a.title,
    submissionType: a.submissionType,
    maxPoints: fixed2(a.maxPoints),
    dueAt: a.dueAt.toISOString(),
    availableFrom: iso(a.availableFrom),
    status: a.status,
    archivedAt: iso(a.archivedAt),
    hasRubric: a.rubricId !== null,
  };
}
export type AssignmentSummary = ReturnType<typeof toSummary>;

function toAssignment(a: FullAssignment) {
  return {
    ...toSummary(a),
    instructions: a.instructions,
    allowLate: a.allowLate,
    lateCutoffAt: iso(a.lateCutoffAt),
    latePenaltyPercentPerDay: fixed2(a.latePenaltyPercentPerDay),
    maxLatePenaltyPercent: fixed2(a.maxLatePenaltyPercent),
    maxFileCount: a.maxFileCount,
    allowExtraCredit: a.allowExtraCredit,
    rubric: a.rubric
      ? a.rubric.criteria.map((c) => ({
          id: c.id,
          order: c.order,
          title: c.title,
          description: c.description ?? '',
          maxPoints: fixed2(c.maxPoints),
          levels: (c.levels as Level[]).map((l) => ({ label: l.label, points: fixed2(l.points), description: l.description ?? '' })),
        }))
      : null,
    attachments: a.attachments.map((x) => fileRef(x.file)),
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}
export type AssignmentDto = ReturnType<typeof toAssignment>;

const submissionInclude = {
  student: { select: { id: true, firstName: true, lastName: true } },
  gradedBy: { select: { id: true, firstName: true, lastName: true } },
  files: { include: { file: true } },
} satisfies Prisma.SubmissionInclude;
type FullSubmission = Prisma.SubmissionGetPayload<{ include: typeof submissionInclude }>;
type RubricScore = { criterionId: string; points: string; comment?: string };

function toSubmission(s: FullSubmission) {
  return {
    id: s.id,
    assignmentId: s.assignmentId,
    student: userRef(s.student)!,
    status: s.status,
    attemptNumber: s.attemptNumber,
    text: s.text,
    files: s.files.map((f) => fileRef(f.file)),
    submittedAt: s.submittedAt.toISOString(),
    isLate: s.isLate,
    lateDays: s.lateDays,
    rawScore: serializeDecimal(s.rawScore),
    penaltyPercent: serializeDecimal(s.penaltyPercent),
    finalScore: serializeDecimal(s.finalScore),
    rubricScores: (s.rubricScores as RubricScore[] | null) ?? null,
    feedback: s.feedback,
    gradedBy: userRef(s.gradedBy),
    gradedAt: iso(s.gradedAt),
    returnedAt: iso(s.returnedAt),
    history: undefined as SubmissionAttempt[] | undefined,
  };
}
export type SubmissionDto = ReturnType<typeof toSubmission>;
export type SubmissionAttempt = { attemptNumber: number; text: string | null; files: ReturnType<typeof fileRef>[]; submittedAt: string };

/** FR-27, NFR-4: grade fields are null until RETURNED; history is never sent to students/parents. */
export function toStudentSubmission(s: SubmissionDto): SubmissionDto {
  const { history: _history, ...rest } = s;
  if (s.status === 'RETURNED') return rest as SubmissionDto;
  return {
    ...rest,
    rawScore: null,
    penaltyPercent: null,
    finalScore: null,
    feedback: null,
    rubricScores: null,
    gradedBy: null,
    gradedAt: null,
  } as SubmissionDto;
}

type SummarySub = { id: string; status: 'SUBMITTED' | 'RETURNED'; attemptNumber: number; submittedAt: Date; isLate: boolean; finalScore: Prisma.Decimal | null; returnedAt: Date | null };

function toStudentRow(a: AssignmentRow, sub: SummarySub | null, exempt: boolean, now: Date, fullGrades = false) {
  return {
    assignment: toSummary(a),
    group: groupOf(a, sub, exempt, now),
    exempt,
    submission: sub
      ? {
          id: sub.id,
          status: sub.status,
          attemptNumber: sub.attemptNumber,
          submittedAt: sub.submittedAt.toISOString(),
          isLate: sub.isLate,
          finalScore: fullGrades || sub.status === 'RETURNED' ? serializeDecimal(sub.finalScore) : null,
          returnedAt: iso(sub.returnedAt),
        }
      : null,
  };
}
export type StudentAssignmentRow = ReturnType<typeof toStudentRow>;

const summarySubSelect = {
  id: true,
  status: true,
  attemptNumber: true,
  submittedAt: true,
  isLate: true,
  finalScore: true,
  returnedAt: true,
} satisfies Prisma.SubmissionSelect;

// ---------------------------------------------------------------------------
// Viewer resolution (FR-18, FR-38, FR-57)
// ---------------------------------------------------------------------------

/**
 * STUDENT → self. PARENT → studentId must be a linked child; without one, the first linked child
 * (preferring one ACTIVE in courseId when given). Anyone else → FORBIDDEN.
 */
export async function resolveViewedStudent(user: AccessUser, studentId?: string, courseId?: string) {
  if (user.role === 'STUDENT') {
    if (studentId && studentId !== user.id) throw new AppError('FORBIDDEN', 'You can only view your own assignments.');
    return { studentId: user.id, children: [] as { id: string; name: string }[] };
  }
  if (user.role === 'PARENT') {
    const links = await prisma.parentStudentLink.findMany({
      where: { parentId: user.id },
      select: {
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            enrollments: courseId ? { where: { courseId, status: 'ACTIVE' }, select: { id: true } } : undefined,
          },
        },
      },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
    const students = links.map((l) => l.student);
    const children = students.map((s) => userRef(s)!);
    if (studentId) {
      if (!children.some((c) => c.id === studentId)) throw new AppError('FORBIDDEN', 'That student is not linked to your account.');
      return { studentId, children };
    }
    const pick = (courseId ? students.find((s) => s.enrollments?.length) : undefined) ?? students[0];
    if (!pick) throw new AppError('FORBIDDEN', 'No linked students.');
    return { studentId: pick.id, children };
  }
  throw new AppError('FORBIDDEN', 'You do not have permission to view this.');
}

// ---------------------------------------------------------------------------
// publishOnce (FR-42)
// ---------------------------------------------------------------------------

/** Sends assignment.published exactly once, guarded by an atomic notifiedAt claim. */
export async function publishOnce(id: string, now = new Date()): Promise<void> {
  const a = await prisma.assignment.findUnique({
    where: { id },
    select: { id: true, title: true, courseId: true, status: true, availableFrom: true, archivedAt: true, notifiedAt: true, dueAt: true, course: { select: { name: true } } },
  });
  if (!a || a.notifiedAt || !isAssignmentVisible(a, now)) return;
  const { count } = await prisma.assignment.updateMany({ where: { id, notifiedAt: null }, data: { notifiedAt: now } });
  if (count !== 1) return;
  const [students, tz] = await Promise.all([
    prisma.enrollment.findMany({ where: { courseId: a.courseId, status: 'ACTIVE' }, select: { studentId: true } }),
    getSchoolTimezone(),
  ]);
  await notify({
    type: 'assignment.published',
    userIds: students.map((s) => s.studentId),
    title: `New assignment: ${a.title}`,
    body: `${a.course.name} — due ${formatInSchoolTz(a.dueAt, 'EEE d MMM yyyy, HH:mm', tz)}`,
    link: `/courses/${a.courseId}/assignments/${a.id}`,
  });
}

/** Read-path trigger for SCHEDULED rows that became visible (fire-and-forget, never fails the read). */
function publishNewlyVisible(rows: (VisibilityFields & { id: string; notifiedAt: Date | null })[], now: Date) {
  for (const a of rows) {
    if (a.status === 'SCHEDULED' && !a.notifiedAt && isAssignmentVisible(a, now)) {
      void publishOnce(a.id, now).catch((error) =>
        logger.error('publishOnce failed', { assignmentId: a.id, message: error instanceof Error ? error.message : String(error) }),
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Authoring: create / update / delete / duplicate (FR-11..FR-15, FR-49, FR-51)
// ---------------------------------------------------------------------------

async function loadFull(id: string, db: Tx = prisma): Promise<FullAssignment> {
  const a = await db.assignment.findUnique({ where: { id }, include: assignmentInclude });
  if (!a) throw notFound();
  return a;
}

function scalarFields(input: AssignmentInput) {
  return {
    title: input.title,
    instructions: input.instructions,
    submissionType: input.submissionType,
    maxPoints: input.maxPoints,
    dueAt: input.dueAt,
    availableFrom: input.availableFrom ?? null,
    allowLate: input.allowLate,
    lateCutoffAt: input.allowLate ? input.lateCutoffAt ?? null : null,
    latePenaltyPercentPerDay: input.latePenaltyPercentPerDay,
    maxLatePenaltyPercent: input.maxLatePenaltyPercent,
    maxFileCount: input.maxFileCount,
    allowExtraCredit: input.allowExtraCredit,
    status: input.status,
  };
}

/** FR-12: SCHEDULED needs availableFrom in the future, by the server clock (NFR-2). */
function assertSchedule(input: Pick<AssignmentInput, 'status' | 'availableFrom'>, now: Date) {
  if (input.status === 'SCHEDULED' && (!input.availableFrom || input.availableFrom <= now)) {
    throw new AppError('VALIDATION_ERROR', 'The scheduled time must be in the future.', {
      fieldErrors: { availableFrom: ['The scheduled time must be in the future.'] },
    });
  }
}

/** Upsert criteria by id (keeps rubricScores' criterionIds valid), delete the rest. Returns the rubric id. */
async function writeRubric(tx: Tx, rubricId: string | null, criteria: RubricCriterionValues[]): Promise<string> {
  const id = rubricId ?? (await tx.rubric.create({ data: {} })).id;
  const existing = rubricId ? await tx.rubricCriterion.findMany({ where: { rubricId }, select: { id: true } }) : [];
  const keep = new Set(criteria.map((c) => c.id).filter((cid): cid is string => !!cid && existing.some((e) => e.id === cid)));
  await tx.rubricCriterion.deleteMany({ where: { rubricId: id, id: { notIn: [...keep] } } });
  for (const [order, c] of criteria.entries()) {
    const data = {
      title: c.title,
      description: c.description || null,
      maxPoints: c.maxPoints,
      order,
      levels: c.levels as unknown as Prisma.InputJsonValue,
    };
    if (c.id && keep.has(c.id)) await tx.rubricCriterion.update({ where: { id: c.id }, data });
    else await tx.rubricCriterion.create({ data: { ...data, rubricId: id } });
  }
  return id;
}

async function assertFileContext(tx: Tx, fileIds: string[], context: string) {
  if (fileIds.length === 0) return;
  const wrong = await tx.fileObject.findMany({ where: { id: { in: fileIds }, context: { not: context } }, select: { id: true } });
  if (wrong.length) {
    throw new AppError('VALIDATION_ERROR', 'One or more files cannot be attached.', { fileIds: wrong.map((f) => f.id) });
  }
}

/** Diff attachments: removed → detached (purge reclaims them), added → context-checked and attached. */
async function setAttachments(tx: Tx, user: AccessUser, assignmentId: string, current: string[], next: string[]) {
  const wanted = [...new Set(next)];
  const removed = current.filter((id) => !wanted.includes(id));
  const added = wanted.filter((id) => !current.includes(id));
  if (removed.length) {
    await tx.assignmentAttachment.deleteMany({ where: { assignmentId, fileId: { in: removed } } });
    await detachFiles(tx, removed);
  }
  if (added.length) {
    await assertFileContext(tx, added, 'assignment');
    await attachFiles(tx, user, added, 'assignment', assignmentId);
    await tx.assignmentAttachment.createMany({ data: added.map((fileId) => ({ assignmentId, fileId })) });
  }
}

async function publishAfterCommit(id: string) {
  try {
    await publishOnce(id);
  } catch (error) {
    logger.error('publishOnce failed', { assignmentId: id, message: error instanceof Error ? error.message : String(error) });
  }
}

export async function createAssignment(user: AccessUser, courseId: string, input: AssignmentInput, request?: Request) {
  await assertCanManageCourse(user, courseId);
  assertSchedule(input, new Date());
  const id = await prisma.$transaction(async (tx) => {
    const rubricId = input.rubric?.length ? await writeRubric(tx, null, input.rubric) : null;
    const a = await tx.assignment.create({ data: { ...scalarFields(input), courseId, rubricId, createdById: user.id } });
    await setAttachments(tx, user, a.id, [], input.attachmentFileIds);
    return a.id;
  });
  await audit({ actorId: user.id, action: 'assignment.create', entityType: 'Assignment', entityId: id, metadata: { courseId, status: input.status }, request });
  await publishAfterCommit(id);
  return toAssignment(await loadFull(id));
}

/** Current row → validator input shape, so a PATCH is validated as a whole (same superRefine). */
function asInput(a: FullAssignment) {
  const dto = toAssignment(a);
  return {
    ...dto,
    rubric: dto.rubric?.map(({ order: _order, ...c }) => c) ?? null,
    attachmentFileIds: dto.attachments.map((f) => f.id),
  };
}

export async function updateAssignment(user: AccessUser, id: string, patch: AssignmentPatch, request?: Request) {
  const existing = await loadFull(id);
  await assertCanManageCourse(user, existing.courseId);
  const merged = assignmentInput.parse({ ...asInput(existing), ...stripUndefined(patch) });
  const scheduleChanged =
    merged.status === 'SCHEDULED' &&
    (existing.status !== 'SCHEDULED' || existing.availableFrom?.getTime() !== merged.availableFrom?.getTime());
  if (scheduleChanged) assertSchedule(merged, new Date());

  await prisma.$transaction(async (tx) => {
    let rubricId = existing.rubricId;
    if (patch.rubric !== undefined) {
      if (merged.rubric?.length) {
        rubricId = await writeRubric(tx, existing.rubricId, merged.rubric);
      } else if (existing.rubricId) {
        rubricId = null;
      }
    }
    await tx.assignment.update({ where: { id }, data: { ...scalarFields(merged), rubricId } });
    if (existing.rubricId && rubricId === null) await tx.rubric.delete({ where: { id: existing.rubricId } });
    if (patch.attachmentFileIds !== undefined) {
      await setAttachments(tx, user, id, existing.attachments.map((x) => x.fileId), merged.attachmentFileIds);
    }
  });
  await audit({
    actorId: user.id,
    action: 'assignment.update',
    entityType: 'Assignment',
    entityId: id,
    metadata: { fields: Object.keys(stripUndefined(patch)) },
    request,
  });
  await publishAfterCommit(id);
  const [a, submissionCount] = await Promise.all([loadFull(id), prisma.submission.count({ where: { assignmentId: id, attemptNumber: { gt: 0 } } })]);
  return { ...toAssignment(a), submissionCount };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** FR-51: hard delete with no submissions, otherwise archive. */
export async function deleteOrArchiveAssignment(user: AccessUser, id: string, request?: Request) {
  const a = await loadFull(id);
  await assertCanManageCourse(user, a.courseId);
  const submissions = await prisma.submission.count({ where: { assignmentId: id } });
  let result: 'deleted' | 'archived';
  if (submissions === 0) {
    await prisma.$transaction(async (tx) => {
      await detachFiles(tx, a.attachments.map((x) => x.fileId));
      await tx.assignment.delete({ where: { id } });
      if (a.rubricId) await tx.rubric.delete({ where: { id: a.rubricId } });
    });
    result = 'deleted';
  } else {
    await prisma.assignment.update({ where: { id }, data: { archivedAt: a.archivedAt ?? new Date() } });
    result = 'archived';
  }
  await audit({ actorId: user.id, action: result === 'deleted' ? 'assignment.delete' : 'assignment.archive', entityType: 'Assignment', entityId: id, metadata: { courseId: a.courseId, title: a.title }, request });
  return { id, result };
}

/** FR-15: copy as DRAFT; rubric as new rows; attachment bytes re-saved as new FileObjects (B2). */
export async function duplicateAssignment(user: AccessUser, id: string, courseIds: string[], request?: Request) {
  const src = await loadFull(id);
  await assertCanManageCourse(user, src.courseId);
  const targets = [...new Set(courseIds)];
  for (const courseId of targets) await assertCanManageCourse(user, courseId);

  const input = assignmentInput.parse({ ...asInput(src), status: 'DRAFT' });
  const created: { courseId: string; assignmentId: string }[] = [];
  for (const courseId of targets) {
    // Bytes are copied outside the transaction; if it fails the copies stay unattached and the purge reclaims them.
    const fileIds: string[] = [];
    for (const { file } of src.attachments) {
      const saved = await saveFile(readFile(file.storageKey), { ext: extOf(file.originalName) });
      const copy = await prisma.fileObject.create({
        data: { ownerId: user.id, originalName: file.originalName, mimeType: file.mimeType, sizeBytes: saved.sizeBytes, storageKey: saved.storageKey, sha256: saved.sha256, context: 'assignment' },
      });
      fileIds.push(copy.id);
    }
    const assignmentId = await prisma.$transaction(async (tx) => {
      const rubricId = input.rubric?.length ? await writeRubric(tx, null, input.rubric.map(({ id: _id, ...c }) => c)) : null;
      const a = await tx.assignment.create({ data: { ...scalarFields(input), courseId, rubricId, createdById: user.id } });
      await setAttachments(tx, user, a.id, [], fileIds);
      return a.id;
    });
    created.push({ courseId, assignmentId });
    await audit({ actorId: user.id, action: 'assignment.duplicate', entityType: 'Assignment', entityId: assignmentId, metadata: { sourceId: id, courseId }, request });
  }
  return { created };
}

/** Courses the user may author in, for the duplicate dialog. */
export async function listManagedCourses(user: AccessUser) {
  const where: Prisma.CourseWhereInput =
    user.role === 'ADMIN' ? { archivedAt: null } : { archivedAt: null, OR: [{ teacherId: user.id }, { coTeacherIds: { has: user.id } }] };
  return prisma.course.findMany({ where, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } });
}

// ---------------------------------------------------------------------------
// Submit (FR-22..FR-24, FR-53, FR-60)
// ---------------------------------------------------------------------------

const DEADLINE_PASSED = 'The deadline has passed and late submissions are closed.';
const RETURNED_LOCKED = 'This submission has been returned and can no longer be changed.';

export async function submit(user: AccessUser, assignmentId: string, input: { text?: string; fileIds: string[] }) {
  const now = new Date();
  const a = await prisma.assignment.findUnique({ where: { id: assignmentId } });
  // 1. visible
  if (!a || !isAssignmentVisible(a, now)) throw notFound();
  // 2. STUDENT, ACTIVE-enrolled
  if (user.role !== 'STUDENT') throw new AppError('FORBIDDEN', 'Only students can submit work.');
  const [enrolled, exempt] = await Promise.all([
    prisma.enrollment.findFirst({ where: { courseId: a.courseId, studentId: user.id, status: 'ACTIVE' }, select: { id: true } }),
    prisma.gradeExemption.findUnique({ where: { assignmentId_studentId: { assignmentId, studentId: user.id } } }),
  ]);
  if (!enrolled) throw new AppError('FORBIDDEN', 'You are not enrolled in this course.');
  // 3. not exempt, takes submissions
  if (exempt) throw new AppError('VALIDATION_ERROR', 'You are exempt from this assignment.');
  if (a.submissionType === 'NO_SUBMISSION') throw new AppError('VALIDATION_ERROR', 'This assignment does not take online submissions.');
  // 4. deadline
  const open = now <= a.dueAt || (a.allowLate && (!a.lateCutoffAt || now <= a.lateCutoffAt));
  if (!open) throw new AppError('VALIDATION_ERROR', DEADLINE_PASSED);
  // 5. content matches the type
  const text = input.text?.trim() ? input.text : null;
  const fileIds = [...new Set(input.fileIds)];
  if (a.submissionType === 'ONLINE_TEXT' && (!text || fileIds.length)) throw new AppError('VALIDATION_ERROR', 'Enter your answer as text.');
  if (a.submissionType === 'FILE_UPLOAD' && fileIds.length === 0) throw new AppError('VALIDATION_ERROR', 'Attach at least one file.');
  if (a.submissionType === 'TEXT_AND_FILE' && !text && fileIds.length === 0) throw new AppError('VALIDATION_ERROR', 'Enter text or attach a file.');
  if (fileIds.length > a.maxFileCount) throw new AppError('VALIDATION_ERROR', `You can attach at most ${a.maxFileCount} files.`);
  const storedText = a.submissionType === 'FILE_UPLOAD' ? null : text;

  const isLate = now > a.dueAt;
  const days = computeLateDays(now, a.dueAt);

  const run = () =>
    prisma.$transaction(async (tx) => {
      const existing = await tx.submission.findUnique({
        where: { assignmentId_studentId: { assignmentId, studentId: user.id } },
        include: { files: { select: { fileId: true } } },
      });
      if (existing?.status === 'RETURNED') throw new AppError('CONFLICT', RETURNED_LOCKED);
      // 6. each file is mine, context 'submission', unattached or already on this submission (attachFiles checks the rest).
      await assertFileContext(tx, fileIds, 'submission');

      let id: string;
      if (!existing) {
        id = (
          await tx.submission.create({
            data: { assignmentId, studentId: user.id, status: 'SUBMITTED', text: storedText, attemptNumber: 1, submittedAt: now, isLate, lateDays: days },
          })
        ).id;
      } else {
        id = existing.id;
        await tx.submissionHistory.create({
          data: { submissionId: id, attemptNumber: existing.attemptNumber, text: existing.text, fileIds: existing.files.map((f) => f.fileId), submittedAt: existing.submittedAt },
        });
        await tx.submission.update({
          where: { id },
          data: {
            text: storedText,
            attemptNumber: existing.attemptNumber + 1,
            submittedAt: now,
            isLate,
            lateDays: days,
            rawScore: null,
            penaltyPercent: null,
            finalScore: null,
            feedback: null,
            rubricScores: Prisma.DbNull,
            gradedById: null,
            gradedAt: null,
          },
        });
        // Old files stay attached to this submission id so history keeps its bytes (B1).
        await tx.submissionFile.deleteMany({ where: { submissionId: id } });
      }
      await attachFiles(tx, user, fileIds, 'submission', id);
      if (fileIds.length) await tx.submissionFile.createMany({ data: fileIds.map((fileId) => ({ submissionId: id, fileId })) });
      return { id, created: !existing };
    });

  let result: { id: string; created: boolean };
  try {
    result = await run();
  } catch (error) {
    // Two concurrent first submits: the loser retries once as a resubmit.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') result = await run();
    else throw error;
  }
  const sub = await prisma.submission.findUniqueOrThrow({ where: { id: result.id }, include: submissionInclude });
  return { submission: toStudentSubmission(toSubmission(sub)), created: result.created };
}

// ---------------------------------------------------------------------------
// Grading (FR-30..FR-36, FR-56, FR-59)
// ---------------------------------------------------------------------------

type GradeTarget = {
  maxPoints: Prisma.Decimal;
  allowExtraCredit: boolean;
  rubric: { criteria: { id: string; title: string; maxPoints: Prisma.Decimal }[] } | null;
};

const invalid = (message: string) => new AppError('VALIDATION_ERROR', message);

/** D7: with a rubric the server derives rawScore = Σ points; otherwise rawScore within maxRawScore (FR-36). */
function scoreFrom(a: GradeTarget, input: Pick<GradeInput, 'rawScore' | 'rubricScores'>) {
  const criteria = a.rubric?.criteria ?? [];
  if (criteria.length) {
    const scores = input.rubricScores ?? [];
    const byId = new Map(scores.map((s) => [s.criterionId, s]));
    if (byId.size !== scores.length) throw invalid('Each rubric criterion can be scored only once.');
    if (scores.some((s) => !criteria.some((c) => c.id === s.criterionId))) throw invalid('Unknown rubric criterion.');
    for (const c of criteria) {
      const s = byId.get(c.id);
      if (!s) throw invalid(`Score every rubric criterion (missing "${c.title}").`);
      if (dec(s.points).gt(dec(c.maxPoints))) throw invalid(`"${c.title}" is worth at most ${pts(c.maxPoints)} points.`);
    }
    const raw = scores.reduce((sum, s) => sum.plus(dec(s.points)), dec(0));
    const rubricScores: RubricScore[] = criteria.map((c) => {
      const s = byId.get(c.id)!;
      return { criterionId: c.id, points: s.points, ...(s.comment ? { comment: s.comment } : {}) };
    });
    return { raw: fixed2(raw), rubricScores: rubricScores as unknown as Prisma.InputJsonValue };
  }
  if (input.rawScore === undefined) throw invalid('Enter a raw score.');
  const max = maxRawScore(a.maxPoints, a.allowExtraCredit);
  if (dec(input.rawScore).gt(max)) throw invalid(`The raw score must be between 0 and ${pts(max.toString())}.`);
  return { raw: input.rawScore, rubricScores: Prisma.DbNull };
}

const gradingAssignmentSelect = {
  id: true,
  title: true,
  courseId: true,
  maxPoints: true,
  allowExtraCredit: true,
  course: { select: { name: true, teacherId: true, coTeacherIds: true } },
  rubric: { select: { criteria: { select: { id: true, title: true, maxPoints: true }, orderBy: { order: 'asc' } } } },
} satisfies Prisma.AssignmentSelect;
type GradingAssignment = Prisma.AssignmentGetPayload<{ select: typeof gradingAssignmentSelect }>;

async function notifyReturned(a: GradingAssignment, studentId: string, finalScore: Prisma.Decimal | string | null) {
  await notifyStudentAndParents({
    type: 'assignment.returned',
    studentIds: [studentId],
    title: `Returned: ${a.title}`,
    body: `${a.course.name}: ${a.title} — ${finalScore === null ? '—' : pts(finalScore)}/${pts(a.maxPoints)}`,
    link: `/courses/${a.courseId}/assignments/${a.id}`,
  });
}

async function loadFullSubmission(id: string) {
  return prisma.submission.findUniqueOrThrow({ where: { id }, include: submissionInclude });
}

export async function gradeSubmission(user: AccessUser, submissionId: string, input: GradeInput, request?: Request) {
  const sub = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { id: true, studentId: true, status: true, returnedAt: true, assignment: { select: gradingAssignmentSelect } },
  });
  if (!sub) throw new AppError('NOT_FOUND', 'Submission not found');
  const a = sub.assignment;
  await assertCanManageCourse(user, a.courseId);
  const { raw, rubricScores } = scoreFrom(a, input);
  const finalScore = computeFinalScore(raw, input.penaltyPercent).toFixed(2);
  const now = new Date();
  const returning = input.return && sub.status !== 'RETURNED';

  await prisma.submission.update({
    where: { id: submissionId },
    data: {
      rawScore: raw,
      penaltyPercent: input.penaltyPercent,
      finalScore,
      rubricScores,
      feedback: input.feedback ?? null,
      gradedById: user.id,
      gradedAt: now,
      ...(returning ? { status: 'RETURNED' as const, returnedAt: now } : {}),
    },
  });
  await audit({ actorId: user.id, action: 'submission.grade', entityType: 'Submission', entityId: submissionId, metadata: { assignmentId: a.id, studentId: sub.studentId, finalScore }, request });
  if (returning) {
    await audit({ actorId: user.id, action: 'submission.return', entityType: 'Submission', entityId: submissionId, metadata: { assignmentId: a.id, studentId: sub.studentId }, request });
    await notifyReturned(a, sub.studentId, finalScore);
  }
  return toSubmission(await loadFullSubmission(submissionId));
}

/** FR-32 "Return all graded". Default set = graded and not yet returned. */
export async function bulkReturn(user: AccessUser, assignmentId: string, submissionIds: string[] | undefined, request?: Request) {
  const a = await prisma.assignment.findUnique({ where: { id: assignmentId }, select: gradingAssignmentSelect });
  if (!a) throw notFound();
  await assertCanManageCourse(user, a.courseId);

  const skipped: { submissionId: string; reason: 'NOT_GRADED' | 'ALREADY_RETURNED' | 'NOT_FOUND' }[] = [];
  const candidates = await prisma.submission.findMany({
    where: submissionIds ? { assignmentId, id: { in: submissionIds } } : { assignmentId, status: 'SUBMITTED', gradedAt: { not: null } },
    select: { id: true, studentId: true, status: true, gradedAt: true, finalScore: true },
  });
  if (submissionIds) {
    for (const id of new Set(submissionIds)) {
      const s = candidates.find((c) => c.id === id);
      if (!s) skipped.push({ submissionId: id, reason: 'NOT_FOUND' });
      else if (s.status === 'RETURNED') skipped.push({ submissionId: id, reason: 'ALREADY_RETURNED' });
      else if (!s.gradedAt) skipped.push({ submissionId: id, reason: 'NOT_GRADED' });
    }
  }
  const eligible = candidates.filter((s) => s.status === 'SUBMITTED' && s.gradedAt);
  const now = new Date();
  if (eligible.length) {
    await prisma.submission.updateMany({
      where: { id: { in: eligible.map((s) => s.id) }, status: 'SUBMITTED' },
      data: { status: 'RETURNED', returnedAt: now },
    });
  }
  for (const s of eligible) {
    await audit({ actorId: user.id, action: 'submission.return', entityType: 'Submission', entityId: s.id, metadata: { assignmentId, studentId: s.studentId, bulk: true }, request });
    await notifyReturned(a, s.studentId, s.finalScore);
  }
  return { returned: eligible.map((s) => s.id), skipped };
}

/** FR-34, FR-8: attempt-0 submission for a student who did not submit. */
export async function gradeOffline(user: AccessUser, assignmentId: string, input: OfflineGradeInput, request?: Request) {
  const a = await prisma.assignment.findUnique({ where: { id: assignmentId }, select: gradingAssignmentSelect });
  if (!a) throw notFound();
  await assertCanManageCourse(user, a.courseId);
  const [enrolled, existing] = await Promise.all([
    prisma.enrollment.findFirst({ where: { courseId: a.courseId, studentId: input.studentId, status: 'ACTIVE' }, select: { id: true } }),
    prisma.submission.findUnique({ where: { assignmentId_studentId: { assignmentId, studentId: input.studentId } }, select: { id: true } }),
  ]);
  if (!enrolled) throw invalid('That student is not enrolled in this course.');
  if (existing) throw new AppError('CONFLICT', 'This student already has a submission; grade that one instead.');
  const { raw, rubricScores } = scoreFrom(a, input);
  const finalScore = computeFinalScore(raw, 0).toFixed(2);
  const now = new Date();
  const sub = await prisma.submission.create({
    data: {
      assignmentId,
      studentId: input.studentId,
      status: input.return ? 'RETURNED' : 'SUBMITTED',
      text: null,
      attemptNumber: 0,
      submittedAt: now,
      isLate: false,
      lateDays: 0,
      rawScore: raw,
      penaltyPercent: '0',
      finalScore,
      rubricScores,
      feedback: input.feedback ?? null,
      gradedById: user.id,
      gradedAt: now,
      returnedAt: input.return ? now : null,
    },
  });
  await audit({ actorId: user.id, action: 'submission.grade_offline', entityType: 'Submission', entityId: sub.id, metadata: { assignmentId, studentId: input.studentId, finalScore }, request });
  if (input.return) await notifyReturned(a, input.studentId, finalScore);
  return toSubmission(await loadFullSubmission(sub.id));
}

/** FR-35: PUT upserts, DELETE removes; both idempotent. The row is the PRD-11 exclusion flag. */
export async function setExemption(
  user: AccessUser,
  assignmentId: string,
  studentId: string,
  exempt: boolean,
  reason?: string,
  request?: Request,
) {
  const a = await prisma.assignment.findUnique({ where: { id: assignmentId }, select: { courseId: true } });
  if (!a) throw notFound();
  await assertCanManageCourse(user, a.courseId);
  if (exempt) {
    const enrolled = await prisma.enrollment.findFirst({ where: { courseId: a.courseId, studentId, status: 'ACTIVE' }, select: { id: true } });
    if (!enrolled) throw invalid('That student is not enrolled in this course.');
    await prisma.gradeExemption.upsert({
      where: { assignmentId_studentId: { assignmentId, studentId } },
      update: { reason: reason ?? null },
      create: { assignmentId, studentId, reason: reason ?? null },
    });
  } else {
    await prisma.gradeExemption.deleteMany({ where: { assignmentId, studentId } });
  }
  await audit({ actorId: user.id, action: exempt ? 'assignment.exempt' : 'assignment.unexempt', entityType: 'Assignment', entityId: assignmentId, metadata: { studentId, reason }, request });
  return exempt ? { assignmentId, studentId, exempt: true as const, reason: reason ?? null } : { assignmentId, studentId, exempt: false as const };
}

// ---------------------------------------------------------------------------
// Reads (FR-48, FR-50, FR-54, FR-55, FR-57, FR-58)
// ---------------------------------------------------------------------------

async function loadCourseForView(user: AccessUser, courseId: string) {
  await assertCanViewCourse(user, courseId);
  return prisma.course.findUniqueOrThrow({ where: { id: courseId }, select: { id: true, name: true, teacherId: true, coTeacherIds: true } });
}

export async function listCourseAssignments(user: AccessUser, courseId: string, studentId?: string) {
  const course = await loadCourseForView(user, courseId);
  const now = new Date();

  if (canSeeDrafts(user, course)) {
    const [assignments, roster] = await Promise.all([
      prisma.assignment.findMany({ where: { courseId }, include: { course: { select: { name: true } } }, orderBy: { dueAt: 'asc' } }),
      prisma.enrollment.findMany({ where: { courseId, status: 'ACTIVE' }, select: { studentId: true } }),
    ]);
    const active = new Set(roster.map((r) => r.studentId));
    const ids = assignments.map((a) => a.id);
    const [subs, exemptions] = await Promise.all([
      prisma.submission.findMany({ where: { assignmentId: { in: ids } }, select: { assignmentId: true, studentId: true, status: true, gradedAt: true, attemptNumber: true } }),
      prisma.gradeExemption.findMany({ where: { assignmentId: { in: ids } }, select: { assignmentId: true, studentId: true } }),
    ]);
    const items = assignments.map((a) => {
      const mine = subs.filter((s) => s.assignmentId === a.id && active.has(s.studentId));
      const exempt = new Set(exemptions.filter((e) => e.assignmentId === a.id && active.has(e.studentId)).map((e) => e.studentId));
      const submittedIds = new Set(mine.map((s) => s.studentId));
      const pastDue = isAssignmentVisible(a, now) && a.dueAt < now && a.submissionType !== 'NO_SUBMISSION';
      return {
        ...toSummary(a),
        counts: {
          enrolled: active.size,
          submitted: mine.filter((s) => s.attemptNumber > 0).length,
          graded: mine.filter((s) => s.gradedAt).length,
          returned: mine.filter((s) => s.status === 'RETURNED').length,
          exempt: exempt.size,
          missing: pastDue ? [...active].filter((id) => !submittedIds.has(id) && !exempt.has(id)).length : 0,
        },
      };
    });
    return { view: 'manager' as const, items };
  }

  const viewed = await resolveViewedStudent(user, studentId, courseId);
  const assignments = await prisma.assignment.findMany({
    where: { courseId, ...visibleWhere(now) },
    include: {
      course: { select: { name: true } },
      submissions: { where: { studentId: viewed.studentId }, select: summarySubSelect },
      exemptions: { where: { studentId: viewed.studentId }, select: { studentId: true } },
    },
    orderBy: { dueAt: 'asc' },
  });
  publishNewlyVisible(assignments, now);
  return {
    view: 'student' as const,
    studentId: viewed.studentId,
    children: viewed.children,
    items: assignments.map((a) => toStudentRow(a, a.submissions[0] ?? null, a.exemptions.length > 0, now)),
  };
}

export async function getAssignment(user: AccessUser, id: string, studentId?: string) {
  const a = await loadFull(id);
  await assertCanViewCourse(user, a.courseId);
  const now = new Date();
  const serverNow = now.toISOString();
  if (canSeeDrafts(user, a.course)) {
    const submissionCount = await prisma.submission.count({ where: { assignmentId: id, attemptNumber: { gt: 0 } } });
    return { assignment: toAssignment(a), canManage: true as const, submissionCount, serverNow, submission: null, exempt: false, studentId: null };
  }
  if (!isAssignmentVisible(a, now)) throw notFound();
  publishNewlyVisible([a], now);
  const viewed = await resolveViewedStudent(user, studentId, a.courseId);
  const [sub, exemption] = await Promise.all([
    prisma.submission.findUnique({ where: { assignmentId_studentId: { assignmentId: id, studentId: viewed.studentId } }, include: submissionInclude }),
    prisma.gradeExemption.findUnique({ where: { assignmentId_studentId: { assignmentId: id, studentId: viewed.studentId } } }),
  ]);
  return {
    assignment: toAssignment(a),
    canManage: false as const,
    submissionCount: undefined,
    serverNow,
    submission: sub ? toStudentSubmission(toSubmission(sub)) : null,
    exempt: !!exemption,
    studentId: viewed.studentId,
  };
}

export type RosterRow = {
  student: { id: string; name: string };
  chipStatus: ChipStatus;
  exempt: boolean;
  submission: {
    id: string;
    status: 'SUBMITTED' | 'RETURNED';
    attemptNumber: number;
    submittedAt: string;
    isLate: boolean;
    lateDays: number;
    finalScore: string | null;
    gradedAt: string | null;
    returnedAt: string | null;
  } | null;
};

/** FR-54: every ACTIVE enrollee, submitted or not. */
export async function listGradingRoster(
  user: AccessUser,
  assignmentId: string,
  query: { sort: 'name' | 'submittedAt'; status?: ChipStatus },
  page: { skip: number; take: number },
) {
  const a = await prisma.assignment.findUnique({ where: { id: assignmentId }, select: { courseId: true } });
  if (!a) throw notFound();
  await assertCanManageCourse(user, a.courseId);
  const [roster, subs, exemptions] = await Promise.all([
    prisma.enrollment.findMany({
      where: { courseId: a.courseId, status: 'ACTIVE' },
      select: { student: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: [{ student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }],
    }),
    prisma.submission.findMany({
      where: { assignmentId },
      select: { id: true, studentId: true, status: true, attemptNumber: true, submittedAt: true, isLate: true, lateDays: true, finalScore: true, gradedAt: true, returnedAt: true },
    }),
    prisma.gradeExemption.findMany({ where: { assignmentId }, select: { studentId: true } }),
  ]);
  const exempt = new Set(exemptions.map((e) => e.studentId));
  let rows: RosterRow[] = roster.map(({ student }) => {
    const s = subs.find((x) => x.studentId === student.id) ?? null;
    const isExempt = exempt.has(student.id);
    return {
      student: userRef(student)!,
      chipStatus: submissionChipStatus({ exempt: isExempt, submission: s }),
      exempt: isExempt,
      submission: s
        ? {
            id: s.id,
            status: s.status,
            attemptNumber: s.attemptNumber,
            submittedAt: s.submittedAt.toISOString(),
            isLate: s.isLate,
            lateDays: s.lateDays,
            finalScore: serializeDecimal(s.finalScore),
            gradedAt: iso(s.gradedAt),
            returnedAt: iso(s.returnedAt),
          }
        : null,
    };
  });
  if (query.status) rows = rows.filter((r) => r.chipStatus === query.status);
  if (query.sort === 'submittedAt') {
    rows.sort((x, y) => (x.submission?.submittedAt ?? '￿').localeCompare(y.submission?.submittedAt ?? '￿'));
  }
  return { items: rows.slice(page.skip, page.skip + page.take), total: rows.length };
}

/** FR-55: submitter, linked parent, or course manager (history only for managers); anyone else NOT_FOUND. */
export async function getSubmission(user: AccessUser, submissionId: string) {
  const sub = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: {
      ...submissionInclude,
      history: { orderBy: { attemptNumber: 'asc' } },
      assignment: { select: { status: true, availableFrom: true, archivedAt: true, course: { select: { teacherId: true, coTeacherIds: true } } } },
    },
  });
  const missing = new AppError('NOT_FOUND', 'Submission not found');
  if (!sub) throw missing;
  if (canSeeDrafts(user, sub.assignment.course)) {
    const fileIds = [...new Set(sub.history.flatMap((h) => h.fileIds))];
    const files = fileIds.length ? await prisma.fileObject.findMany({ where: { id: { in: fileIds } } }) : [];
    const dto = toSubmission(sub);
    dto.history = sub.history.map((h) => ({
      attemptNumber: h.attemptNumber,
      text: h.text,
      files: h.fileIds.map((fid) => files.find((f) => f.id === fid)).filter((f): f is FileObject => !!f).map(fileRef),
      submittedAt: h.submittedAt.toISOString(),
    }));
    return dto;
  }
  if (!isAssignmentVisible(sub.assignment, new Date())) throw missing;
  const own = user.role === 'STUDENT' && sub.studentId === user.id;
  const parent =
    user.role === 'PARENT' &&
    !!(await prisma.parentStudentLink.findFirst({ where: { parentId: user.id, studentId: sub.studentId }, select: { id: true } }));
  if (!own && !parent) throw missing;
  return toStudentSubmission(toSubmission(sub));
}

/** Rows for one student across ACTIVE enrollments (optionally one course). */
async function studentRows(studentId: string, courseId: string | undefined, now: Date, fullGradesFor: (courseId: string) => boolean = () => false) {
  const enrollments = await prisma.enrollment.findMany({
    where: { studentId, status: 'ACTIVE' },
    select: { course: { select: { id: true, name: true, teacherId: true, coTeacherIds: true } } },
    orderBy: { course: { name: 'asc' } },
  });
  const courses = enrollments.map((e) => e.course);
  const courseIds = courses.map((c) => c.id).filter((id) => !courseId || id === courseId);
  const assignments = await prisma.assignment.findMany({
    where: { courseId: { in: courseIds }, ...visibleWhere(now) },
    include: {
      course: { select: { name: true } },
      submissions: { where: { studentId }, select: summarySubSelect },
      exemptions: { where: { studentId }, select: { studentId: true } },
    },
    orderBy: { dueAt: 'asc' },
  });
  publishNewlyVisible(assignments, now);
  return {
    courses,
    rows: assignments.map((a) => ({
      ...toStudentRow(a, a.submissions[0] ?? null, a.exemptions.length > 0, now, fullGradesFor(a.courseId)),
      canManage: fullGradesFor(a.courseId),
    })),
  };
}

const TO_GRADE_LIMIT = 200;

export async function listMyAssignments(user: AccessUser, query: { studentId?: string; tab?: Exclude<Group, 'CLOSED'>; courseId?: string }) {
  if (user.role === 'TEACHER' || user.role === 'ADMIN') {
    const subs = await prisma.submission.findMany({
      where: {
        status: 'SUBMITTED',
        gradedAt: null,
        attemptNumber: { gt: 0 },
        assignment: {
          archivedAt: null,
          ...(query.courseId ? { courseId: query.courseId } : {}),
          ...(user.role === 'TEACHER' ? { course: { OR: [{ teacherId: user.id }, { coTeacherIds: { has: user.id } }] } } : {}),
        },
      },
      select: {
        id: true,
        submittedAt: true,
        isLate: true,
        student: { select: { id: true, firstName: true, lastName: true } },
        assignment: { include: { course: { select: { name: true } } } },
      },
      orderBy: { submittedAt: 'asc' },
      // ponytail: capped list, add pagination if a teacher ever has > 200 ungraded submissions.
      take: TO_GRADE_LIMIT,
    });
    return {
      view: 'toGrade' as const,
      items: subs.map((s) => ({
        submissionId: s.id,
        assignment: toSummary(s.assignment),
        student: userRef(s.student)!,
        submittedAt: s.submittedAt.toISOString(),
        isLate: s.isLate,
      })),
    };
  }

  const viewed = await resolveViewedStudent(user, query.studentId);
  const now = new Date();
  const { courses, rows } = await studentRows(viewed.studentId, query.courseId, now);
  const items = rows
    .map(({ canManage: _c, ...r }) => r)
    // Tab omitted → all rows (the page groups them client-side).
    .filter((r) => !query.tab || r.group === query.tab);
  return {
    view: 'student' as const,
    studentId: viewed.studentId,
    children: viewed.children,
    courses: courses.map((c) => ({ id: c.id, name: c.name })),
    items,
  };
}

/** FR-58 / D8: per course, managers get full grade fields, everyone else the serializer. */
export async function listStudentAssignments(user: AccessUser, studentId: string, courseId?: string) {
  await assertCanViewStudent(user, studentId);
  const student = await prisma.user.findFirst({ where: { id: studentId, role: 'STUDENT' }, select: { id: true, firstName: true, lastName: true } });
  if (!student) throw new AppError('NOT_FOUND', 'Student not found');
  const now = new Date();
  const enrollments = await prisma.enrollment.findMany({
    where: { studentId, status: 'ACTIVE' },
    select: { course: { select: { id: true, teacherId: true, coTeacherIds: true } } },
  });
  const managed = new Set(enrollments.filter((e) => canSeeDrafts(user, e.course)).map((e) => e.course.id));
  const { rows } = await studentRows(studentId, courseId, now, (cid) => managed.has(cid));
  return { student: userRef(student)!, items: rows };
}
