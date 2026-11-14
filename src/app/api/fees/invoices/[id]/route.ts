import { ok, parseBody, withHandler } from '@/server/http';
import { requireBursar, requireFeeReader } from '@/server/fees/access';
import { deleteDraft, getInvoice, updateDraft } from '@/server/fees/fees-service';
import { draftPatchSchema } from '@/lib/validators/fees';

type Ctx = { params: { id: string } };

/** GET /api/fees/invoices/:id — fee reader, access-checked (404 out of scope) (FR-19, NFR-4). */
export const GET = withHandler(async (_request: Request, { params }: Ctx) => {
  const user = await requireFeeReader();
  return ok(await getInvoice(user, params.id));
});

/** PATCH /api/fees/invoices/:id — bursar, DRAFT only (FR-20). */
export const PATCH = withHandler(async (request: Request, { params }: Ctx) => {
  const actor = await requireBursar();
  return ok(await updateDraft(actor, params.id, await parseBody(request, draftPatchSchema)));
});

/** DELETE /api/fees/invoices/:id — bursar, DRAFT only (FR-20). */
export const DELETE = withHandler(async (_request: Request, { params }: Ctx) => {
  const actor = await requireBursar();
  return ok(await deleteDraft(actor, params.id));
});
