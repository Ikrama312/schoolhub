import { ok, parseBody, parseQuery, withHandler } from '@/server/http';
import { assertCanSeeStudent, requireBursar, requireFeeAdmin } from '@/server/fees/access';
import { getStudentOptionalFees, setStudentOptionalFees } from '@/server/fees/fees-service';
import { studentOptionalFeesSchema, yearQuery } from '@/lib/validators/fees';

type Ctx = { params: { id: string } };

/** GET /api/fees/students/:id/optional-fees — ADMIN read (FR-9). */
export const GET = withHandler(async (request: Request, { params }: Ctx) => {
  const user = await requireFeeAdmin();
  await assertCanSeeStudent(user, params.id);
  const { academicYearId } = parseQuery(new URL(request.url).searchParams, yearQuery);
  return ok(await getStudentOptionalFees(params.id, academicYearId));
});

/** PUT /api/fees/students/:id/optional-fees — bursar; optional items only (FR-9). */
export const PUT = withHandler(async (request: Request, { params }: Ctx) => {
  const actor = await requireBursar();
  await assertCanSeeStudent(actor, params.id);
  return ok(await setStudentOptionalFees(actor, params.id, await parseBody(request, studentOptionalFeesSchema)));
});
