import type { Prisma, ReportCard } from '@prisma/client';
import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import { audit } from '@/server/audit';
import { assertCanViewStudent, type AccessUser } from '@/server/auth/student-access';
import { notifyStudentAndParents } from '@/server/notifications/notify';
import { getReport } from '@/server/attendance/attendance-service';
import { computeCourseResult, loadCourseTermData } from '@/server/gradebook/load';
import { isUngradedPastDue } from '@/server/gradebook/grade-calc';
import type { ReportCardPatch } from '@/lib/validators/gradebook';
import { assertCanViewReportCard, canEditHomeroomComment, canViewReportCard, reportCardNotFound } from './access';
import { buildSnapshot, snapshotSchema, type ReportCardSnapshot } from './snapshot';

/**
 * PRD-11 report cards (FR-29–FR-37, NFR-3). Snapshots are frozen: only DRAFT rows are ever
 * rewritten (FR-31, AC-8), and nothing in src/server/gradebook writes ReportCard.
 */

const CHUNK = 100;
const day = (d: Date) => d.toISOString().slice(0, 10);
const name = (u: { firstName: string; lastName: string } | null | undefined) => (u ? `${u.firstName} ${u.lastName}` : null);
const adminOnly = (user: AccessUser) => {
  if (user.role !== 'ADMIN') throw new AppError('FORBIDDEN', 'Only administrators can do this.');
};

async function loadTerm(termId: string) {
  const term = await prisma.term.findUnique({ where: { id: termId }, include: { academicYear: { select: { id: true, name: true } } } });
  if (!term) throw new AppError('NOT_FOUND', 'Term not found');
  return term;
}

// ---------------------------------------------------------------------------
// Roster (FR-29, FR-33)
// ---------------------------------------------------------------------------

export interface RosterFilters {
  termId: string;
  gradeLevelId?: string;
  sectionId?: string;
}

/** Section members in scope: ADMIN everything, TEACHER only their homeroom sections. */
async function scopedMembers(user: AccessUser, f: RosterFilters, academicYearId: string) {
  if (user.role !== 'ADMIN' && user.role !== 'TEACHER') throw new AppError('FORBIDDEN', 'You do not have permission to view report cards.');
  return prisma.sectionMember.findMany({
    where: {
      academicYearId,
      section: {
        ...(f.gradeLevelId ? { gradeLevelId: f.gradeLevelId } : {}),
        ...(f.sectionId ? { id: f.sectionId } : {}),
        ...(user.role === 'TEACHER' ? { homeroomTeacherId: user.id } : {}),
      },
      student: { status: { notIn: ['ARCHIVED'] } },
    },
    select: {
      student: { select: { id: true, firstName: true, lastName: true, studentProfile: { select: { admissionNumber: true } } } },
      section: { select: { id: true, name: true, gradeLevel: { select: { id: true, name: true } } } },
    },
    orderBy: [{ section: { name: 'asc' } }, { student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }],
  });
}

export async function listReportCards(user: AccessUser, f: RosterFilters) {
  const term = await loadTerm(f.termId);
  const members = await scopedMembers(user, f, term.academicYearId);
  const studentIds = members.map((m) => m.student.id);
  const [cards, enrollments] = await Promise.all([
    prisma.reportCard.findMany({ where: { termId: term.id, studentId: { in: studentIds } } }),
    prisma.enrollment.findMany({
      where: { studentId: { in: studentIds }, status: 'ACTIVE', course: { academicYearId: term.academicYearId } },
      select: { studentId: true, course: { select: { id: true, code: true } } },
    }),
  ]);
  const courseIds = [...new Set(enrollments.map((e) => e.course.id))];
  const data = await loadCourseTermData(courseIds, term.id, studentIds);
  const now = new Date();
  const cardBy = new Map(cards.map((c) => [c.studentId, c]));

  return members.map(({ student, section }) => {
    const warnings: { type: 'UNGRADED_ITEMS' | 'MISSING_TEACHER_COMMENT'; courseId: string; courseCode: string; count?: number }[] = [];
    for (const e of enrollments.filter((x) => x.studentId === student.id)) {
      const items = data.items.get(e.course.id) ?? [];
      const count = items.filter((i) => isUngradedPastDue(i, data.grades.get(i.id)?.get(student.id), now)).length;
      if (count) warnings.push({ type: 'UNGRADED_ITEMS', courseId: e.course.id, courseCode: e.course.code, count });
      if (!data.overrides.get(`${e.course.id}:${student.id}`)?.teacherComment) {
        warnings.push({ type: 'MISSING_TEACHER_COMMENT', courseId: e.course.id, courseCode: e.course.code });
      }
    }
    const card = cardBy.get(student.id);
    return {
      student: {
        id: student.id,
        firstName: student.firstName,
        lastName: student.lastName,
        admissionNumber: student.studentProfile?.admissionNumber ?? null,
        gradeLevel: section.gradeLevel,
        section: { id: section.id, name: section.name },
      },
      status: (card?.status ?? 'NOT_GENERATED') as 'NOT_GENERATED' | 'DRAFT' | 'PUBLISHED',
      reportCard: card
        ? {
            id: card.id,
            generatedAt: card.generatedAt.toISOString(),
            publishedAt: card.publishedAt?.toISOString() ?? null,
            hasHomeroomComment: !!card.homeroomComment,
            hasPrincipalComment: !!card.principalComment,
          }
        : null,
      warnings,
      warningText: warningText(warnings),
    };
  });
}

/** "2 courses have ungraded items", "No teacher comment for ENG-7A" (FR-29). */
export function warningText(w: { type: 'UNGRADED_ITEMS' | 'MISSING_TEACHER_COMMENT'; courseCode: string }[]): string[] {
  const ungraded = w.filter((x) => x.type === 'UNGRADED_ITEMS').length;
  const out = ungraded ? [`${ungraded} course${ungraded === 1 ? ' has' : 's have'} ungraded items`] : [];
  for (const x of w) if (x.type === 'MISSING_TEACHER_COMMENT') out.push(`No teacher comment for ${x.courseCode}`);
  return out;
}
export type RosterRow = Awaited<ReturnType<typeof listReportCards>>[number];

// ---------------------------------------------------------------------------
// Generate (FR-30, FR-31, NFR-3)
// ---------------------------------------------------------------------------

export async function generateDrafts(user: AccessUser, input: { termId: string; studentIds: string[] }, now = new Date()) {
  adminOnly(user);
  const term = await loadTerm(input.termId);
  const yearId = term.academicYearId;
  const [students, enrollments, school, existing, attendanceRows] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: input.studentIds }, role: 'STUDENT' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        studentProfile: { select: { admissionNumber: true, gradeLevel: { select: { name: true } } } },
        sectionMemberships: {
          where: { academicYearId: yearId },
          select: { section: { select: { name: true, gradeLevel: { select: { name: true } }, homeroomTeacher: { select: { firstName: true, lastName: true } } } } },
        },
      },
    }),
    prisma.enrollment.findMany({
      where: { studentId: { in: input.studentIds }, status: 'ACTIVE', course: { academicYearId: yearId } },
      select: {
        studentId: true,
        course: { select: { id: true, code: true, name: true, subject: { select: { name: true } }, teacher: { select: { firstName: true, lastName: true } } } },
      },
      orderBy: { course: { name: 'asc' } },
    }),
    prisma.schoolSettings.findUnique({ where: { id: 'singleton' }, select: { name: true, logoUrl: true } }),
    prisma.reportCard.findMany({ where: { termId: term.id, studentId: { in: input.studentIds } }, select: { id: true, studentId: true, status: true } }),
    getReport({ from: day(term.startDate), to: day(term.endDate) }),
  ]);

  const enrolledIds = new Set(enrollments.map((e) => e.studentId));
  const eligible = students.filter((s) => enrolledIds.has(s.id));
  const skippedNotEnrolled = input.studentIds.filter((id) => !eligible.some((s) => s.id === id));
  const courseIds = [...new Set(enrollments.map((e) => e.course.id))];
  const data = await loadCourseTermData(courseIds, term.id, eligible.map((s) => s.id));
  const attendance = new Map(attendanceRows.map((r) => [r.studentId, r]));
  const existingBy = new Map(existing.map((c) => [c.studentId, c]));
  const schoolRef = { name: school?.name ?? 'SchoolHub Academy', logoUrl: school?.logoUrl ?? null };
  const termRef = { name: term.name, startDate: day(term.startDate), endDate: day(term.endDate), academicYear: term.academicYear.name };
  const legend = data.defaultScale ? { name: data.defaultScale.name, bands: data.defaultScale.bands } : null;

  const toCreate: Prisma.ReportCardCreateManyInput[] = [];
  const toRefresh: { id: string; snapshot: ReportCardSnapshot }[] = [];
  let skippedPublished = 0;

  for (const s of eligible) {
    const prev = existingBy.get(s.id);
    if (prev?.status === 'PUBLISHED') {
      skippedPublished++;
      continue;
    }
    const mine = enrollments.filter((e) => e.studentId === s.id).map((e) => e.course);
    const section = s.sectionMemberships[0]?.section;
    const a = attendance.get(s.id);
    const snapshot = buildSnapshot(
      {
        name: `${s.firstName} ${s.lastName}`,
        admissionNumber: s.studentProfile?.admissionNumber ?? null,
        gradeLevel: section?.gradeLevel.name ?? s.studentProfile?.gradeLevel.name ?? '',
        section: section?.name ?? '',
        homeroomTeacher: name(section?.homeroomTeacher),
      },
      mine.map((c) => {
        const scale = data.scales.get(c.id);
        return { subject: c.subject.name, code: c.code, teacher: name(c.teacher), scale: scale ? { name: scale.name, bands: scale.bands } : null };
      }),
      mine.map((c) => computeCourseResult(data, c.id, s.id, now)),
      a ? { rate: a.rate, present: a.present, absent: a.absent, late: a.late, excused: a.excused } : null,
      schoolRef,
      termRef,
      legend,
    );
    if (prev) toRefresh.push({ id: prev.id, snapshot });
    else toCreate.push({ studentId: s.id, termId: term.id, snapshot: snapshot as unknown as Prisma.InputJsonValue, generatedAt: now });
  }

  let created = 0;
  let refreshed = 0;
  for (let i = 0; i < toCreate.length; i += CHUNK) {
    created += (await prisma.reportCard.createMany({ data: toCreate.slice(i, i + CHUNK), skipDuplicates: true })).count;
  }
  for (let i = 0; i < toRefresh.length; i += CHUNK) {
    const chunk = toRefresh.slice(i, i + CHUNK);
    // WHERE status = DRAFT: a card published meanwhile is never rewritten (FR-31).
    const counts = await prisma.$transaction(
      chunk.map((c) =>
        prisma.reportCard.updateMany({ where: { id: c.id, status: 'DRAFT' }, data: { snapshot: c.snapshot as unknown as Prisma.InputJsonValue, generatedAt: now } }),
      ),
    );
    refreshed += counts.reduce((n, r) => n + r.count, 0);
  }
  await audit({ actorId: user.id, action: 'reportCard.generate', entityType: 'Term', entityId: term.id, metadata: { created, refreshed, skippedPublished } });
  return { created, refreshed, skippedPublished, skippedNotEnrolled };
}

// ---------------------------------------------------------------------------
// One card (FR-32, FR-37)
// ---------------------------------------------------------------------------

async function loadCard(id: string) {
  const card = await prisma.reportCard.findUnique({ where: { id } });
  if (!card) throw reportCardNotFound();
  return card;
}

async function toCardDto(user: AccessUser, card: ReportCard) {
  const term = await prisma.term.findUnique({ where: { id: card.termId }, select: { academicYearId: true } });
  const homeroom = term ? await canEditHomeroomComment(user, card.studentId, term.academicYearId) : false;
  const draft = card.status === 'DRAFT';
  const family = user.role === 'STUDENT' || user.role === 'PARENT';
  return {
    id: card.id,
    studentId: card.studentId,
    termId: card.termId,
    status: card.status,
    snapshot: snapshotSchema.parse(card.snapshot),
    homeroomComment: card.homeroomComment,
    principalComment: card.principalComment,
    generatedAt: card.generatedAt.toISOString(),
    publishedAt: card.publishedAt?.toISOString() ?? null,
    publishedById: family ? null : card.publishedById,
    permissions: {
      canEditHomeroomComment: draft && homeroom,
      canEditPrincipalComment: draft && user.role === 'ADMIN',
      canPublish: user.role === 'ADMIN',
    },
  };
}
export type ReportCardDto = Awaited<ReturnType<typeof toCardDto>>;

export async function getReportCard(user: AccessUser, id: string) {
  const card = await loadCard(id);
  await assertCanViewReportCard(user, card);
  return toCardDto(user, card);
}

/** A13: DRAFT only; homeroomComment → ADMIN or homeroom teacher; principalComment → ADMIN. */
export async function patchComments(user: AccessUser, id: string, patch: ReportCardPatch, request?: Request) {
  const card = await loadCard(id);
  await assertCanViewReportCard(user, card);
  const term = await prisma.term.findUnique({ where: { id: card.termId }, select: { academicYearId: true } });
  if (patch.homeroomComment !== undefined && !(term && (await canEditHomeroomComment(user, card.studentId, term.academicYearId)))) {
    throw new AppError('FORBIDDEN', 'Only the homeroom teacher or an administrator can edit the homeroom comment.');
  }
  if (patch.principalComment !== undefined && user.role !== 'ADMIN') {
    throw new AppError('FORBIDDEN', 'Only an administrator can edit the principal comment.');
  }
  if (card.status !== 'DRAFT') throw new AppError('CONFLICT', 'Unpublish to edit.');
  const data = {
    ...(patch.homeroomComment !== undefined ? { homeroomComment: patch.homeroomComment || null } : {}),
    ...(patch.principalComment !== undefined ? { principalComment: patch.principalComment || null } : {}),
  };
  const { count } = await prisma.reportCard.updateMany({ where: { id, status: 'DRAFT' }, data });
  if (count === 0) throw new AppError('CONFLICT', 'Unpublish to edit.');
  await audit({
    actorId: user.id,
    action: 'reportCard.comment',
    entityType: 'ReportCard',
    entityId: id,
    metadata: { old: { homeroomComment: card.homeroomComment, principalComment: card.principalComment }, new: data },
    request,
  });
  return toCardDto(user, await loadCard(id));
}

// ---------------------------------------------------------------------------
// Publish / unpublish (FR-34, FR-38)
// ---------------------------------------------------------------------------

export async function publish(user: AccessUser, ids: string[], request?: Request, now = new Date()) {
  adminOnly(user);
  const drafts = await prisma.reportCard.findMany({ where: { id: { in: ids }, status: 'DRAFT' }, select: { id: true } });
  if (drafts.length) {
    await prisma.reportCard.updateMany({ where: { id: { in: drafts.map((d) => d.id) }, status: 'DRAFT' }, data: { status: 'PUBLISHED', publishedAt: now, publishedById: user.id } });
  }
  // Only rows this call flipped (a concurrent publish has a different publishedAt/by).
  const published = await prisma.reportCard.findMany({
    where: { id: { in: drafts.map((d) => d.id) }, status: 'PUBLISHED', publishedAt: now, publishedById: user.id },
    select: { id: true, studentId: true, termId: true },
  });
  const publishedIds = published.map((p) => p.id);
  if (publishedIds.length) {
    await audit({ actorId: user.id, action: 'reportCard.publish', entityType: 'ReportCard', metadata: { ids: publishedIds }, request });
    const terms = await prisma.term.findMany({ where: { id: { in: [...new Set(published.map((p) => p.termId))] } }, select: { id: true, name: true } });
    const termName = new Map(terms.map((t) => [t.id, t.name]));
    for (const p of published) {
      await notifyStudentAndParents({
        type: 'report_card.published',
        studentIds: [p.studentId],
        title: `Report card published: ${termName.get(p.termId) ?? 'term'}`,
        body: 'Your report card is ready to view and print.',
        link: `/report-cards/${p.id}/print`,
        email: { template: 'generic-notification' },
      });
    }
  }
  return { publishedIds, skippedIds: ids.filter((id) => !publishedIds.includes(id)) };
}

export async function unpublish(user: AccessUser, ids: string[], reason: string, request?: Request) {
  adminOnly(user);
  const cards = await prisma.reportCard.findMany({ where: { id: { in: ids }, status: 'PUBLISHED' } });
  const unpublishedIds: string[] = [];
  for (const c of cards) {
    const { count } = await prisma.reportCard.updateMany({ where: { id: c.id, status: 'PUBLISHED' }, data: { status: 'DRAFT', publishedAt: null, publishedById: null } });
    if (count !== 1) continue;
    unpublishedIds.push(c.id);
    await audit({
      actorId: user.id,
      action: 'reportCard.unpublish',
      entityType: 'ReportCard',
      entityId: c.id,
      metadata: {
        old: { status: 'PUBLISHED', publishedAt: c.publishedAt?.toISOString() ?? null, publishedById: c.publishedById },
        new: { status: 'DRAFT', publishedAt: null, publishedById: null },
        reason,
      },
      request,
    });
  }
  return { unpublishedIds, skippedIds: ids.filter((id) => !unpublishedIds.includes(id)) };
}

// ---------------------------------------------------------------------------
// Student tab and print (FR-35, FR-36)
// ---------------------------------------------------------------------------

/** Mode B: a student's cards across terms, newest first. STUDENT/PARENT see PUBLISHED only. */
export async function listForStudent(user: AccessUser, studentId: string, termId?: string) {
  await assertCanViewStudent(user, studentId);
  const family = user.role === 'STUDENT' || user.role === 'PARENT';
  const cards = await prisma.reportCard.findMany({
    where: { studentId, ...(termId ? { termId } : {}), ...(family ? { status: 'PUBLISHED' } : {}) },
  });
  const terms = await prisma.term.findMany({
    where: { id: { in: cards.map((c) => c.termId) } },
    select: { id: true, name: true, startDate: true, academicYear: { select: { name: true } } },
  });
  const termBy = new Map(terms.map((t) => [t.id, t]));
  return cards
    .sort((a, b) => (termBy.get(b.termId)?.startDate.getTime() ?? 0) - (termBy.get(a.termId)?.startDate.getTime() ?? 0))
    .map((c) => {
      const t = termBy.get(c.termId);
      return {
        id: c.id,
        term: { id: c.termId, name: t?.name ?? '', academicYear: t?.academicYear.name ?? '' },
        status: c.status,
        publishedAt: c.publishedAt?.toISOString() ?? null,
      };
    });
}

/** Bulk print: PUBLISHED cards for the filtered roster, in roster order. */
export async function listPrintable(user: AccessUser, f: RosterFilters) {
  const term = await loadTerm(f.termId);
  const members = await scopedMembers(user, f, term.academicYearId);
  const cards = await prisma.reportCard.findMany({ where: { termId: term.id, status: 'PUBLISHED', studentId: { in: members.map((m) => m.student.id) } } });
  const byStudent = new Map(cards.map((c) => [c.studentId, c]));
  const out = [];
  for (const m of members) {
    const c = byStudent.get(m.student.id);
    if (c && (await canViewReportCard(user, c))) out.push(await toCardDto(user, c));
  }
  return out;
}
