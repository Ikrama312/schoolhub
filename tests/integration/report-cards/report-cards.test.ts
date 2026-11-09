// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DATABASE_URL ??= 'postgresql://unused@localhost/unused';
  process.env.APP_URL ??= 'http://localhost:3000';
  process.env.AUTH_SECRET ??= 'test-secret';
});

import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import { createManualItem, putGrade, putTermOverride } from '@/server/gradebook/gradebook-service';
import {
  generateDrafts,
  getReportCard,
  listForStudent,
  listReportCards,
  patchComments,
  publish,
  unpublish,
} from '@/server/report-cards/report-card-service';

/**
 * PRD-11 report cards (FR-29–FR-37, AC-7, AC-8, NFR-4) against a real, migrated Postgres.
 * Fixtures tagged with MARK and removed afterwards. Skipped without TEST_DATABASE_URL.
 */
const MARK = 'qa-sh11-rc';
const DAY = 86_400_000;
const ids = {} as Record<
  'year' | 'term' | 'level' | 'secA' | 'secB' | 'subject' | 'course' | 'admin' | 'teacher' | 'homeroom' | 'sam' | 'pat' | 'other' | 'item' | 'card',
  string
>;
const as = (id: string, role: 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT') => ({ id, role });
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function code(p: Promise<unknown>) {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return e instanceof AppError ? e.code : (e as Error).message;
  }
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('report cards (integration)', () => {
  beforeAll(async () => {
    const mk = (n: string, role: 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT') =>
      prisma.user.create({ data: { email: `${n}@${MARK}.test`, firstName: n, lastName: MARK, role, status: 'ACTIVE' } }).then((u) => u.id);
    Object.assign(ids, {
      admin: await mk('admin', 'ADMIN'),
      teacher: await mk('teacher', 'TEACHER'),
      homeroom: await mk('homeroom', 'TEACHER'),
      sam: await mk('Sam', 'STUDENT'),
      pat: await mk('Pat', 'PARENT'),
      other: await mk('Other', 'STUDENT'),
    });
    await prisma.parentStudentLink.create({ data: { parentId: ids.pat, studentId: ids.sam, relationship: 'MOTHER', isPrimary: true } });
    const now = Date.now();
    ids.year = (await prisma.academicYear.create({ data: { name: MARK, startDate: new Date(isoDay(now - 200 * DAY)), endDate: new Date(isoDay(now + 200 * DAY)) } })).id;
    ids.term = (await prisma.term.create({ data: { academicYearId: ids.year, name: 'S1', order: 1, startDate: new Date(isoDay(now - 100 * DAY)), endDate: new Date(isoDay(now + 100 * DAY)) } })).id;
    ids.level = (await prisma.gradeLevel.create({ data: { name: MARK, shortName: MARK, order: 900_000 + Math.floor(Math.random() * 90_000) } })).id;
    ids.secA = (await prisma.section.create({ data: { name: `${MARK}-7A`, academicYearId: ids.year, gradeLevelId: ids.level, homeroomTeacherId: ids.homeroom } })).id;
    ids.secB = (await prisma.section.create({ data: { name: `${MARK}-7B`, academicYearId: ids.year, gradeLevelId: ids.level } })).id;
    await prisma.sectionMember.createMany({
      data: [
        { sectionId: ids.secA, studentId: ids.sam, academicYearId: ids.year },
        { sectionId: ids.secB, studentId: ids.other, academicYearId: ids.year },
      ],
    });
    ids.subject = (await prisma.subject.create({ data: { name: MARK, code: MARK.toUpperCase() } })).id;
    ids.course = (await prisma.course.create({ data: { name: MARK, code: MARK, academicYearId: ids.year, subjectId: ids.subject, teacherId: ids.teacher } })).id;
    await prisma.enrollment.createMany({ data: [ids.sam, ids.other].map((studentId) => ({ courseId: ids.course, studentId })) });
    ids.item = (await createManualItem(as(ids.teacher, 'TEACHER'), ids.course, { title: 'Oral', maxPoints: '10.00', termId: ids.term })).id;
    await putGrade(as(ids.teacher, 'TEACHER'), ids.item, ids.sam, { score: '8.00' });
    await putTermOverride(as(ids.teacher, 'TEACHER'), ids.course, ids.sam, { termId: ids.term, teacherComment: 'Great work' });
  });

  afterAll(async () => {
    const users = [ids.admin, ids.teacher, ids.homeroom, ids.sam, ids.pat, ids.other].filter(Boolean);
    await prisma.reportCard.deleteMany({ where: { studentId: { in: users } } });
    await prisma.termGradeOverride.deleteMany({ where: { courseId: ids.course } });
    await prisma.course.deleteMany({ where: { code: MARK } });
    await prisma.sectionMember.deleteMany({ where: { academicYearId: ids.year } });
    await prisma.section.deleteMany({ where: { academicYearId: ids.year } });
    await prisma.term.deleteMany({ where: { academicYearId: ids.year } });
    await prisma.gradeLevel.deleteMany({ where: { name: MARK } });
    await prisma.notification.deleteMany({ where: { userId: { in: users } } });
    await prisma.emailOutbox.deleteMany({ where: { toEmail: { endsWith: `@${MARK}.test` } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.subject.deleteMany({ where: { code: MARK.toUpperCase() } });
    await prisma.academicYear.deleteMany({ where: { name: MARK } });
  });

  it('generates a draft snapshot; roster shows status and warnings', async () => {
    const res = await generateDrafts(as(ids.admin, 'ADMIN'), { termId: ids.term, studentIds: [ids.sam, ids.pat] });
    expect(res).toMatchObject({ created: 1, refreshed: 0, skippedPublished: 0, skippedNotEnrolled: [ids.pat] });
    const card = await prisma.reportCard.findUniqueOrThrow({ where: { studentId_termId: { studentId: ids.sam, termId: ids.term } } });
    ids.card = card.id;
    const dto = await getReportCard(as(ids.admin, 'ADMIN'), card.id);
    expect(dto.snapshot.courses).toEqual([expect.objectContaining({ code: MARK, percent: '80.0', teacherComment: 'Great work' })]);
    expect(dto.snapshot.student).toMatchObject({ name: `Sam ${MARK}`, section: `${MARK}-7A`, homeroomTeacher: `homeroom ${MARK}` });

    const roster = await listReportCards(as(ids.admin, 'ADMIN'), { termId: ids.term, gradeLevelId: ids.level });
    expect(roster.map((r) => [r.student.id, r.status])).toEqual([
      [ids.sam, 'DRAFT'],
      [ids.other, 'NOT_GENERATED'],
    ]);
    expect(roster[1].warnings).toContainEqual(expect.objectContaining({ type: 'MISSING_TEACHER_COMMENT', courseCode: MARK }));
    // Homeroom teacher sees only their section.
    const mine = await listReportCards(as(ids.homeroom, 'TEACHER'), { termId: ids.term });
    expect(mine.map((r) => r.student.id)).toEqual([ids.sam]);
  });

  it('drafts are hidden from family; comments follow field-level rules', async () => {
    expect(await code(getReportCard(as(ids.sam, 'STUDENT'), ids.card))).toBe('NOT_FOUND');
    expect(await listForStudent(as(ids.pat, 'PARENT'), ids.sam)).toEqual([]);
    await patchComments(as(ids.homeroom, 'TEACHER'), ids.card, { homeroomComment: 'Kind and focused' });
    expect(await code(patchComments(as(ids.homeroom, 'TEACHER'), ids.card, { principalComment: 'x' }))).toBe('FORBIDDEN');
    expect(await code(patchComments(as(ids.teacher, 'TEACHER'), ids.card, { homeroomComment: 'x' }))).toBe('FORBIDDEN');
    const dto = await getReportCard(as(ids.teacher, 'TEACHER'), ids.card);
    expect(dto).toMatchObject({ homeroomComment: 'Kind and focused', permissions: { canEditHomeroomComment: false, canEditPrincipalComment: false } });
  });

  it('AC-7: publish notifies Sam and Pat; a 7B student gets NOT_FOUND', async () => {
    const res = await publish(as(ids.admin, 'ADMIN'), [ids.card, 'nope']);
    expect(res).toEqual({ publishedIds: [ids.card], skippedIds: ['nope'] });
    const notes = await prisma.notification.findMany({ where: { type: 'report_card.published', userId: { in: [ids.sam, ids.pat] } } });
    expect(notes.map((n) => n.userId).sort()).toEqual([ids.sam, ids.pat].sort());
    expect((await getReportCard(as(ids.pat, 'PARENT'), ids.card)).publishedById).toBeNull();
    expect((await getReportCard(as(ids.sam, 'STUDENT'), ids.card)).status).toBe('PUBLISHED');
    expect(await code(getReportCard(as(ids.other, 'STUDENT'), ids.card))).toBe('NOT_FOUND');
    expect(await listForStudent(as(ids.pat, 'PARENT'), ids.sam)).toHaveLength(1);
    expect(await code(patchComments(as(ids.admin, 'ADMIN'), ids.card, { principalComment: 'late' }))).toBe('CONFLICT');
  });

  it('AC-8: a grade change after publish never touches the snapshot; regeneration skips PUBLISHED', async () => {
    const before = (await prisma.reportCard.findUniqueOrThrow({ where: { id: ids.card } })).snapshot;
    await putGrade(as(ids.teacher, 'TEACHER'), ids.item, ids.sam, { score: '2.00' });
    const res = await generateDrafts(as(ids.admin, 'ADMIN'), { termId: ids.term, studentIds: [ids.sam] });
    expect(res).toMatchObject({ created: 0, refreshed: 0, skippedPublished: 1 });
    expect((await prisma.reportCard.findUniqueOrThrow({ where: { id: ids.card } })).snapshot).toEqual(before);
  });

  it('unpublish returns to DRAFT with an audited reason; regenerate then refreshes and keeps comments', async () => {
    const res = await unpublish(as(ids.admin, 'ADMIN'), [ids.card], 'Wrong grade');
    expect(res.unpublishedIds).toEqual([ids.card]);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'reportCard.unpublish', entityId: ids.card } });
    expect(log.metadata).toMatchObject({ reason: 'Wrong grade', old: { status: 'PUBLISHED' }, new: { status: 'DRAFT' } });
    expect(await prisma.reportCard.findUniqueOrThrow({ where: { id: ids.card } })).toMatchObject({ status: 'DRAFT', publishedAt: null, publishedById: null });

    expect(await generateDrafts(as(ids.admin, 'ADMIN'), { termId: ids.term, studentIds: [ids.sam] })).toMatchObject({ refreshed: 1 });
    const dto = await getReportCard(as(ids.admin, 'ADMIN'), ids.card);
    expect(dto.snapshot.courses[0].percent).toBe('20.0');
    expect(dto.homeroomComment).toBe('Kind and focused');
  });
});
