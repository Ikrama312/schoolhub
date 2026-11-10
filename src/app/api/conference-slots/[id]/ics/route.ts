import { withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { slotIcs } from '@/server/conferences/conferences-service';

/** GET /api/conference-slots/:id/ics — booking parent, slot teacher or ADMIN (FR-33). */
export const GET = withHandler(async (_request: Request, { params }: { params: { id: string } }) => {
  const user = await requireRole('PARENT', 'TEACHER', 'ADMIN');
  const body = await slotIcs(user, params.id);
  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="conference-${params.id}.ics"`,
      'Cache-Control': 'private, no-store',
    },
  });
});
