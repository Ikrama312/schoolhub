import { ok, parseBody, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { messagingSettingsSchema } from '@/lib/validators/messaging';
import { getSettings, putSettings } from '@/server/messaging/quiet-hours';

export const dynamic = 'force-dynamic';

/** GET/PUT /api/me/messaging-settings — quiet hours (FR-21). */
export const GET = withHandler(async () => {
  const user = await requireUser();
  return ok(await getSettings(user.id));
});

export const PUT = withHandler(async (request: Request) => {
  const user = await requireUser();
  return ok(await putSettings(user.id, await parseBody(request, messagingSettingsSchema)));
});
