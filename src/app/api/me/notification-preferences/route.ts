import { ok, parseBody, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { updatePreferenceBody } from '@/lib/validators/notifications';
import { getPreferencesFor, updatePreference } from '@/server/notifications/preferences';

export const dynamic = 'force-dynamic';

/** GET/PUT /api/me/notification-preferences (FR-37, FR-38). */
export const GET = withHandler(async () => {
  const me = await requireUser();
  return ok(await getPreferencesFor(me));
});

export const PUT = withHandler(async (request: Request) => {
  const me = await requireUser();
  const body = await parseBody(request, updatePreferenceBody);
  return ok(await updatePreference(me, body));
});
