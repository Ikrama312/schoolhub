import type { AudienceType, ConsentResponseValue, Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { AppError, type PaginationParams } from '@/server/http';
import { audit } from '@/server/audit';
import { assertCanViewStudent, type AccessUser } from '@/server/auth/student-access';
import { canTargetAudience } from '@/server/announcements/audience';
import { notify } from '@/server/notifications/notify';
import { toCsv } from '@/server/csv';
import type { ConsentFormInput, ConsentListQuery, ConsentResponseInput, TrackingQuery, TrackingStatus } from '@/lib/validators/consent-forms';
import { signatureMatches } from './signature';

/**
 * PRD-15 consent forms (FR-36 to FR-40). Audiences are GRADE_LEVEL / SECTION /
 * COURSE; "audience students" are resolved with the same membership rules as
 * src/server/announcements/audience.ts (grade = StudentProfile.gradeLevelId,
 * section = current-year SectionMember, course = ACTIVE enrollment).
 */

const DAY_MS = 86_400_000;
const REMIND_EVERY_MS = DAY_MS;
const DUE_REMINDER_MS = 2 * DAY_MS;
const fullName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`;
const nameSelect = { select: { id: true, firstName: true, lastName: true } } as const;
const currentYear = { academicYear: { isCurrent: true } };

type Audience = { type: AudienceType; refId: string };

// ---------------------------------------------------------------------------
// Audience membership
// ---------------------------------------------------------------------------

/** Every student in any of the audiences (any status but archived). */
async function audienceStudentIds(audiences: Audience[]): Promise<string[]> {
  const ids = (t: AudienceType) => audiences.filter((a) => a.type === t).map((a) => a.refId);
  const [grades, sections, courses] = [ids('GRADE_LEVEL'), ids('SECTION'), ids('COURSE')];
  const [p, m, e] = await Promise.all([
    grades.length ? prisma.studentProfile.findMany({ where: { gradeLevelId: { in: grades } }, select: { userId: true } }) : [],
    sections.length ? prisma.sectionMember.findMany({ where: { sectionId: { in: sections }, section: currentYear }, select: { studentId: true } }) : [],
    courses.length ? prisma.enrollment.findMany({ where: { courseId: { in: courses }, status: 'ACTIVE' }, select: { studentId: true } }) : [],
  ]);
  const all = [...new Set([...p.map((r) => r.userId), ...m.map((r) => r.studentId), ...e.map((r) => r.studentId)])];
  if (!all.length) return [];
  const live = await prisma.user.findMany({ where: { id: { in: all }, role: 'STUDENT', archivedAt: null }, select: { id: true } });
  return live.map((u) => u.id);
}

/** Group keys per student: the audience rows that would include them. */
async function keysOf(studentIds: string[]) {
  const [profiles, members, enrollments] = await Promise.all([
    prisma.studentProfile.findMany({ where: { userId: { in: studentIds } }, select: { userId: true, gradeLevelId: true } }),
    prisma.sectionMember.findMany({ where: { studentId: { in: studentIds }, section: currentYear }, select: { studentId: true, sectionId: true } }),
    prisma.enrollment.findMany({ where: { studentId: { in: studentIds }, status: 'ACTIVE' }, select: { studentId: true, courseId: true } }),
  ]);
  return new Map(
    studentIds.map((id) => [
      id,
      [
        ...profiles.filter((p) => p.userId === id).map((p) => ({ type: 'GRADE_LEVEL' as const, refId: p.gradeLevelId })),
        ...members.filter((m) => m.studentId === id).map((m) => ({ type: 'SECTION' as const, refId: m.sectionId })),
        ...enrollments.filter((e) => e.studentId === id).map((e) => ({ type: 'COURSE' as const, refId: e.courseId })),
      ],
    ]),
  );
}

const inAudience = (keys: Audience[], audiences: Audience[]) => audiences.some((a) => keys.some((k) => k.type === a.type && k.refId === a.refId));

async function parentIdsOf(studentIds: string[]): Promise<string[]> {
  if (!studentIds.length) return [];
  const links = await prisma.parentStudentLink.findMany({ where: { studentId: { in: studentIds } }, select: { parentId: true } });
  return [...new Set(links.map((l) => l.parentId))];
}

async function audienceLabels(audiences: Audience[]) {
  const ids = (t: AudienceType) => audiences.filter((a) => a.type === t).map((a) => a.refId);
  const [g, s, c] = await Promise.all([
    prisma.gradeLevel.findMany({ where: { id: { in: ids('GRADE_LEVEL') } }, select: { id: true, name: true } }),
    prisma.section.findMany({ where: { id: { in: ids('SECTION') } }, select: { id: true, name: true } }),
    prisma.course.findMany({ where: { id: { in: ids('COURSE') } }, select: { id: true, name: true } }),
  ]);
  const names = new Map([...g, ...s, ...c].map((x) => [x.id, x.name]));
  return (a: Audience) => names.get(a.refId) ?? a.refId;
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

const formInclude = {
  audiences: { select: { type: true, refId: true } },
  createdBy: nameSelect,
  event: { select: { id: true, title: true, startAt: true } },
} satisfies Prisma.ConsentFormInclude;
type FormRow = Prisma.ConsentFormGetPayload<{ include: typeof formInclude }>;

const isOwnerOrAdmin = (user: AccessUser, form: { createdById: string }) => user.role === 'ADMIN' || form.createdById === user.id;

/** FR-39: creator or ADMIN; others who can see the form get 403 NOT_FORM_OWNER. */
export function assertConsentOwnerOrAdmin(user: AccessUser, form: { createdById: string }): void {
  if (!isOwnerOrAdmin(user, form)) throw new AppError('FORBIDDEN', 'Only the form creator or an administrator can do this.', { reason: 'NOT_FORM_OWNER' });
}

/** The parent's linked children that are in the form's audience. */
async function audienceChildren(parentId: string, audiences: Audience[], onlyStudentId?: string) {
  const links = await prisma.parentStudentLink.findMany({
    where: { parentId, ...(onlyStudentId ? { studentId: onlyStudentId } : {}) },
    select: { student: nameSelect },
    orderBy: { student: { firstName: 'asc' } },
  });
  const keys = await keysOf(links.map((l) => l.student.id));
  return links.map((l) => l.student).filter((s) => inAudience(keys.get(s.id) ?? [], audiences));
}

/** 404 unless creator, ADMIN or a parent of an audience child (NFR-5). */
async function loadForm(user: AccessUser, id: string): Promise<FormRow> {
  const form = await prisma.consentForm.findUnique({ where: { id }, include: formInclude });
  if (!form) throw new AppError('NOT_FOUND', 'Resource not found');
  if (isOwnerOrAdmin(user, form)) return form;
  if (user.role === 'PARENT' && (await audienceChildren(user.id, form.audiences)).length) return form;
  throw new AppError('NOT_FOUND', 'Resource not found');
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

async function serialize(user: AccessUser, form: FormRow, opts: { studentId?: string } = {}) {
  const label = await audienceLabels(form.audiences);
  const base = {
    id: form.id,
    title: form.title,
    description: form.description,
    dueAt: form.dueAt.toISOString(),
    event: form.event ? { id: form.event.id, title: form.event.title, startsAt: form.event.startAt.toISOString() } : null,
    audiences: form.audiences.map((a) => ({ type: a.type, refId: a.refId, label: label(a) })),
    createdBy: { id: form.createdBy.id, name: fullName(form.createdBy) },
  };
  if (user.role === 'PARENT') {
    const kids = await audienceChildren(user.id, form.audiences, opts.studentId);
    const responses = await prisma.consentResponse.findMany({
      where: { formId: form.id, studentId: { in: kids.map((k) => k.id) } },
      include: { respondedBy: nameSelect },
    });
    return {
      ...base,
      children: kids.map((k) => {
        const r = responses.find((x) => x.studentId === k.id);
        return {
          studentId: k.id,
          firstName: k.firstName,
          response: r
            ? { value: r.value, respondedBy: { id: r.respondedBy.id, name: fullName(r.respondedBy) }, comment: r.comment, updatedAt: r.updatedAt.toISOString() }
            : null,
        };
      }),
    };
  }
  if (!isOwnerOrAdmin(user, form)) return base;
  const students = await audienceStudentIds(form.audiences);
  const responses = await prisma.consentResponse.groupBy({ by: ['value'], where: { formId: form.id, studentId: { in: students } }, _count: { _all: true } });
  const n = (v: ConsentResponseValue) => responses.find((r) => r.value === v)?._count._all ?? 0;
  return {
    ...base,
    lastRemindedAt: form.lastRemindedAt?.toISOString() ?? null,
    counts: { granted: n('GRANTED'), declined: n('DECLINED'), noResponse: students.length - n('GRANTED') - n('DECLINED') },
  };
}

export type ConsentFormDto = Awaited<ReturnType<typeof serialize>>;

// ---------------------------------------------------------------------------
// Create / list / get (FR-36, FR-37)
// ---------------------------------------------------------------------------

export async function create(user: AccessUser, input: ConsentFormInput, request?: Request) {
  if (user.role !== 'ADMIN' && user.role !== 'TEACHER') throw new AppError('FORBIDDEN', 'You cannot create consent forms.');
  for (const a of input.audiences) {
    const allowed = (user.role === 'ADMIN' || a.type === 'COURSE') && (await canTargetAudience(user, a));
    if (!allowed) throw new AppError('FORBIDDEN', 'You cannot send a form to that audience.', { reason: 'AUDIENCE_NOT_ALLOWED', audience: a });
  }
  if (input.eventId && !(await prisma.calendarEvent.findUnique({ where: { id: input.eventId }, select: { id: true } }))) {
    throw new AppError('VALIDATION_ERROR', 'Linked event not found.', { fieldErrors: { eventId: ['Linked event not found'] } });
  }
  const form = await prisma.consentForm.create({
    data: {
      title: input.title,
      description: input.description,
      dueAt: new Date(input.dueAt),
      eventId: input.eventId,
      createdById: user.id,
      audiences: { create: input.audiences.map((a) => ({ type: a.type, refId: a.refId })) },
    },
    include: formInclude,
  });
  await audit({ actorId: user.id, action: 'consent_form.create', entityType: 'ConsentForm', entityId: form.id, metadata: { title: input.title, audiences: input.audiences }, request });

  const parents = await parentIdsOf(await audienceStudentIds(form.audiences));
  await notify({
    type: 'consent.requested',
    userIds: parents,
    title: `Consent needed: ${form.title}`,
    body: `Please respond by ${form.dueAt.toISOString().slice(0, 10)}.`,
    link: `/consent-forms/${form.id}`,
    email: { template: 'generic-notification' },
  });
  return { ...(await serialize(user, form)), notifiedParents: parents.length };
}

export async function list(user: AccessUser, query: ConsentListQuery, page: PaginationParams) {
  const orderBy = [{ [query.sort.field]: query.sort.dir }, { id: 'asc' as const }];
  const q = query.q ? { title: { contains: query.q, mode: 'insensitive' as const } } : {};

  if (user.role === 'PARENT') {
    const links = await prisma.parentStudentLink.findMany({ where: { parentId: user.id, ...(query.studentId ? { studentId: query.studentId } : {}) }, select: { studentId: true } });
    if (query.studentId && links.length === 0) throw new AppError('NOT_FOUND', 'Resource not found');
    const keys = [...(await keysOf(links.map((l) => l.studentId))).values()].flat();
    if (!keys.length) return { rows: [], meta: { page: page.page, pageSize: page.pageSize, total: 0 } };
    // ponytail: parent-visible forms are filtered/paginated in memory (a family sees few forms); push into SQL if that grows.
    const forms = await prisma.consentForm.findMany({ where: { ...q, audiences: { some: { OR: keys } } }, include: formInclude, orderBy });
    let rows = await Promise.all(forms.map((f) => serialize(user, f, { studentId: query.studentId })));
    if (query.pending) {
      const now = Date.now();
      rows = rows.filter((r) => Date.parse(r.dueAt) > now && 'children' in r && r.children.some((c) => !c.response));
    }
    return { rows: rows.slice(page.skip, page.skip + page.take), meta: { page: page.page, pageSize: page.pageSize, total: rows.length } };
  }

  if (user.role !== 'ADMIN' && user.role !== 'TEACHER') throw new AppError('FORBIDDEN', 'You cannot view consent forms.');
  const where: Prisma.ConsentFormWhereInput = { ...q, ...(user.role === 'TEACHER' ? { createdById: user.id } : {}) };
  const [forms, total] = await Promise.all([
    prisma.consentForm.findMany({ where, include: formInclude, orderBy, skip: page.skip, take: page.take }),
    prisma.consentForm.count({ where }),
  ]);
  return { rows: await Promise.all(forms.map((f) => serialize(user, f))), meta: { page: page.page, pageSize: page.pageSize, total } };
}

export async function get(user: AccessUser, id: string) {
  return serialize(user, await loadForm(user, id));
}

// ---------------------------------------------------------------------------
// Respond (FR-37, FR-38)
// ---------------------------------------------------------------------------

export async function respond(user: AccessUser, id: string, input: ConsentResponseInput, request?: Request) {
  if (user.role !== 'PARENT') throw new AppError('FORBIDDEN', 'Only parents can respond to consent forms.');
  await assertCanViewStudent(user, input.studentId);
  const form = await loadForm(user, id);
  if (!(await audienceChildren(user.id, form.audiences, input.studentId)).length) throw new AppError('NOT_FOUND', 'Resource not found');
  if (Date.now() >= form.dueAt.getTime()) throw new AppError('VALIDATION_ERROR', 'This form is past its due date.', { reason: 'PAST_DUE' });

  const me = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { firstName: true, lastName: true } });
  if (!signatureMatches(input.signature, fullName(me))) {
    throw new AppError('VALIDATION_ERROR', 'Your signature must match your full name.', {
      reason: 'SIGNATURE_MISMATCH',
      fieldErrors: { signature: [`Type your full name: ${fullName(me)}`] },
    });
  }

  const key = { formId_studentId: { formId: id, studentId: input.studentId } };
  const before = await prisma.consentResponse.findUnique({ where: key });
  const data = { respondedById: user.id, value: input.value, signature: input.signature.trim(), comment: input.comment || null };
  const after = await prisma.consentResponse.upsert({
    where: key,
    create: { formId: id, studentId: input.studentId, ...data },
    update: data,
    include: { respondedBy: nameSelect },
  });
  const snap = (r: { value: string; comment: string | null; respondedById: string } | null) => (r ? { value: r.value, comment: r.comment, respondedById: r.respondedById } : null);
  await audit({
    actorId: user.id,
    action: before ? 'consent_response.update' : 'consent_response.create',
    entityType: 'ConsentForm',
    entityId: id,
    metadata: { studentId: input.studentId, before: snap(before), after: snap(after) },
    request,
  });
  return {
    formId: id,
    studentId: input.studentId,
    value: after.value,
    respondedBy: { id: after.respondedBy.id, name: fullName(after.respondedBy) },
    comment: after.comment,
    updatedAt: after.updatedAt.toISOString(),
    changed: before !== null,
  };
}

// ---------------------------------------------------------------------------
// Tracking + reminders (FR-39, FR-40)
// ---------------------------------------------------------------------------

async function trackingRows(formId: string, audiences: Audience[]) {
  const studentIds = await audienceStudentIds(audiences);
  const [students, responses] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: studentIds } },
      select: { id: true, firstName: true, lastName: true, sectionMemberships: { where: { section: currentYear }, select: { section: { select: { name: true } } } } },
    }),
    prisma.consentResponse.findMany({ where: { formId, studentId: { in: studentIds } }, include: { respondedBy: nameSelect } }),
  ]);
  return students.map((s) => {
    const r = responses.find((x) => x.studentId === s.id);
    return {
      student: { id: s.id, firstName: s.firstName, lastName: s.lastName, sectionName: s.sectionMemberships[0]?.section.name ?? null },
      status: (r?.value ?? 'NO_RESPONSE') as TrackingStatus,
      respondedBy: r ? { id: r.respondedBy.id, name: fullName(r.respondedBy) } : null,
      respondedAt: r?.updatedAt.toISOString() ?? null,
      comment: r?.comment ?? null,
    };
  });
}

export type TrackingRow = Awaited<ReturnType<typeof trackingRows>>[number];

export async function tracking(user: AccessUser, id: string, query: TrackingQuery, page: PaginationParams) {
  const form = await loadForm(user, id);
  assertConsentOwnerOrAdmin(user, form);
  const all = await trackingRows(id, form.audiences);
  const counts = {
    granted: all.filter((r) => r.status === 'GRANTED').length,
    declined: all.filter((r) => r.status === 'DECLINED').length,
    noResponse: all.filter((r) => r.status === 'NO_RESPONSE').length,
  };
  const q = query.q?.toLowerCase();
  const name = (r: TrackingRow) => `${r.student.lastName} ${r.student.firstName}`;
  const key = (r: TrackingRow) => (query.sort.field === 'status' ? r.status : query.sort.field === 'respondedAt' ? (r.respondedAt ?? '') : name(r).toLowerCase());
  const rows = all
    .filter((r) => (!query.status || r.status === query.status) && (!q || `${r.student.firstName} ${r.student.lastName}`.toLowerCase().includes(q)))
    .sort((a, b) => key(a).localeCompare(key(b)) * (query.sort.dir === 'asc' ? 1 : -1) || name(a).localeCompare(name(b)));

  if (query.format === 'csv') {
    const csv = toCsv(
      [
        { key: 'student', header: 'Student' },
        { key: 'section', header: 'Section' },
        { key: 'status', header: 'Status' },
        { key: 'respondedBy', header: 'Responded by' },
        { key: 'respondedAt', header: 'Responded at' },
        { key: 'comment', header: 'Comment' },
      ],
      rows.map((r) => ({
        student: `${r.student.firstName} ${r.student.lastName}`,
        section: r.student.sectionName ?? '',
        status: r.status === 'NO_RESPONSE' ? 'No response' : r.status === 'GRANTED' ? 'Granted' : 'Declined',
        respondedBy: r.respondedBy?.name ?? '',
        respondedAt: r.respondedAt ?? '',
        comment: r.comment ?? '',
      })),
    );
    return { csv, title: form.title };
  }
  return { rows: rows.slice(page.skip, page.skip + page.take), meta: { page: page.page, pageSize: page.pageSize, total: rows.length, counts } };
}

async function notifyNonResponders(form: { id: string; title: string; dueAt: Date; audiences: Audience[] }) {
  const students = await audienceStudentIds(form.audiences);
  const answered = new Set(
    (await prisma.consentResponse.findMany({ where: { formId: form.id, studentId: { in: students } }, select: { studentId: true } })).map((r) => r.studentId),
  );
  const parents = await parentIdsOf(students.filter((s) => !answered.has(s)));
  await notify({
    type: 'consent.reminder',
    userIds: parents,
    title: `Reminder: ${form.title}`,
    body: `Please respond by ${form.dueAt.toISOString().slice(0, 10)}.`,
    link: `/consent-forms/${form.id}`,
    email: { template: 'generic-notification' },
  });
  return parents.length;
}

export async function remind(user: AccessUser, id: string, request?: Request) {
  const form = await loadForm(user, id);
  assertConsentOwnerOrAdmin(user, form);
  const now = new Date();
  if (now >= form.dueAt) throw new AppError('VALIDATION_ERROR', 'This form is past its due date.', { reason: 'PAST_DUE' });
  const claimed = await prisma.consentForm.updateMany({
    where: { id, OR: [{ lastRemindedAt: null }, { lastRemindedAt: { lt: new Date(now.getTime() - REMIND_EVERY_MS) } }] },
    data: { lastRemindedAt: now },
  });
  if (claimed.count === 0) {
    const last = (await prisma.consentForm.findUnique({ where: { id }, select: { lastRemindedAt: true } }))?.lastRemindedAt ?? now;
    const retryAfterMs = Math.max(0, last.getTime() + REMIND_EVERY_MS - now.getTime());
    throw new AppError('RATE_LIMITED', 'Reminders can be sent once every 24 hours.', { retryAfterMs });
  }
  const notifiedParents = await notifyNonResponders(form);
  await audit({ actorId: user.id, action: 'consent_form.remind', entityType: 'ConsentForm', entityId: id, metadata: { notifiedParents }, request });
  return { notifiedParents, remindedAt: now.toISOString() };
}

/** FR-40 cron: forms due in (now, now+48h] get one automatic reminder, claimed via dueReminderSentAt. */
export async function sendConsentDueReminders(now: Date): Promise<{ forms: number; notified: number }> {
  const due = await prisma.consentForm.findMany({
    where: { dueReminderSentAt: null, dueAt: { gt: now, lte: new Date(now.getTime() + DUE_REMINDER_MS) } },
    include: { audiences: { select: { type: true, refId: true } } },
  });
  let forms = 0;
  let notified = 0;
  for (const form of due) {
    const claimed = await prisma.consentForm.updateMany({ where: { id: form.id, dueReminderSentAt: null }, data: { dueReminderSentAt: now } });
    if (claimed.count === 0) continue;
    forms += 1;
    notified += await notifyNonResponders(form);
  }
  return { forms, notified };
}
