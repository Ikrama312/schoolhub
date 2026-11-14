import { ok, parseBody, parseQuery, withHandler } from '@/server/http';
import { assertCanSeeStudent, requireBursar, requireFeeAdmin } from '@/server/fees/access';
import { getStudentDiscounts, setStudentDiscounts } from '@/server/fees/fees-service';
import { studentDiscountsSchema, yearQuery } from '@/lib/validators/fees';

type Ctx = { params: { id: string } };

/** GET /api/fees/students/:id/discounts — ADMIN read (FR-10). */
export const GET = withHandler(async (request: Request, { params }: Ctx) => {
  const user = await requireFeeAdmin();
  await assertCanSeeStudent(user, params.id);
  const { academicYearId } = parseQuery(new URL(request.url).searchParams, yearQuery);
  return ok(await getStudentDiscounts(params.id, academicYearId));
});

/** PUT /api/fees/students/:id/discounts — bursar; manual discounts only (FR-10). */
export const PUT = withHandler(async (request: Request, { params }: Ctx) => {
  const actor = await requireBursar();
  await assertCanSeeStudent(actor, params.id);
  return ok(await setStudentDiscounts(actor, params.id, await parseBody(request, studentDiscountsSchema)));
});
