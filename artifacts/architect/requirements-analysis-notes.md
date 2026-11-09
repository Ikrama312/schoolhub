# Requirements Analysis Notes — ticket SH-10

Written by `arch-research-reqs` for `arch-design-system`. This is a supporting document, not a primary phase output.
Source: `artifacts/intake/requirements.json` (2026-11-09T12:00:00Z), PRD-10 Quizzes & Online Exams (SCH-010). It has 39 FRs and 10 NFRs (49 requirements) at 96% confidence.
`handoff-to-architect.json` lists **no blockers**. It flags assumptions on FR-33/34/35/37/38/39. Those are restated in §3 so `system-design.md` can carry them forward.

> The other files in `artifacts/architect/` (api-contracts.json, handoff-to-dev-planning.json, threat-model-notes.json, system-design.md, tech-stack-decisions.md) are **SH-9 leftovers** as of this writing (`ticketId: "SH-9"`). Their owning sub-tasks must overwrite them. Do not read them as SH-10 input.

## 1. Brownfield facts verified on disk

| # | Fact | Evidence | Impact on SH-10 |
|---|---|---|---|
| B1 | `assertCanViewCourse(user, courseId)` allows ADMIN, the teacher/co-teacher, an ACTIVE-enrolled STUDENT, and a PARENT with an ACTIVE-enrolled linked child. `assertCanManageCourse` allows ADMIN and the teacher/co-teacher. Both throw `AppError` NOT_FOUND/FORBIDDEN. | src/server/auth/course-access.ts | These cover FR-34 and the course part of NFR-5. Attempt-level checks are still new: owner, linked parent, or manager. |
| B2 | `courseTabs` is a static array of `{key, label, href, roles}`. | src/config/course-tabs.ts | FR-11: add one entry, `{ key: 'quizzes', href: id => /courses/${id}/quizzes, roles: ALL_ROLES }`. |
| B3 | The maintenance route calls `dispatchEmails` and then `sendDueReminders(now)` on every request, each wrapped in its own try/catch + logger. Purges run in a once-per-day block. | src/app/api/internal/email/dispatch/route.ts | FR-18/FR-30/FR-35: add `autoSubmitExpiredAttempts(now)` and `sendQuizResultsReleased(now)` **on every call**, next to sendDueReminders, each with its own try/catch. |
| B4 | `sendDueReminders` is idempotent through a unique-key claim row (`AssignmentReminder`, P2002 → skip). | src/server/assignments/reminders.ts | FR-30 AFTER_CLOSE needs a "sent once" marker. The simplest option is a nullable `Quiz.resultsNotifiedAt`, claimed with `updateMany({ where: { id, resultsNotifiedAt: null } })` and a count check. That needs no new table. If FR-1's model list must stay exact, a claim table is the alternative. |
| B5 | `notify()` and `notifyStudentAndParents({studentIds})` never throw. Call them after commit. | src/server/notifications/notify.ts | FR-29 → `notify()` to enrolled students. FR-30 → `notifyStudentAndParents`. |
| B6 | `NOTIFICATION_TYPES` is a const object. New keys need `label/description/category/defaultEmail/mandatoryInApp/roles`. | src/server/notifications/types.ts | FR-29: `quiz.published` (ACADEMIC, defaultEmail false, roles STUDENT). `quiz.results_released` (ACADEMIC, roles STUDENT+PARENT). The PRD doesn't give a default email setting for results_released. Default it to true to match assignment.graded, and flag that choice. |
| B7 | `audit({actorId, action, entityType, entityId, metadata, request})` never throws. | src/server/audit.ts | FR-38 actions: `quizAnswer.grade`, `quiz.regrade`, `quiz.release_results`, `quizAccommodation.update`. |
| B8 | `grading-math.ts` is pure and isomorphic. It exports `dec`, `fixed2` and `Decimal` from the Prisma browser runtime. `assignments-service.ts` exports `serializeDecimal` and `getSchoolTimezone`. | src/server/assignments/* | FR-3/FR-22/FR-25 reuse dec/fixed2 (NFR-7). Importing from `@/server/assignments/grading-math` is fine. Only lift it to a shared module if dev-planning wants that. Do not copy it. |
| B9 | `http.ts` provides `withHandler`, `ok`, `paginated`, `AppError`. The codes include CONFLICT (409). Zod errors become VALIDATION_ERROR. Prisma P2002 becomes CONFLICT. | src/server/http.ts | NFR-6. FR-16's 409 is `AppError('CONFLICT', ...)`. |
| B10 | The DB is PostgreSQL. The project already uses raw-SQL partial unique indexes in migrations. | prisma/migrations/20261107000000_attendance/migration.sql L77-78 | FR-19 race-safety: `CREATE UNIQUE INDEX ... ON "QuizAttempt"("quizId","studentId") WHERE status = 'IN_PROGRESS'`, hand-added to the FR-1 migration. Add `@@unique([quizId, studentId, attemptNumber])` too. On P2002 during start, re-read and resume. |
| B11 | File contexts are registered in `registerBuiltInContexts` (lesson, logo, assignment, submission). `attachFiles` sets context/contextId. | src/server/files/contexts.ts, files-service.ts | FR-39: question images need a `'quiz'` context (contextId = quizId) with a resolver: manager, or a viewer with an IN_PROGRESS or visible attempt. The prompt Markdown references the file URL. |
| B12 | Courses MATH-7A and ENG-7A are looked up in seed.ts with `findCourse([...])`. The seed already uses `console.log` for skips. | prisma/seed.ts L302, L340 | FR-36 follows that pattern (the seed is exempt from the no-console.log rule in practice). |
| B13 | Installed: @mui/* 9.5.0 (incl. x-charts, x-data-grid, x-date-pickers), @dnd-kit/core 6.3.1 + sortable 10.0.0, zod 3.23.8, prisma 5.20, vitest, Playwright + axe. | package.json | FR-7, FR-26 and NFR-8 need **no new dependencies** (NFR-7). |
| B14 | Shared components are DataTable, ConfirmDialog, Toast, MarkdownEditor, MarkdownView, FileUpload, StatCard, EmptyState, PageHeader, DateDisplay. | src/components/ | FR-7/12/17/24/26/39 reuse them. |
| B15 | `toStudentSubmission(dto)` is the precedent for a student-shaped serializer. | assignments-service.ts L199 | NFR-1: add `toStudentQuiz` / `toStudentAttempt` in `src/server/quiz/serializers.ts`, with a unit test asserting the `correct` key is absent. |

## 2. Requirement → architectural concern

Concern legend: **DM** data model/migration · **VAL** validator · **PURE** pure domain logic · **SVC** service (src/server/quiz/) · **API** route handler · **UI** page/component · **JOB** maintenance pass · **AUTH** access boundary · **NOTIF** notification · **AUD** audit · **SEED** seed · **CFG** config registry · **TEST**

| Req | Concern | Notes |
|---|---|---|
| FR-1 | DM | One migration, `add_quizzes`. 5 enums, 5 models. Back-relations on Course (`quizzes`) and User (attempts, accommodations, graded answers). QuizAnswer PK `(attemptId, questionId)` (NFR-2). QuizAccommodation unique `(quizId, studentId)`. Include the partial unique index from B10 in the SQL. Money-like fields (points, scores) are `Decimal(6,2)`, per the assignments precedent. |
| FR-2 | VAL | `src/lib/validators/quiz.ts`, client-safe, shared by the builder UI and the handlers. Use per-type question schemas as a discriminated union on `type`. `availableUntil > availableFrom` and the time-limit cross-field checks use `.superRefine`. |
| FR-3 | PURE | `src/server/quiz/grading.ts`. No Prisma import, so the builder preview and tests can use it. `gradeAnswer(question, response) → { points, flagged }`. Partial-credit formula from FR-3. Use Decimal and round with fixed2. |
| FR-4 | PURE | Same module. `normalize = s.trim().replace(/\s+/g,' ')`, with case-folding unless `caseSensitive` is set. A non-match returns `flagged: true` and 0 points. |
| FR-5 | PURE | ESSAY → `{ points: null, flagged: true }`. `correct` holds the guidance text and is server-only (NFR-1). |
| FR-6 | UI, AUTH | Server page `/courses/[courseId]/quizzes/[quizId]/edit`, protected by assertCanManageCourse. The settings panel uses MUI x-date-pickers. The time-limit vs window check reuses the FR-2 validator on the client. |
| FR-7 | UI | Sortable question list (@dnd-kit/sortable wrapping MUI items). Per-type editor components. Reorder calls `POST /questions/reorder`. |
| FR-8 | UI | The points total is derived client-side. Preview mode reuses the player component with a `preview` prop. It gets data from the manager GET (with `correct`) and grades locally with the pure grading.ts. It **never calls the attempt endpoints**, so nothing is recorded. |
| FR-9 | SVC, PURE | `canPublish(quiz, questions) → string[]` (pure, so it can be shared with the UI). The PATCH status→PUBLISHED transition enforces it server-side. Publishing triggers FR-29. |
| FR-10 | SVC, API, AUD | A lock check runs when `attemptCount > 0` (`_count.attempts`). It whitelists `prompt/explanation/correct (SHORT_ANSWER only)` and returns CONFLICT with an explanation otherwise. `POST /api/quizzes/:id/regrade` re-runs gradeAnswer on non-manually-graded answers in one transaction, then recomputes attempt scores (FR-25 logic). It must not override teacher-graded answers (manual grade wins). |
| FR-11 | CFG, UI, SVC | The course tab entry (B2). `GET /api/courses/:id/quizzes` is role-shaped. Teachers get aggregates (count, avg, needsGrading via groupBy). Students get bucketed rows (Upcoming / Available / Completed / **Missed = closed with zero attempts**, assumed). Parents get completed results only, scoped to the linked child. |
| FR-12 | UI | Server page `/quizzes/[quizId]/take`. It resolves the course from the quiz and calls assertCanViewCourse (STUDENT). Attempts used/allowed uses FR-23. ConfirmDialog guards Start. |
| FR-13 | SVC, PURE | Inside the start transaction: freeze `questionOrder: String[]`. Option order is a deterministic seeded shuffle (seed = attempt id). Use a pure `seededShuffle(items, seed)` (a small string hash + mulberry32) in grading.ts or a sibling. `deadlineAt = min(startedAt + (limit + extra) min, availableUntil)`. With no time limit, it is `availableUntil` (handoff risk 4). Pure `computeDeadline()`, unit-tested (NFR-8). |
| FR-14 | UI | Player client component (MUI RadioGroup/FormGroup/TextField/LinearProgress, a navigator grid of Buttons). The sticky header timer is display-only (FR-16). The server returns `deadlineAt` and the client counts down from it. |
| FR-15 | UI, API | `useAutosave` hook: 800 ms debounce per question, a localStorage queue keyed `quiz-attempt:<id>`, a 5 s retry interval, and `navigator.onLine`. Three-state pill. The server upsert is idempotent, so replays are safe. |
| FR-16 | SVC, API | The answer PUT reads only the attempt row `{studentId, status, deadlineAt}` (NFR-2). Past `deadlineAt + 30 s` it calls submitAttempt(auto) and then throws CONFLICT. The client then routes to the submitted view. |
| FR-17 | SVC, UI | `submitAttempt(attemptId, { auto })`, in one transaction. Grade every answer, create zero-score rows for unanswered questions, and set `score`, `submittedAt` and status (NEEDS_GRADING if anything is flagged, else GRADED). Guard with `updateMany where status = IN_PROGRESS` so double submits are no-ops (this also makes FR-18 idempotent). |
| FR-18 | SVC, JOB | A lazy check on `GET /api/attempts/:id`, on `POST /attempts` (start/resume), and on the teacher list/grade loads: `if IN_PROGRESS && now > deadlineAt → submitAttempt({auto:true})`. `autoSubmitExpiredAttempts(now)` does a batch find + submitAttempt each (B3). |
| FR-19 | DM, SVC | Start or resume: find the IN_PROGRESS attempt and return it. Otherwise create one. Rely on the partial unique index (B10), and on P2002 re-read. Two tabs end up on the same attempt id. |
| FR-20 | PURE, SVC, API, AUD | `resultsVisible(quiz, now)`: IMMEDIATELY → true after submit, AFTER_CLOSE → `now ≥ availableUntil`, MANUAL → `resultsReleasedAt != null`. `POST /release-results` (manager) sets resultsReleasedAt, then audit + FR-30. This one predicate drives the NFR-1 serializer. |
| FR-21 | UI, SVC | Result view. The serializer includes `correct` and explanation only when `resultsVisible && showCorrectAnswers`. Score and per-question points only when `resultsVisible`. |
| FR-22 | SVC | `getStudentQuizScore(quizId, studentId) → { score, maxScore, isPractice, attemptsCounted } \| null`. HIGHEST/LATEST/AVERAGE over GRADED attempts (Decimal average, fixed2). An exported service function. No endpoint. |
| FR-23 | SVC, PURE | `attemptLimit = maxAttempts + (accommodation?.extraAttempts ?? 0)`. Start throws CONFLICT when `count(attempts) ≥ limit` and there's no IN_PROGRESS attempt to resume. Pure helper, unit-tested. |
| FR-24 | UI, API, AUTH, AUD | Grade page with two modes (DataTable by student, or by question). `PUT /api/attempts/:id/answers/:questionId/grade` (manager): points 0..question.points step 0.5, plus feedback. Sets `gradedById/manuallyGraded`, then audit, then FR-25. |
| FR-25 | SVC | After each grade: if no answer in the attempt is still ungraded, set status GRADED and recompute the score as Σ points. Recompute the score on every grade regardless, so overrides on GRADED attempts update it. |
| FR-26 | SVC, API, UI | `GET /api/quizzes/:id/analytics` (manager). Aggregates are computed in TS over submitted attempts. The class sizes are small, so compute in memory. Median computed in code. Histogram with 10 buckets (100% goes in the last bucket). MUI X BarChart + StatCard. |
| FR-27 | SVC, API | Per-question stats come from the same pass. The option distribution counts option ids in responses. `?format=csv` reuses `src/server/csv.ts` and returns text/csv with one row per attempt. |
| FR-28 | API, DM, AUD | `PUT /api/quizzes/:id/accommodations/:studentId` upserts QuizAccommodation (manager). The student must be ACTIVE-enrolled. Changes apply only to attempts started later (deadlineAt is frozen at start). Note this for the UI copy. |
| FR-29 | NOTIF | Fires on the first transition to PUBLISHED only (track `publishedAt` or check the previous status). Link `/quizzes/:id/take`. Recipients are ACTIVE enrollees. Skip if the quiz is practice? No: the PRD doesn't say, so send. |
| FR-30 | NOTIF, JOB | MANUAL → on release (once, guarded by `resultsReleasedAt` going null→set). AFTER_CLOSE → the maintenance pass picks closed quizzes with `resultsNotifiedAt IS NULL` (B4) and notifies students who submitted, plus their parents. IMMEDIATELY → never. |
| FR-31 | API, AUTH | Routes under `src/app/api/{courses/[id]/quizzes, quizzes/[id], quizzes/[id]/questions, quizzes/[id]/questions/reorder, questions/[id]}`. DELETE quiz → CONFLICT if any attempt exists. Reorder accepts the full id list and rejects ids that don't match the quiz's set exactly. |
| FR-32 | API, AUTH | `POST /api/quizzes/:id/attempts` (STUDENT, course view, quiz PUBLISHED and within its window). `GET /api/attempts/:id` (owner, linked parent once results are released, or manager). The answers PUT and the submit POST are owner-only. |
| FR-33 | DM, SVC | `isPractice` is returned in FR-22's result. It counts for attempts and analytics like a graded quiz (intake assumption). |
| FR-34 | AUTH | B1, reused unchanged. Add one helper, `assertCanAccessAttempt(user, attempt)`, in src/server/quiz/: owner, manager via assertCanManageCourse, or a PARENT linked to the student. Parent access is read-only and only when results are visible. |
| FR-35 | JOB | B3. Both functions must be idempotent: FR-17's status guard and FR-30's claim column. |
| FR-36 | SEED | Extend prisma/seed.ts. 'Fractions Check' (8 objective questions, closed, every MATH-7A student has a GRADED attempt; scores via grading.ts so the seed data is consistent). 'Unit 1 Test' (12 questions incl. 2 ESSAY, AFTER_CLOSE, window now → +3 days, no attempts). 'Parts of Speech' (ENG-7A, practice, maxAttempts 3, HIGHEST). The seed must be idempotent like the existing one (upsert by title + course). |
| FR-37 | — | **No work** (LOW, assumed). No sidebar entry. The course tab covers it. Design should drop it explicitly. |
| FR-38 | AUD | B7. Write after commit, inside the service functions, not in the handlers. |
| FR-39 | UI, AUTH | MarkdownEditor/MarkdownView for prompts, FileUpload with a `'quiz'` context, and a resolver (B11). |
| NFR-1 | AUTH, SVC, TEST | **Highest-risk item.** All student-facing reads (quiz GET, attempt GET, course list, answer-PUT response) go through `serializers.ts`. Prisma selects for student paths never select `correct`/`explanation` at all (defence in depth). The unit test asserts `'correct' in obj === false` recursively. |
| NFR-2 | DM, SVC | The answer PUT does exactly one attempt read plus one upsert. Don't load the Question row: the questionId is validated against `attempt.questionOrder` (already on the attempt row). The response validator for the answer shape is type-agnostic (`string[] \| string`). It is type-checked at grade time. |
| NFR-3 | UI | Native inputs via MUI Radio/Checkbox. An `aria-live="assertive"` region announces only at the 5:00 and 1:00 thresholds, not every tick. Keyboard nav for the navigator grid. The axe check is part of the e2e. |
| NFR-4 | UI | MUI only. Look up each component through mui-mcp before use. This is a dev-phase obligation, so carry it into the plan. |
| NFR-5 | AUTH | Every handler starts with requireUser/requireRole and then a course or attempt check. The server pages use requirePageRole. |
| NFR-6 | API | withHandler + Zod parse. `{data}` / `paginated` envelopes. The course quiz list is paginated (pageSize ≤ 100). cuid ids, UTC timestamps. The UI formats dates with DateDisplay / formatInSchoolTz. |
| NFR-7 | — | Constraint on all of the above: `src/server/quiz/` only, reuse B5–B9 and B14, no new deps, no console.log in app code. |
| NFR-8 | TEST | Unit: grading.ts (partial credit incl. the FR-3 example, short-answer normalisation), computeDeadline + accommodations, scoring policies, serializer. Integration: autosave 409 after deadline+grace, auto-submit on GET, regrade. E2E: a single Playwright spec. |
| NFR-9 | UI | Builder ergonomics: default type MULTIPLE/SINGLE_CHOICE, Enter adds an option row, and Duplicate. No architectural change. |
| NFR-10 | — | Out of scope. Design must not add question banks, proctoring or LaTeX. |

## 3. Cross-cutting decisions for `arch-design-system`

- **D1 Module layout (NFR-7):**
  - `src/server/quiz/grading.ts` (pure: gradeAnswer, seededShuffle, computeDeadline, attemptLimit, resultsVisible, canPublish, applyScoringPolicy)
  - `quiz-service.ts` (CRUD, publish, lock, regrade, release, accommodations)
  - `attempt-service.ts` (start/resume, saveAnswer, submit, lazy auto-submit, grade, getStudentQuizScore)
  - `analytics.ts`
  - `serializers.ts`
  - `maintenance.ts` (autoSubmitExpiredAttempts, sendQuizResultsReleased)
  - `access.ts` (assertCanAccessAttempt)

  Keep the pure helpers together in one file unless it grows past what one file reads comfortably.
- **D2 Single submit path:** manual submit, deadline-PUT rejection, lazy load and the maintenance pass all call one `submitAttempt`. The `status = IN_PROGRESS` conditional update makes it idempotent and race-safe.
- **D3 Visibility predicate:** one `resultsVisible()` drives the serializer, the parent access and the FR-11 "score if visible" display.
- **D4 Frozen-at-start:** questionOrder, option order (via seed) and deadlineAt are fixed at start. Later accommodation or settings edits don't move in-flight attempts. FR-10 locks prevent structural changes anyway.
- **D5 Manual grade precedence:** regrade (FR-10) only recomputes answers where `manuallyGraded = false`. If FR-1's QuizAnswer field list doesn't include such a flag, use `gradedById IS NULL` as the marker.

## 4. Assumptions and open points to surface in the system-design Overview

1. FR-37: no sidebar entry (LOW).
2. Missed = closed with zero attempts by that student.
3. Regrade runs only on the explicit action. Editing accepted answers doesn't auto-regrade.
4. Practice quizzes count toward attempts and analytics. They are excluded only from the gradebook (FR-22's caller filters on isPractice).
5. `quiz.results_released` defaultEmail = true. The PRD doesn't specify it.
6. FR-30's AFTER_CLOSE "sent once" needs a marker. B4 proposes `Quiz.resultsNotifiedAt`, which is an addition to FR-1's "exactly as listed" model. If that isn't acceptable, use a claim table.
7. Accommodation changes affect only attempts started after the change.
8. Intake handoff blockers: **none**.
