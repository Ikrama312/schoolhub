import { prisma } from '@/server/db';
import { requirePageUser } from '@/server/auth/requireRole';
import { AppShell } from './shell';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  const settings = await prisma.schoolSettings.findUnique({ where: { id: 'singleton' } });

  return (
    <AppShell
      user={{ id: user.id, role: user.role, firstName: user.firstName, lastName: user.lastName, email: user.email }}
      schoolShortName={settings?.shortName ?? 'SchoolHub'}
    >
      {children}
    </AppShell>
  );
}
