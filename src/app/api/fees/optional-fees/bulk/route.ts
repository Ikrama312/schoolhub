import { ok, parseBody, withHandler } from '@/server/http';
import { requireBursar } from '@/server/fees/access';
import { bulkAssignOptionalFee } from '@/server/fees/fees-service';
import { bulkOptionalFeeSchema } from '@/lib/validators/fees';

/** POST /api/fees/optional-fees/bulk — bursar; one optional fee for every student in a section (FR-9). */
export const POST = withHandler(async (request: Request) => {
  const actor = await requireBursar();
  return ok(await bulkAssignOptionalFee(actor, await parseBody(request, bulkOptionalFeeSchema)));
});
