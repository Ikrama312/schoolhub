import { requirePageRole } from '@/server/auth/requireRole';
import { prisma } from '@/server/db';
import { EmailLogTable } from './EmailLogTable';

export const dynamic = 'force-dynamic';

/** /admin/email-log — PRD-04 FR-31..33. */
export default async function EmailLogPage() {
  await requirePageRole('ADMIN');
  const settings = await prisma.schoolSettings.findUnique({ where: { id: 'singleton' }, select: { timezone: true } });
  return <EmailLogTable timezone={settings?.timezone ?? 'UTC'} />;
}
