import { prisma } from '@/server/db';
import { requirePageRole } from '@/server/auth/requireRole';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { ConsentFormForm, type AudienceOptions } from './ConsentFormForm';

/** /consent-forms/new — ADMIN (any grade/section/course) or TEACHER (managed courses) (FR-36). */
export default async function NewConsentFormPage() {
  const user = await requirePageRole('ADMIN', 'TEACHER');
  const admin = user.role === 'ADMIN';
  const current = { academicYear: { isCurrent: true } };
  const [grades, sections, courses, events] = await Promise.all([
    admin ? prisma.gradeLevel.findMany({ where: { archivedAt: null }, orderBy: { order: 'asc' }, select: { id: true, name: true } }) : [],
    admin ? prisma.section.findMany({ where: current, orderBy: { name: 'asc' }, select: { id: true, name: true } }) : [],
    prisma.course.findMany({
      where: { ...current, archivedAt: null, ...(admin ? {} : { OR: [{ teacherId: user.id }, { coTeacherIds: { has: user.id } }] }) },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, section: { select: { name: true } } },
    }),
    prisma.calendarEvent.findMany({ where: { startAt: { gte: new Date() } }, orderBy: { startAt: 'asc' }, take: 200, select: { id: true, title: true, startAt: true } }),
  ]);
  const options: AudienceOptions = {
    GRADE_LEVEL: grades.map((g) => ({ id: g.id, label: g.name })),
    SECTION: sections.map((s) => ({ id: s.id, label: s.name })),
    COURSE: courses.map((c) => ({ id: c.id, label: c.section ? `${c.name} (${c.section.name})` : c.name })),
  };
  return (
    <>
      <PageHeader title="New consent form" breadcrumbs={[{ label: 'Consent forms', href: '/consent-forms' }, { label: 'New' }]} />
      <ConsentFormForm
        audienceOptions={options}
        allowedTypes={admin ? ['GRADE_LEVEL', 'SECTION', 'COURSE'] : ['COURSE']}
        events={events.map((e) => ({ id: e.id, label: `${e.title} (${e.startAt.toISOString().slice(0, 10)})` }))}
      />
    </>
  );
}
