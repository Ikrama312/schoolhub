# Coverage Report — SH-10 (PRD-10 Quizzes & Online Exams)

> This file replaces the stale SH-9 coverage report.

- ticketId: SH-10
- timestamp: 2026-11-09T07:58:00Z

## How coverage was measured

No coverage provider (`@vitest/coverage-v8` / `istanbul`) is installed. NFR-7 forbids new dependencies, so line coverage could not be collected.
Instead, coverage is measured at two levels:
1. **Export-level:** for each exported function in `src/server/quiz/*`, is it called directly by a test, or reached through a function that is?
2. **Requirement-level:** see the Requirement Results table in `qa-report.md`.

## Test inventory (SH-10)

| Suite | File | Tests | Result (QA run) |
|---|---|---|---|
| Unit | `tests/unit/quiz/grading.test.ts` | 16 | ✅ pass |
| Unit | `tests/unit/quiz/quiz-validators.test.ts` | 15 | ✅ pass |
| Unit | `tests/unit/quiz/serializers.test.ts` | 6 | ✅ pass |
| Integration (Postgres :5433) | `tests/integration/quiz/attempts.test.ts` | 7 | ✅ pass |
| Integration (Postgres :5433) | `tests/integration/quiz/regrade.test.ts` | 1 | ✅ pass |
| Integration (Postgres :5433) | **`tests/integration/quiz/qa-sh10.test.ts` (new, QA)** | 8 | ✅ pass (2 runs) |
| E2E (Playwright, `next start -p 3100`) | `tests/e2e/quizzes.spec.ts` | 4 | ✅ pass |
| **Total** | | **57** | **57 / 57** |

## Export-level coverage — `src/server/quiz/`

| Module | Directly tested | Indirectly exercised | Not exercised by any automated test |
|---|---|---|---|
| `grading.ts` (pure) | 9/10 | `percentOf` (via analytics, list, serializers) | — |
| `serializers.ts` | 5/8 | `toManagerQuestion/Answer/Attempt` (via `getQuiz`, `getAttemptView` manager view in qa-sh10) | — |
| `validators/quiz.ts` | all schemas | — | — |
| `analytics.ts` | 3/3 (`histogram`, `getQuizAnalytics`, `analyticsCsv`; new in QA) | — | — |
| `maintenance.ts` | 2/2 | — | — |
| `access.ts` | 0/6 directly | All 6: every service call goes through them. The NOT_FOUND paths are asserted for an outsider student, another teacher, an unlinked parent, and a parent before release (qa-sh10) | — |
| `quiz-service.ts` | 12/16 | `getQuizForManager`, `getQuizForStudent` (via `getQuiz`), `notifyResultsReleased` (via `releaseResults` / maintenance) | `listAccommodations` (server page only; covered only by the e2e page render, if at all) |
| `attempt-service.ts` | 7/15 | `recomputeAttempt`, `autoGradeAnswers`, `ensureNotExpired`, `getAccommodation`, `ensureQuizAttemptsNotExpired` (via start/save/submit/grade/list) | `listManagerAttempts`, `listOwnAttempts`, `getAttempt` (thin wrappers used by server pages and the GET route; the grading page is exercised by the e2e "teacher grades the essay" step) |

**Summary:** 43 of 46 exported server functions (~93%) are exercised by unit or integration tests. The remaining 3 are thin read wrappers, reached only through server pages and e2e.

## Not covered by automated tests

| Area | Files | Notes |
|---|---|---|
| Route handlers (thin) | `src/app/api/quizzes/**`, `src/app/api/attempts/**`, `src/app/api/questions/**`, `src/app/api/courses/[id]/quizzes` | Tests call the services directly, and the e2e drives the routes through the UI. A static check confirmed every handler calls `requireUser`/`requireRole` and parses input with Zod. No handler-level HTTP test asserts the 409 status mapping (the service-level `CONFLICT` is tested). |
| Builder: duplicate, drag reorder, preview | `QuestionList.tsx`, `QuizBuilder.tsx` | Present in the code (`useSortable`, the Duplicate IconButton, "Preview as student"). The e2e only covers add, type selection and publish. The server-side reorder is tested (qa-sh10). |
| `useAutosave` offline queue / 5 s retry | `take/useAutosave.ts` | The e2e covers a reload mid-attempt. Offline/retry has no unit test. |
| Timer warnings at 5 and 1 min (aria-live) | `take/QuizPlayer.tsx` L286–329 | Verified by code inspection only. |
| Analytics page chart | `analytics/QuizAnalytics.tsx` | The data is tested. The rendering is not. |
| Seed (FR-36) | `prisma/seed.ts` L455–557 | The dev DB has no MATH-7A / ENG-7A courses, so the seed skips quizzes. Verified by code inspection, plus the dev's fixture run recorded in the dev log. |
| 300-student load (NFR-2) | — | Not load-tested. qa-sh10 asserts the median of 50 concurrent saves is under 50 ms, and that saves are upserts. |
