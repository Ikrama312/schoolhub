import { ok, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { audit } from '@/server/audit';
import { ALL_TAGS, revalidateTags } from '@/server/dashboards/insights';
import { recomputeRiskSnapshots } from '@/server/dashboards/risk';

export const dynamic = 'force-dynamic';

/** POST /api/dashboard/refresh — force the risk recompute and drop every dashboard cache (FR-24, FR-27). */
export const POST = withHandler(async (request: Request) => {
  const user = await requireRole('ADMIN');
  const result = await recomputeRiskSnapshots({ force: true });
  revalidateTags(...ALL_TAGS);
  await audit({ actorId: user.id, action: 'dashboard.refresh', metadata: { ...result }, request });
  return ok({
    refreshedAt: new Date().toISOString(),
    studentsComputed: result.studentsComputed,
    skipped: result.skipped === 'no-term' ? 'no-term' : null,
  });
});
