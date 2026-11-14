import { ok, withHandler } from '@/server/http';
import { requireFeeReader } from '@/server/fees/access';
import { getPayment } from '@/server/fees/fees-service';

type Ctx = { params: { id: string } };

/** GET /api/fees/payments/:id — fee reader, access-checked (FR-32, FR-34, NFR-4). */
export const GET = withHandler(async (_request: Request, { params }: Ctx) => {
  const user = await requireFeeReader();
  return ok(await getPayment(user, params.id));
});
