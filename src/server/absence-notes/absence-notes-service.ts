import type { AbsenceNoteStatus, Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { AppError, type PaginationParams } from '@/server/http';
import { audit } from '@/server/audit';
import { assertCanViewStudent, type AccessUser } from '@/server/auth/student-access';
import { notify } from '@/server/notifications/notify';
import { schoolToday } from '@/server/attendance/attendance-rules';
import {
  ABSENCE_REASON_LABELS,
  dateWindowIssue,
  type AbsenceNoteInput,
  type AbsenceNoteListQuery,
  type ReviewInput,
} from '@/lib/validators/absence-notes';
import { coversRecord, type CoverageNote } from './absence-coverage';

/**
 * PRD-15 absence notes (FR-18 to FR-23, FR-26, FR-41). Never imports
 * attendance-service (it imports us: findCovering), only the pure rules.
 */

const toDbDate = (d: string) => new Date(`${d}T00:00:00Z`);
const fromDbDate = (d: Date) => d.toISOString().slice(0, 10);
const fullName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`;
const currentYear = { academicYear: { isCurrent: true } };

async function schoolTz(): Promise<string> {
  const s = await prisma.schoolSettings.findUnique({ where: { id: 'singleton' }, select: { timezone: true } });
  return s?.timezone ?? 'UTC';
}

/** The homeroom teacher of the student's current-year section, or null. */
export async function homeroomTeacherOf(studentId: string): Promise<string | null> {
  const m = await prisma.sectionMember.findFirst({
    where: { studentId, section: currentYear },
    select: { section: { select: { homeroomTeacherId: true } } },
  });
  return m?.section.homeroomTeacherId ?? null;
}

/** NFR-5: ADMIN, or the student's current homeroom teacher. */
export async function assertHomeroomOrAdmin(user: AccessUser, studentId: string): Promise<void> {
  if (user.role === 'ADMIN') return;
  if (user.role === 'TEACHER' && (await homeroomTeacherOf(studentId)) === user.id) return;
  throw new AppError('FORBIDDEN', 'Only the homeroom teacher or an administrator can review this note.', { reason: 'NOT_HOMEROOM' });
}

async function homeroomStudentIds(teacherId: string): Promise<string[]> {
  const rows = await prisma.sectionMember.findMany({
    where: { section: { homeroomTeacherId: teacherId, ...currentYear } },
    select: { studentId: true },
  });
  return rows.map((r) => r.studentId);
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

const noteInclude = {
  student: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      sectionMemberships: { where: { section: currentYear }, select: { section: { select: { name: true } } } },
    },
  },
  submittedBy: { select: { id: true, firstName: true, lastName: true } },
  reviewedBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.AbsenceNoteInclude;

type NoteRow = Prisma.AbsenceNoteGetPayload<{ include: typeof noteInclude }>;

async function serialize(rows: NoteRow[]) {
  const periodIds = [...new Set(rows.flatMap((r) => r.periodIds))];
  const fileIds = rows.flatMap((r) => (r.fileId ? [r.fileId] : []));
  const [periods, files] = await Promise.all([
    periodIds.length ? prisma.period.findMany({ where: { id: { in: periodIds } }, select: { id: true, name: true, order: true } }) : [],
    fileIds.length ? prisma.fileObject.findMany({ where: { id: { in: fileIds } }, select: { id: true, originalName: true } }) : [],
  ]);
  const periodById = new Map(periods.map((p) => [p.id, p]));
  const fileById = new Map(files.map((f) => [f.id, f]));
  return rows.map((r) => {
    const file = r.fileId ? fileById.get(r.fileId) : undefined;
    return {
      id: r.id,
      student: {
        id: r.student.id,
        firstName: r.student.firstName,
        lastName: r.student.lastName,
        sectionName: r.student.sectionMemberships[0]?.section.name ?? null,
      },
      submittedBy: { id: r.submittedBy.id, name: fullName(r.submittedBy) },
      fromDate: fromDbDate(r.fromDate),
      toDate: fromDbDate(r.toDate),
      partialDay: r.partialDay,
      periods: r.periodIds
        .flatMap((id) => (periodById.has(id) ? [periodById.get(id)!] : []))
        .sort((a, b) => a.order - b.order)
        .map((p) => ({ id: p.id, name: p.name })),
      reason: r.reason,
      details: r.details,
      file: file ? { id: file.id, name: file.originalName, url: `/api/files/${file.id}` } : null,
      status: r.status,
      reviewedBy: r.reviewedBy ? { id: r.reviewedBy.id, name: fullName(r.reviewedBy) } : null,
      reviewNote: r.reviewNote,
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

export type AbsenceNoteDto = Awaited<ReturnType<typeof serialize>>[number];

// ---------------------------------------------------------------------------
// Submit (FR-18, FR-19)
// ---------------------------------------------------------------------------

export async function submit(user: AccessUser, input: AbsenceNoteInput): Promise<AbsenceNoteDto> {
  if (user.role !== 'PARENT') throw new AppError('FORBIDDEN', 'Only parents can submit absence notes.');
  await assertCanViewStudent(user, input.studentId);
  const today = schoolToday(new Date(), await schoolTz());
  const issue = dateWindowIssue(input, today);
  if (issue) throw new AppError('VALIDATION_ERROR', issue.message, { reason: 'DATE_WINDOW', fieldErrors: { [issue.path]: [issue.message] } });

  if (input.fileId) {
    const file = await prisma.fileObject.findUnique({ where: { id: input.fileId }, select: { context: true, ownerId: true } });
    if (!file || file.context !== 'absence-note' || file.ownerId !== user.id) {
      throw new AppError('VALIDATION_ERROR', 'The attached document is not valid.', { fieldErrors: { fileId: ['Upload the document again'] } });
    }
  }

  const note = await prisma.$transaction(async (tx) => {
    const created = await tx.absenceNote.create({
      data: {
        studentId: input.studentId,
        submittedById: user.id,
        fromDate: toDbDate(input.fromDate),
        toDate: toDbDate(input.toDate),
        partialDay: input.partialDay,
        periodIds: input.partialDay ? input.periodIds : [],
        reason: input.reason,
        details: input.details || null,
        fileId: input.fileId ?? null,
      },
      include: noteInclude,
    });
    if (input.fileId) {
      // Lazy: files-service pulls in env/storage, which attendance-service's importers (tests, scripts) don't need.
      const { attachFiles } = await import('@/server/files/files-service');
      await attachFiles(tx, user, [input.fileId], 'absence-note', created.id);
    }
    return created;
  });

  const [teacherId, admins] = await Promise.all([
    homeroomTeacherOf(input.studentId),
    prisma.user.findMany({ where: { role: 'ADMIN', status: 'ACTIVE', archivedAt: null }, select: { id: true } }),
  ]);
  const range = input.fromDate === input.toDate ? input.fromDate : `${input.fromDate} to ${input.toDate}`;
  await notify({
    type: 'absence_note.submitted',
    userIds: [...(teacherId ? [teacherId] : []), ...admins.map((a) => a.id)],
    title: `Absence note: ${fullName(note.student)}`,
    body: `${ABSENCE_REASON_LABELS[input.reason]}, ${range}`,
    link: '/attendance/absence-notes',
    email: { template: 'generic-notification' },
  });

  return (await serialize([note]))[0];
}

// ---------------------------------------------------------------------------
// List / detail (FR-20, FR-21)
// ---------------------------------------------------------------------------

async function scopeWhere(user: AccessUser): Promise<Prisma.AbsenceNoteWhereInput> {
  switch (user.role) {
    case 'ADMIN':
      return {};
    case 'PARENT':
      return { student: { studentLinks: { some: { parentId: user.id } } } };
    case 'TEACHER': {
      const ids = await homeroomStudentIds(user.id);
      if (ids.length === 0) throw new AppError('FORBIDDEN', 'Only homeroom teachers review absence notes.', { reason: 'NOT_HOMEROOM' });
      return { studentId: { in: ids } };
    }
    default:
      throw new AppError('FORBIDDEN', 'You do not have permission to view absence notes.');
  }
}

export async function list(user: AccessUser, query: AbsenceNoteListQuery, page: PaginationParams) {
  const where: Prisma.AbsenceNoteWhereInput = {
    AND: [
      await scopeWhere(user),
      query.status ? { status: query.status } : {},
      query.studentId ? { studentId: query.studentId } : {},
      query.to ? { fromDate: { lte: toDbDate(query.to) } } : {},
      query.from ? { toDate: { gte: toDbDate(query.from) } } : {},
      query.q
        ? {
            student: {
              OR: [
                { firstName: { contains: query.q, mode: 'insensitive' } },
                { lastName: { contains: query.q, mode: 'insensitive' } },
              ],
            },
          }
        : {},
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.absenceNote.findMany({
      where,
      include: noteInclude,
      orderBy: [{ [query.sort.field]: query.sort.dir }, { id: 'asc' }],
      skip: page.skip,
      take: page.take,
    }),
    prisma.absenceNote.count({ where }),
  ]);
  return { rows: await serialize(rows), meta: { page: page.page, pageSize: page.pageSize, total } };
}

/** Records for the note's dates (and periods if partial) -- shown to reviewers (FR-21). */
async function coveredRecords(note: { studentId: string } & CoverageNote) {
  const rows = await prisma.attendanceRecord.findMany({
    where: { studentId: note.studentId, session: { date: { gte: toDbDate(note.fromDate), lte: toDbDate(note.toDate) } } },
    select: { id: true, status: true, note: true, session: { select: { date: true, periodId: true, period: { select: { name: true, order: true } } } } },
  });
  return rows
    .map((r) => ({
      id: r.id,
      date: fromDbDate(r.session.date),
      periodId: r.session.periodId,
      periodName: r.session.period?.name ?? null,
      order: r.session.period?.order ?? -1,
      status: r.status,
      note: r.note,
    }))
    .filter((r) => coversRecord(note, r))
    .sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order)
    .map(({ order: _order, ...r }) => r);
}

async function canReview(user: AccessUser, studentId: string) {
  try {
    await assertHomeroomOrAdmin(user, studentId);
    return true;
  } catch {
    return false;
  }
}

export async function get(user: AccessUser, id: string) {
  const row = await prisma.absenceNote.findUnique({ where: { id }, include: noteInclude });
  if (!row) throw new AppError('NOT_FOUND', 'Resource not found');
  const reviewer = await canReview(user, row.studentId);
  if (!reviewer) {
    if (user.role !== 'PARENT') throw new AppError('NOT_FOUND', 'Resource not found');
    await assertCanViewStudent(user, row.studentId); // 404 for an unlinked parent
  }
  const [dto] = await serialize([row]);
  if (!reviewer) return dto;
  return { ...dto, attendanceRecords: await coveredRecords({ studentId: row.studentId, ...dto, periodIds: row.periodIds }) };
}

// ---------------------------------------------------------------------------
// Review (FR-22, FR-23, FR-26)
// ---------------------------------------------------------------------------

export async function review(user: AccessUser, id: string, input: ReviewInput, request?: Request) {
  const existing = await prisma.absenceNote.findUnique({ where: { id }, select: { studentId: true } });
  if (!existing) throw new AppError('NOT_FOUND', 'Resource not found');
  if (user.role === 'PARENT' || user.role === 'STUDENT') throw new AppError('NOT_FOUND', 'Resource not found');
  await assertHomeroomOrAdmin(user, existing.studentId);

  const { recordsExcused, recordsCreated, row } = await prisma.$transaction(async (tx) => {
    const claimed = await tx.absenceNote.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: input.decision, reviewedById: user.id, reviewNote: input.reviewNote || null, reviewedAt: new Date() },
    });
    if (claimed.count === 0) throw new AppError('CONFLICT', 'This note has already been reviewed.', { reason: 'ALREADY_REVIEWED' });
    const note = await tx.absenceNote.findUniqueOrThrow({ where: { id }, include: noteInclude });

    let excused = 0;
    let created = 0;
    if (input.decision === 'APPROVED') {
      const cov: CoverageNote = { fromDate: fromDbDate(note.fromDate), toDate: fromDbDate(note.toDate), partialDay: note.partialDay, periodIds: note.periodIds };
      const sessions = await tx.attendanceSession.findMany({
        where: {
          date: { gte: note.fromDate, lte: note.toDate },
          OR: [
            { course: { enrollments: { some: { studentId: note.studentId, status: 'ACTIVE' } } } },
            { section: { members: { some: { studentId: note.studentId } } } },
          ],
        },
        select: { id: true, date: true, periodId: true, records: { where: { studentId: note.studentId }, select: { status: true } } },
      });
      const label = `Absence note #${note.id}`;
      for (const s of sessions) {
        if (!coversRecord(cov, { date: fromDbDate(s.date), periodId: s.periodId })) continue;
        const rec = s.records[0];
        if (!rec) {
          await tx.attendanceRecord.create({ data: { sessionId: s.id, studentId: note.studentId, status: 'EXCUSED', note: label } });
          created += 1;
        } else if (rec.status === 'ABSENT') {
          await tx.attendanceRecord.update({
            where: { sessionId_studentId: { sessionId: s.id, studentId: note.studentId } },
            data: { status: 'EXCUSED', minutesLate: null, note: label },
          });
          excused += 1;
        }
      }
    }
    return { recordsExcused: excused, recordsCreated: created, row: note };
  });

  await audit({
    actorId: user.id,
    action: `absence_note.${input.decision === 'APPROVED' ? 'approve' : 'reject'}`,
    entityType: 'AbsenceNote',
    entityId: id,
    metadata: { studentId: row.studentId, reviewNote: input.reviewNote ?? null, recordsExcused, recordsCreated },
    request,
  });

  const parents = await prisma.parentStudentLink.findMany({ where: { studentId: row.studentId }, select: { parentId: true } });
  const decided = input.decision === 'APPROVED' ? 'approved' : 'rejected';
  await notify({
    type: 'absence_note.reviewed',
    userIds: parents.map((p) => p.parentId),
    title: `Absence note ${decided}: ${fullName(row.student)}`,
    body: input.reviewNote ? `Reviewer's note: ${input.reviewNote}` : undefined,
    link: `/my-children/${row.studentId}/absence`,
    email: { template: 'generic-notification' },
  });

  return { note: (await serialize([row]))[0], recordsExcused, recordsCreated };
}

// ---------------------------------------------------------------------------
// Attendance integration (FR-24, FR-25, FR-27)
// ---------------------------------------------------------------------------

export interface CoveringNote extends CoverageNote {
  id: string;
  studentId: string;
  status: AbsenceNoteStatus;
}

/** Notes for these students overlapping [from, to] with one of the statuses. */
export async function findCovering(
  studentIds: string[],
  range: { from: string; to: string },
  statuses: AbsenceNoteStatus[],
): Promise<CoveringNote[]> {
  if (studentIds.length === 0) return [];
  const rows = await prisma.absenceNote.findMany({
    where: { studentId: { in: studentIds }, status: { in: statuses }, fromDate: { lte: toDbDate(range.to) }, toDate: { gte: toDbDate(range.from) } },
    select: { id: true, studentId: true, status: true, fromDate: true, toDate: true, partialDay: true, periodIds: true },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => ({ ...r, fromDate: fromDbDate(r.fromDate), toDate: fromDbDate(r.toDate) }));
}
