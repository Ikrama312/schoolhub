import { z } from 'zod';
import { ok, parseQuery, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { getOverview, OVERVIEW_CARDS, type OverviewCard } from '@/server/parent/overview-service';

const query = z.object({
  cards: z
    .string()
    .optional()
    .transform((s, ctx) => {
      if (!s) return [...OVERVIEW_CARDS];
      const list = [...new Set(s.split(',').map((x) => x.trim()).filter(Boolean))];
      const bad = list.filter((c) => !(OVERVIEW_CARDS as readonly string[]).includes(c));
      if (bad.length) {
        ctx.addIssue({ code: 'custom', message: `Unknown card: ${bad.join(', ')}` });
        return z.NEVER;
      }
      return list as OverviewCard[];
    }),
});

/** GET /api/students/:id/overview[?cards=] — assertCanViewStudent (FR-9 to FR-17). */
export const GET = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  const { cards } = parseQuery(new URL(request.url).searchParams, query);
  return ok(await getOverview(user, params.id, cards));
});
