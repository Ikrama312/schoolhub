import { AppError, ok, parseQuery, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { listForStudent, listReportCards } from '@/server/report-cards/report-card-service';
import { reportCardsQuery } from '@/lib/validators/gradebook';

/**
 * GET /api/report-cards
 * (A) ?termId=&gradeLevelId=&sectionId= — ADMIN / homeroom TEACHER roster (FR-29, FR-33).
 * (B) ?studentId=[&termId=] — the student's cards; PUBLISHED only for students/parents (FR-36).
 */
export const GET = withHandler(async (request: Request) => {
  const user = await requireUser();
  const q = parseQuery(new URL(request.url).searchParams, reportCardsQuery);
  if (q.studentId) return ok(await listForStudent(user, q.studentId, q.termId));
  if (!q.termId) throw new AppError('VALIDATION_ERROR', 'termId is required', { fieldErrors: { termId: ['Required'] } });
  return ok(await listReportCards(user, { termId: q.termId, gradeLevelId: q.gradeLevelId, sectionId: q.sectionId }));
});
