# Dev Log — SH-10 (PRD-10 Quizzes & Online Exams)

> The previous content of this file was the stale SH-9 log (and `task-completion-markers.json` was SH-9's).
> Following the established precedent, both were replaced for SH-10. This is SH-10's first dev iteration.
> `dev-rerun-count.json` was left untouched (engine-owned).

## Iteration 1 (2026-11-09)

All 23 tasks in `implementation-plan.json` were implemented in dependency order, at the exact paths in
`file-ownership-matrix.json`. All 51 matrix paths were verified on disk.

### Checklist
- TASK-1: Prisma schema + migration 20261110000000_add_quizzes (partial unique index) — ✓ complete
- TASK-2: Zod validators + unit tests — ✓ complete
- TASK-3: Pure grading core grading.ts + unit tests — ✓ complete
- TASK-4: Student serializers + no-`correct`-key unit test — ✓ complete
- TASK-5: quiz.published / quiz.results_released types + 'quiz' file context — ✓ complete
- TASK-6: access.ts assertCanAccessAttempt — ✓ complete
- TASK-7: attempt-service.ts — ✓ complete
- TASK-8: quiz-service.ts — ✓ complete
- TASK-9: analytics.ts — ✓ complete
- TASK-10: maintenance.ts + dispatch route wiring — ✓ complete
- TASK-11: Quiz & question CRUD route handlers — ✓ complete
- TASK-12: Regrade / release / analytics / accommodation routes — ✓ complete
- TASK-13: Attempt route handlers — ✓ complete
- TASK-14: Integration tests (attempts, regrade) — ✓ complete
- TASK-15: Course Quizzes tab, list page, view, new page — ✓ complete
- TASK-16: Quiz player, take page, useAutosave — ✓ complete
- TASK-17: QuestionList + QuestionEditor — ✓ complete
- TASK-18: Builder shell (edit page, QuizBuilder, QuizSettingsPanel) — ✓ complete
- TASK-19: Attempt result page — ✓ complete
- TASK-20: Manual grading page + workspace — ✓ complete
- TASK-21: Analytics page + x-charts BarChart — ✓ complete
- TASK-22: Seed: three quizzes (FR-36) — ✓ complete
- TASK-23: Playwright e2e quizzes.spec.ts — ✓ complete

### Verification
| Check | Result |
|---|---|
| `npm run lint` | ✔ no warnings/errors |
| `npx tsc --noEmit` | ✔ clean |
| `tests/unit/quiz/*` (validators, grading, serializers) | 37/37 pass |
| `tests/integration/quiz/*` against Postgres (`TEST_DATABASE_URL`) | 8/8 pass; rerun 6× to shake out races (see bug 1 below) |
| Full `vitest run` | 361/366. The 5–6 failures are the **same pre-existing ones recorded in the SH-9 QA report** (attendance-qa FR-22 / FR-10, auth-forms, useToast, lockout under Node 24, auth rate-limit flake). None import quiz code. |
| `next build` | ✔ (the "Dynamic server usage" log lines are pre-existing static-render noise from other routes) |
| `tests/e2e/quizzes.spec.ts` on a prod build (port 3100) | 4/4 pass on two consecutive runs. A third back-to-back run fails at `signInAs` because the 10-per-IP login rate limiter trips — helper limitation, not quiz code. |
| Seed | Verified against temporary MATH-7A / ENG-7A fixtures: creates Fractions Check (8 q, CLOSED, every enrolled student GRADED), Unit 1 Test (12 q incl. 2 essays, AFTER_CLOSE, open 3 days, no attempts), Parts of Speech (5 q, practice, 3 attempts, HIGHEST). A rerun creates 0 (idempotent). Fixtures removed afterwards. The dev DB has no courses, so `npm run db:seed` skips quizzes with a message, same as the assignments seed. |

### Bugs found and fixed during verification
1. **Concurrent start → false "attempts used up" (FR-19).** Tab B could miss tab A's attempt in its in-progress check, then count it and hit the attempt limit. `startOrResumeAttempt` now re-checks for an IN_PROGRESS attempt before refusing.
2. **Reload inside the 800 ms debounce lost the last answer (FR-15/FR-19, AC-2).** `useAutosave` now writes each change to `localStorage['quiz-attempt:<id>']` immediately and removes it on a 2xx. The pill shows "Saving…" during the debounce, and "Offline" only after a send has failed. Before this, "All answers saved" appeared while the debounce was still pending. Caught by the e2e reload step.
3. **DecimalError 500 on non-numeric points.** zod runs chained `.refine`s even after one fails, so `dec('')` threw. `halfStep` in `validators/quiz.ts` is now a single short-circuiting `superRefine`, with a regression test. Caught by the e2e grading step.
4. **Save-status chip contrast.** The theme's `success` chip measured 3.53:1 (axe, serious). The pill is now an outlined default-colour chip with Cloud icons.

### Decisions / deviations (for QA)
- **Migration generation:** `prisma migrate dev --create-only` failed because the DB role can't create a shadow database. The SQL came from `prisma migrate diff --from-schema-datasource --to-schema-datamodel` against the up-to-date DB instead. The raw partial unique index was appended, and the migration was applied with `migrate deploy`; there was no `db push` (ADR-2). The post-apply diff is empty.
- **NOT_FOUND hiding (NFR-5):** `course-access.ts` throws FORBIDDEN, so `quiz/access.ts` wraps it (`viewCourseOrNotFound` / `manageCourseOrNotFound`) and maps it to NOT_FOUND for every quiz resource.
- **Lazy auto-submit uses the 30 s grace** (`deadlineAt + ANSWER_GRACE_MS`), the same as the maintenance sweep. A GET inside the grace window therefore doesn't race the client's final save.
- **Edit lock compares values, not keys:** the builder sends the whole question, so the lock only rejects keys whose values actually changed.
- **Prompt images (FR-39):** they are uploaded with context `'quiz'` and embedded as `![](/api/files/<id>?inline=1)`. On question save, the service attaches the referenced unattached `quiz` files the caller owns (contextId = quizId), so `quizResolver` controls who can read them.
- **Accommodations table and analytics per-question table use MUI `Table`, not the shared `DataTable`.** DataTable is URL-paginated and server-driven, and these are small in-memory lists that need editable cells. Both are documented MUI components (NFR-4).
- **Extra service exports beyond the plan's lists** (all in owned files): `listManagerAttempts`, `listOwnAttempts`, `listAccommodations`, `getAttemptView`, `submitForStudent`, `ensureQuizAttemptsNotExpired`, `notifyResultsReleased`, and manager serializers (`toManagerQuestion/Answer/Attempt`). These are what the server pages need. No new files or dependencies were added.
- **Attempt ids** are cuid-shaped (`c` + base36 time + 16 hex chars) and generated up front for the shuffle seed. No cuid package is installed (marked with a `ponytail:` comment).
- **mui-mcp (ADR-7):** reachable. Docs fetched: x-charts Bars (first x-charts use), RadioGroup, LinearProgress, Tooltip. The other components follow the usage already established in the codebase.
- **E2E:** the window, title and visibility are set through Prisma after `/new` creates the draft, because the DateTimePicker is fiddly to drive. Questions, publish, take, reload, submit and grading all go through the UI. The axe scan is scoped to `<main>`, because the app-shell sidebar `<ul>` has a pre-existing `list` violation.

### Observed, not in SH-10 scope
- `renderEmail` (PRD-04) sometimes emits NUL bytes in react-email's preview padding. Postgres then rejects the `EmailOutbox` insert (`22021`). `notify()` logs and swallows the error, so in-app notifications still land. This appeared in integration runs for `quiz.results_released` emails.
- `validators/assignments.ts` `decimal()` uses the same chained-refine pattern as bug 3, so it probably throws a DecimalError on non-numeric input too.
- The app-shell sidebar has an axe `list` violation (serious).
- `saveAnswer` vs submit race: an upsert landing after the submit claim is left ungraded until a Regrade. Marked with a `ponytail:` comment.
