import { ok, paginated, parseBody, parsePagination, parseQuery, withHandler } from '@/server/http';
import { requireRole, requireUser } from '@/server/auth/requireRole';
import { listGradingRoster, submit } from '@/server/assignments/assignments-service';
import { rosterQuery, submissionInput } from '@/lib/validators/assignments';

type Ctx = { params: { id: string } };

/** GET /api/assignments/:id/submissions — grading roster (FR-54). assertCanManageCourse in the service. */
export const GET = withHandler(async (request: Request, { params }: Ctx) => {
  const user = await requireUser();
  const searchParams = new URL(request.url).searchParams;
  if (!searchParams.has('pageSize')) searchParams.set('pageSize', '100');
  const page = parsePagination(searchParams);
  const query = parseQuery(searchParams, rosterQuery);
  const { items, total } = await listGradingRoster(user, params.id, query, page);
  return paginated(items, { page: page.page, pageSize: page.pageSize, total });
});

/** POST /api/assignments/:id/submissions — submit or resubmit (FR-53). 201 first time, 200 on resubmit. */
export const POST = withHandler(async (request: Request, { params }: Ctx) => {
  const user = await requireRole('STUDENT');
  const input = await parseBody(request, submissionInput);
  const { submission, created } = await submit(user, params.id, input);
  return ok(submission, { status: created ? 201 : 200 });
});
