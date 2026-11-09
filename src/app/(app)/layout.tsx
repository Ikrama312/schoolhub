import { prisma } from '@/server/db';
import { requirePageUser } from '@/server/auth/requireRole';
import { AppShell } from './shell';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  const [settings, me] = await Promise.all([
    prisma.schoolSettings.findUnique({ where: { id: 'singleton' } }),
    // PRD-13 FR-23: fresh DB read so the Safeguarding nav entry follows the flag immediately.
    prisma.user.findUnique({ where: { id: user.id }, select: { isSafeguardingLead: true } }),
  ]);

  return (
    <AppShell
      user={{ id: user.id, role: user.role, firstName: user.firstName, lastName: user.lastName, email: user.email }}
      schoolShortName={settings?.shortName ?? 'SchoolHub'}
      safeguardingLead={user.role === 'ADMIN' && !!me?.isSafeguardingLead}
    >
      {children}
    </AppShell>
  );
}
