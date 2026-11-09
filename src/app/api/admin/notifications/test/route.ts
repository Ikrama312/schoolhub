import { ok, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { notify } from '@/server/notifications/notify';

/** POST /api/admin/notifications/test — notify the calling admin (FR-33). notify() never throws. */
export const POST = withHandler(async () => {
  const me = await requireRole('ADMIN');
  await notify({
    type: 'system.test',
    userIds: [me.id],
    title: 'Test notification',
    body: 'This is a test notification sent from the email log page.',
    link: '/dashboard',
    email: { template: 'generic-notification' },
  });
  return ok({ ok: true as const });
});
