import { prisma } from '@/server/db';
import { requirePageUser } from '@/server/auth/requireRole';
import { getSelectedChild, listLinkedChildren } from '@/server/parent/selected-child';
import { AppShell } from './shell';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  const [settings, me] = await Promise.all([
    prisma.schoolSettings.findUnique({ where: { id: 'singleton' } }),
    // PRD-13 FR-23: fresh DB read so the Safeguarding nav entry follows the flag immediately.
    prisma.user.findUnique({ where: { id: user.id }, select: { isSafeguardingLead: true } }),
  ]);
  // PRD-15: homeroom flag (FR-42) and the parent child context (FR-3, FR-6).
  const [homeroomCount, linkedChildren, selected] = await Promise.all([
    user.role === 'TEACHER'
      ? prisma.section.count({ where: { homeroomTeacherId: user.id, academicYear: { isCurrent: true } } })
      : Promise.resolve(0),
    user.role === 'PARENT' ? listLinkedChildren(user.id) : Promise.resolve([]),
    getSelectedChild(user),
  ]);

  return (
    <AppShell
      user={{ id: user.id, role: user.role, firstName: user.firstName, lastName: user.lastName, email: user.email }}
      schoolShortName={settings?.shortName ?? 'SchoolHub'}
      safeguardingLead={user.role === 'ADMIN' && !!me?.isSafeguardingLead}
      homeroom={homeroomCount > 0}
      linkedChildren={linkedChildren}
      selectedChildId={selected?.studentId ?? null}
    >
      {children}
    </AppShell>
  );
}
