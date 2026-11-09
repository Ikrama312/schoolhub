# System Design: SH-10 · PRD-10 Quizzes & Online Exams (SCH-010)

Ticket: SH-10 · Phase: architect (arch-design-system) · Timestamp: 2026-11-09T12:45:00Z · Status: complete
Inputs: `artifacts/intake/requirements.json` (39 FR + 10 NFR, 96%), `handoff-to-architect.json` (no blockers),
`tech-stack-decisions.md` (ADR-1..ADR-8), `requirements-analysis-notes.md` (B1–B15, D1–D5), PRD `10-quizzes.md` FR-1 schema.
Run mode: `--brownfield --tech-stack react`.

---

## 1. Overview

PRD-10 adds teacher-built quizzes to courses: students take timed, autosaved attempts, the server grades them automatically where it can, teachers grade essays and flagged short answers by hand, and results are released according to a per-quiz visibility rule. The feature is a new vertical slice in the existing Next.js 14 App Router + Prisma/Postgres app. It follows the PRD-09 assignments layout exactly:

- `src/server/quiz/` holds the domain logic
- `src/app/api/...` holds thin route handlers
- `src/app/(app)/...` holds server pages with MUI client components

There is no new infrastructure and no new dependency (ADR-1). All background work goes through the existing maintenance dispatcher (ADR-6).

**Design principles**
1. **The server owns time and truth.** `deadlineAt` is frozen at start and checked only on the server. The client timer is display-only (FR-13, FR-16, ADR-4).
2. **One path per state transition.** Manual submit, the deadline rejection, lazy load and the maintenance pass all call a single `submitAttempt()`. The `status = IN_PROGRESS` guard makes it idempotent (FR-17, FR-18, FR-35).
3. **One visibility predicate.** `resultsVisible()` gates scores, correct answers and parent access (FR-20, FR-21, NFR-1).
4. **Allow-listed student output.** Students only ever receive output from `serializers.ts` (NFR-1, ADR-5).
5. **Pure core, thin I/O shell.** Grading, deadline, scoring, shuffle and publish checks are pure and unit-tested (NFR-8, ADR-3).

### 1.1 Intake blockers
`handoff-to-architect.json` reports **`blockers: []`**. Nothing blocks design or dev.

### 1.2 Assumptions carried forward (flagged by intake, resolved here)
| # | Req | Assumption / decision |
|---|---|---|
| A1 | FR-37 (LOW) | **No sidebar entry.** Quizzes are reached through the course "Quizzes" tab and direct routes. FR-37 produces no code. |
| A2 | FR-11 | "Missed" means the quiz is past `availableUntil` and the student has zero attempts. |
| A3 | FR-10 | Regrade runs only through the explicit `POST /regrade`. Editing accepted answers does not trigger an automatic regrade. |
| A4 | FR-33 | Practice quizzes count toward attempts, analytics and the teacher list. They are excluded only from the gradebook: `getStudentQuizScore` returns `isPractice` and PRD-11 filters on it. |
| A5 | FR-29, FR-30 | `quiz.published` has defaultEmail = false (PRD). `quiz.results_released` has defaultEmail = true, matching `assignment.graded`; the PRD doesn't say. |
| A6 | FR-30 | **No new column.** The "sent once" marker for AFTER_CLOSE results is the existing `Quiz.resultsReleasedAt`, which the maintenance pass claims atomically for AFTER_CLOSE quizzes (§4.5). This keeps FR-1's model list exact. The research notes' `resultsNotifiedAt` and claim-table options are therefore not needed. |
| A7 | FR-28 | Accommodation changes apply only to attempts started after the change, because `deadlineAt` is frozen at start. The settings UI says so. |
| A8 | FR-17, FR-25 | FR-1 has no `flagged` or `manuallyGraded` column. Both are **derived**: an answer is *manually graded* when `gradedById != null`, and it *needs review* when it is an ESSAY with `gradedById = null`, or a SHORT_ANSWER with `isCorrect = false` and `gradedById = null`. A pure `needsReview()` implements this rule. |
| A9 | FR-29 | Status transitions are **DRAFT → PUBLISHED → CLOSED** only. There is no unpublish, so `quiz.published` fires exactly once, on the conditional DRAFT→PUBLISHED update. |
| A10 | FR-8 | Preview mode reuses the player with `mode="preview"`. Saves and submit are no-ops, nothing is graded, and nothing is sent to attempt endpoints. |

### 1.3 Scope fence (NFR-10)
Out of scope: lockdown browser, webcam proctoring, question banks, random pools and LaTeX. Nothing in this design anticipates them.

---

## 2. Data Model (FR-1, FR-2)

The model is one migration, `prisma/migrations/20261110000000_add_quizzes/`, created with `prisma migrate dev --create-only` and hand-edited (ADR-2). The fields are **exactly as in PRD FR-1**. This design adds only relations and indexes, never new columns:

| Model | Additions beyond the PRD listing | Why |
|---|---|---|
| Quiz | `createdBy User @relation("QuizCreatedBy")`; `@@index([courseId, status])` | FK integrity; course tab list (FR-11) |
| Question | `answers QuizAnswer[]`; `@@index([quizId, order])` | ordered load (FR-7, FR-31) |
| QuizAttempt | `@@index([quizId, status])`, `@@index([status, deadlineAt])` | teacher list/needs-grading count (FR-11); maintenance sweep (FR-18) |
| QuizAnswer | `question Question @relation(onDelete: Cascade)`, `gradedBy User? @relation("QuizAnswerGradedBy")` | FK integrity; grading audit (FR-24) |
| QuizAccommodation | `quiz Quiz @relation(onDelete: Cascade)`, `student User @relation(...)`, plus `accommodations QuizAccommodation[]` on Quiz | FK integrity (FR-28) |
| Course | `quizzes Quiz[]` | FR-1 back-relation |
| User | `quizzesCreated`, `quizAttempts`, `quizAccommodations`, `quizAnswersGraded` | FR-1 back-relations |

**Raw SQL appended to the migration (FR-19, ADR-2):**
```sql
CREATE UNIQUE INDEX "quiz_attempt_one_in_progress_uq"
  ON "QuizAttempt"("quizId","studentId") WHERE "status" = 'IN_PROGRESS';
```
A `schema.prisma` comment on QuizAttempt points to it, following the attendance-migration precedent. `prisma db push` would drop it, so dev and CI must use `migrate`.

**JSON shapes** follow the PRD FR-2 table and are typed by the Zod discriminated union in `src/lib/validators/quiz.ts`:
- `options`: `[{id,text}]`. Option ids are short cuids generated client-side and stable across edits.
- `correct` (per type): `{optionId}`, `{optionIds}`, `{value}`, `{accepted}` or `{guidance?}`.
- `response` (per type): `{optionId}`, `{optionIds}`, `{value}` or `{text}`.

---

## 3. Component Breakdown

### 3.1 Server domain: `src/server/quiz/` (NFR-7)

| File | Kind | Exports | Reqs |
|---|---|---|---|
| `grading.ts` | **pure**, isomorphic, no Prisma client | `gradeAnswer(question, response) → {pointsAwarded: Decimal\|null, isCorrect: boolean\|null}`, `needsReview(question, answer)`, `normalizeShortAnswer(s)`, `computeDeadline(startedAt, timeLimitMinutes, extraTimeMinutes, availableUntil)`, `attemptLimit(maxAttempts, extraAttempts)`, `resultsVisible(quiz, attempt, now)`, `canPublish(questions) → string[]`, `applyScoringPolicy(policy, gradedAttempts)`, `seededShuffle(items, seed)` (string hash + mulberry32), `ANSWER_GRACE_MS = 30_000` | FR-3, FR-4, FR-5, FR-9, FR-13, FR-20, FR-22, FR-23, FR-28 |
| `serializers.ts` | pure | `toStudentQuiz`, `toStudentAttempt`, `toStudentResult`. They are built by explicit allow-list, never spread-then-delete. | NFR-1, FR-21, FR-11 |
| `access.ts` | I/O | `assertCanAccessAttempt(user, attempt, {write})`: the owner (write allowed), a manager via `assertCanManageCourse`, or a linked PARENT (read-only, and only when `resultsVisible`). Otherwise it throws NOT_FOUND. | FR-34, NFR-5 |
| `quiz-service.ts` | I/O | `listCourseQuizzes(user, courseId, page)` (role-shaped), `createQuiz`, `getQuizForManager`, `getQuizForStudent`, `updateQuiz` (settings + status transition + publish check + FR-29 notify), `deleteQuiz` (CONFLICT if any attempt exists), `addQuestion`, `updateQuestion`, `deleteQuestion`, `reorderQuestions` (all through the **edit lock**), `regradeQuiz`, `releaseResults`, `upsertAccommodation` | FR-6..FR-11, FR-20, FR-28, FR-29, FR-31, FR-38 |
| `attempt-service.ts` | I/O | `startOrResumeAttempt`, `getAttempt` (calls `ensureNotExpired`), `saveAnswer` (hot path), `submitAttempt(attemptId, {auto})`, `ensureNotExpired(attempt)`, `gradeAnswerManually`, `recomputeAttempt(tx, attemptId)`, `getStudentQuizScore(quizId, studentId)` | FR-12..FR-19, FR-22..FR-25, FR-32, FR-33, FR-38 |
| `analytics.ts` | I/O + pure aggregation | `getQuizAnalytics(quizId)` returns summary stats, a 10-bucket histogram and per-question stats. `analyticsCsv(quizId)` uses `toCsv` from `src/server/csv.ts`. | FR-26, FR-27 |
| `maintenance.ts` | I/O | `autoSubmitExpiredAttempts(now)`, `sendAfterCloseResultsReleased(now)` | FR-18, FR-30, FR-35 |

Reused as-is: `dec`/`fixed2`/`Decimal` from `@/server/assignments/grading-math` (imported, not copied); `withHandler`/`ok`/`paginated`/`AppError` (`src/server/http.ts`); `assertCanViewCourse`/`assertCanManageCourse` (`src/server/auth/course-access.ts`); `notify`/`notifyStudentAndParents`; `audit`; `logger`; `toCsv`; `getSchoolTimezone` (NFR-7).

**Edit lock (FR-10).** `quiz-service` checks `_count.attempts > 0` before every question mutation. When attempts exist:
- `updateQuestion` accepts only `prompt`, `explanation`, and (for SHORT_ANSWER) `correct.accepted` / `caseSensitive`.
- `addQuestion`, `deleteQuestion`, `reorderQuestions`, and changes to `type`/`points`/options/choice `correct` throw `AppError('CONFLICT', 'Quiz has attempts — only text, explanation and accepted answers can change. Use Regrade after editing accepted answers.')`.
- The same check sits behind the builder's disabled controls and their tooltip.

**Regrade (FR-10, FR-38).** One `$transaction`:
1. For every submitted attempt, re-run `gradeAnswer` on answers with `gradedById = null` (a manual grade always wins, per A8).
2. `recomputeAttempt` each attempt.
3. Write `audit('quiz.regrade', {attemptCount})`.

`recomputeAttempt` (FR-25): sets `score = Σ pointsAwarded` (fixed2) and sets status to `NEEDS_GRADING` if any `needsReview`, otherwise `GRADED`. Only submitted attempts are touched.

### 3.2 Validators: `src/lib/validators/quiz.ts` (FR-2, NFR-6)
These are client-safe Zod schemas shared by the builder forms and the route handlers:
- `quizSettingsSchema` uses `.superRefine`: `availableUntil > availableFrom`, and `timeLimitMinutes ≤ window minutes` (FR-6). Limits: timeLimit 1–300 or null, maxAttempts 1–10.
- `questionSchema` is a `z.discriminatedUnion('type', …)`: points 0.5–100, 2–8 options, ≥1 correct option for MULTIPLE_CHOICE, 1–10 accepted answers, prompt as non-empty Markdown.
- `answerResponseSchema` is a type-agnostic union, so the hot path doesn't load the Question (NFR-2). ESSAY/SHORT text is ≤ 10,000 characters.
- `manualGradeSchema` is `{points: 0..∞ step 0.5, feedback?}`. The upper bound (question points) is checked in the service.
- `accommodationSchema`: extraTime 0–300, extraAttempts 0–5.
- `reorderSchema`: `{questionIds: string[]}`.

### 3.3 API route handlers (FR-31, FR-32, NFR-5, NFR-6)
Every handler is `withHandler` → `requireUser`/`requireRole` → Zod parse → one service call → `ok`/`paginated`. There is no logic in the handlers. `api-contracts.json` (the next sub-task) owns the exact shapes.

| Route file | Methods | Access | Reqs |
|---|---|---|---|
| `api/courses/[id]/quizzes/route.ts` | GET (role-shaped, paginated), POST | view / manage | FR-11, FR-31 |
| `api/quizzes/[id]/route.ts` | GET (manager: full; student/parent: `toStudentQuiz`), PATCH, DELETE | view / manage | FR-6, FR-9, FR-29, FR-31, NFR-1 |
| `api/quizzes/[id]/questions/route.ts` | POST | manage | FR-7, FR-10, FR-31 |
| `api/quizzes/[id]/questions/reorder/route.ts` | POST | manage | FR-7, FR-31 |
| `api/questions/[id]/route.ts` | PATCH, DELETE | manage | FR-7, FR-10, FR-31 |
| `api/quizzes/[id]/attempts/route.ts` | POST (start/resume) | STUDENT + view | FR-13, FR-19, FR-23, FR-32 |
| `api/attempts/[id]/route.ts` | GET | owner / linked parent / manager | FR-18, FR-21, FR-32, NFR-1 |
| `api/attempts/[id]/answers/[questionId]/route.ts` | PUT | owner | FR-15, FR-16, NFR-2 |
| `api/attempts/[id]/submit/route.ts` | POST | owner | FR-17 |
| `api/attempts/[id]/answers/[questionId]/grade/route.ts` | PUT | manage | FR-24, FR-25, FR-38 |
| `api/quizzes/[id]/regrade/route.ts` | POST | manage | FR-10, FR-38 |
| `api/quizzes/[id]/release-results/route.ts` | POST | manage | FR-20, FR-30, FR-38 |
| `api/quizzes/[id]/analytics/route.ts` | GET (`?format=csv` → `text/csv`) | manage | FR-26, FR-27 |
| `api/quizzes/[id]/accommodations/[studentId]/route.ts` | PUT | manage | FR-28, FR-38 |

Error mapping: CONFLICT (409) covers writing after the deadline, the edit lock, deleting with attempts, the attempt limit, and a quiz that isn't open. VALIDATION_ERROR (400) is for Zod failures. NOT_FOUND hides resources the user can't access (NFR-5, NFR-6).

### 3.4 Pages and UI: `src/app/(app)/...` (NFR-4: MUI only, mui-mcp lookup before each component)

| Route / file | Server/client | Contents | Reqs |
|---|---|---|---|
| `src/config/course-tabs.ts` | config | One entry, `{key:'quizzes', label:'Quizzes', href: id => /courses/${id}/quizzes, roles: ALL_ROLES}` | FR-11 |
| `courses/[courseId]/quizzes/page.tsx` + `CourseQuizzesView.tsx` | server + client | Teacher: DataTable (status, window, attempts, avg, Needs grading) + "New quiz". Student: four sections (Upcoming / Available now (Start/Resume) / Completed (score if visible) / Missed). Parent: completed results, read-only, per linked child. | FR-11, FR-33 |
| `courses/[courseId]/quizzes/new/page.tsx` | server | Creates a DRAFT quiz with defaults and redirects to edit (no separate form) | FR-6 |
| `courses/[courseId]/quizzes/[quizId]/edit/page.tsx` + `QuizBuilder.tsx`, `QuizSettingsPanel.tsx`, `QuestionList.tsx`, `QuestionEditor.tsx` | server + client | Settings (DateTimePicker, Switch, Select, TextField). The question list is a dnd-kit `SortableContext` of MUI Cards, with Up/Down buttons as the keyboard fallback. Each type has its own editor (options with a correct Radio/Checkbox, an accepted-answers list, guidance). A running points total. Publish button with `canPublish` errors. Lock banner + disabled controls when attempts exist, plus a Regrade button. Accommodations section (DataTable of enrolled students). The prompt uses MarkdownEditor + FileUpload with context `'quiz'`. | FR-6..FR-10, FR-28, FR-39, NFR-9 |
| `quizzes/[quizId]/take/page.tsx` + `QuizPlayer.tsx`, `useAutosave.ts` | server + client | Start screen (instructions, counts, points, limit, attempts used/allowed, ConfirmDialog on Start). The player has a sticky header (title, mm:ss timer from `deadlineAt`, red under 2 min, `aria-live="assertive"` announcing at 5:00 and 1:00), a Chip status pill, LinearProgress, and RadioGroup/FormGroup+Checkbox/TextField per type. Layout is all-on-one-page, or one question per page with a navigator Button grid (answered / unanswered / flagged; flags stored client-side only). Submit uses ConfirmDialog showing the unanswered count. `mode="preview"` is used by the builder. | FR-8, FR-12..FR-17, FR-19, NFR-3 |
| `quizzes/[quizId]/attempts/[attemptId]/page.tsx` | server | Result view built from `toStudentResult`: score, %, per-question correctness, response and feedback, plus correct answers/explanations if allowed. Otherwise it shows "Submitted — results will be available later." Also used by parents and teachers. | FR-20, FR-21 |
| `courses/[courseId]/quizzes/[quizId]/grade/page.tsx` + `QuizGradingWorkspace.tsx` | server + client | Tabs: By student / By question. Points TextField (step 0.5, max = question points) + feedback, with override allowed on auto-graded answers. | FR-24, FR-25 |
| `courses/[courseId]/quizzes/[quizId]/analytics/page.tsx` + `QuizAnalytics.tsx` | server + client | StatCards (attempts, avg, median, high, low, avg time), x-charts `BarChart` with 10 buckets, a per-question DataTable with option distribution (most-chosen wrong option highlighted), and a CSV link | FR-26, FR-27 |

Server pages call `requirePageRole` and the course/attempt access helpers before fetching (NFR-5). They pass only serializer output to client components (NFR-1).

**`useAutosave(attemptId, mode)` (FR-15, ADR-4).**
- Each question gets an 800 ms `setTimeout` debounce, then `PUT /answers/:questionId`.
- On network failure or 5xx, the latest response per question is written to the `localStorage['quiz-attempt:<id>']` map, and a 5 s `setInterval` drains it.
- A 409 stops the queue, clears storage and routes to the result page. A 2xx removes that key.
- The status pill reads `Saving…`, `All answers saved`, or `Offline — answers saved on this device` (shown when the queue is non-empty).
- On mount, any queued answers are merged over server answers before rendering, so a reload loses nothing (FR-19, AC-2).

### 3.5 Integrations into existing modules

| Existing file | Change | Reqs |
|---|---|---|
| `src/server/notifications/types.ts` | Add `quiz.published` (ACADEMIC, STUDENT, defaultEmail false) and `quiz.results_released` (ACADEMIC, STUDENT + PARENT, defaultEmail true, A5) | FR-29, FR-30 |
| `src/server/files/contexts.ts` | `register('quiz', quizResolver)`. The resolver allows a course manager, or a course viewer when the quiz is PUBLISHED (images sit only in prompts, which students already see) | FR-39, NFR-5 |
| `src/app/api/internal/email/dispatch/route.ts` | After `sendDueReminders(now)`, add `autoSubmitExpiredAttempts(now)` and `sendAfterCloseResultsReleased(now)`, each in its own try/catch + `logger.error`, on every call | FR-18, FR-30, FR-35 |
| `prisma/seed.ts` | Three seed quizzes, idempotent by (courseId, title). Scores are computed with `grading.ts` | FR-36 |
| `prisma/schema.prisma` + migration | §2 | FR-1, FR-19 |

---

## 4. Data Flow

### 4.1 Build and publish (FR-6..FR-9, FR-29)
1. Teacher opens New. The server creates a DRAFT quiz and redirects to `/edit`.
2. Settings and question edits go through PATCH/POST. Each is Zod-validated on both client and server, and question mutations pass the edit-lock check.
3. On Publish, the client sends `PATCH {status:'PUBLISHED'}`. The service runs `canPublish(questions)` and throws VALIDATION_ERROR with the list of problems if any. Otherwise it runs `updateMany({where:{id, status:'DRAFT'}, data:{status:'PUBLISHED'}})`.
4. If that update changed a row (count = 1), the service calls `notify('quiz.published')` for ACTIVE enrollees after commit (A9).

### 4.2 Start or resume (FR-12, FR-13, FR-19, FR-23, FR-28)
```
POST /api/quizzes/:id/attempts  (STUDENT)
  assertCanViewCourse → quiz PUBLISHED && availableFrom ≤ now < availableUntil, else CONFLICT
  existing IN_PROGRESS? → ensureNotExpired → still IN_PROGRESS ? return it (resume)
  count(attempts) ≥ attemptLimit(maxAttempts, accommodation.extraAttempts) → CONFLICT
  $transaction:
    id = cuid()                         // generated up front so the shuffle seed is known
    order = shuffleQuestions ? seededShuffle(questionIds, id) : questionIds by `order`
    deadlineAt = computeDeadline(now, timeLimitMinutes, accommodation.extraTimeMinutes, availableUntil)
    create {id, attemptNumber: count+1, questionOrder: order, deadlineAt, maxScore: Σ points}
  on P2002 (partial index or attemptNumber unique) → re-read IN_PROGRESS attempt and return it
→ toStudentAttempt(attempt, questions with seededShuffle(options, attempt.id) if shuffleOptions)
```
Option order isn't stored. It is recomputed from the `attempt.id` seed on every load, which makes it deterministic (FR-13). Two tabs get the same attempt id (FR-19).

### 4.3 Autosave hot path (FR-15, FR-16, NFR-2)
```
PUT /api/attempts/:id/answers/:questionId   body {response}
  1 query : attempt {studentId, status, deadlineAt, questionOrder}     (no Quiz/Question load)
  studentId ≠ user → NOT_FOUND;  questionId ∉ questionOrder → NOT_FOUND
  status ≠ IN_PROGRESS → CONFLICT
  now > deadlineAt + 30s → submitAttempt(id,{auto:true}); throw CONFLICT('Time is up')
  1 query : quizAnswer.upsert({attemptId_questionId}, {response})
→ { data: { questionId, savedAt } }      // no grading data (NFR-1)
```
The path is two indexed statements, well under the 50 ms budget at 300 concurrent students. It is idempotent, so localStorage replays are safe.

### 4.4 Submit, auto-submit and grading (FR-17, FR-18, FR-24, FR-25)
```
submitAttempt(attemptId, {auto}):   $transaction
  claimed = updateMany({id, status:'IN_PROGRESS'} → {status:'SUBMITTED', submittedAt: now, autoSubmitted: auto})
  claimed.count = 0 → return current attempt (already submitted: idempotent, race-safe)
  load questions + answers; for every questionId in questionOrder:
     answer missing → create {response:null}
     {pointsAwarded,isCorrect} = gradeAnswer(question, response)     // ESSAY → null,null; unanswered → 0,false
  recomputeAttempt(tx, attemptId)   → score = Σ, status = NEEDS_GRADING | GRADED
```
Callers:
- the submit POST (`auto:false`)
- the deadline branch of saveAnswer
- `ensureNotExpired` on GET attempt, start/resume, the player page and the teacher grade/list loads (FR-18, lazy)
- `autoSubmitExpiredAttempts` (FR-18, batch)

An unanswered ESSAY gets `pointsAwarded = 0` and still needs review: the A8 predicate keys on `gradedById`, so the teacher confirms it.

Manual grading:
1. `PUT …/grade` validates `points ≤ question.points` and `points % 0.5 = 0`, then sets `pointsAwarded`, `isCorrect = points == question.points`, `feedback` and `gradedById`.
2. It runs `recomputeAttempt`, which sets GRADED when nothing still needs review (FR-25), and writes `audit('quizAnswer.grade')` after commit (FR-38).
3. If the attempt became GRADED and the quiz is IMMEDIATELY, nothing is sent (FR-30).

### 4.5 Results visibility and notification (FR-20, FR-21, FR-30)
`resultsVisible(quiz, attempt, now)`:
- the attempt must be submitted
- **IMMEDIATELY**: true
- **AFTER_CLOSE**: `now ≥ availableUntil`
- **MANUAL**: `resultsReleasedAt != null`

Scores also need status GRADED to display a final score. A NEEDS_GRADING attempt shows "awaiting grading" for the pending questions.

- **MANUAL release:** `POST /release-results` runs `updateMany({id, resultsVisibility:'MANUAL', resultsReleasedAt:null} → now)`. If count = 1, it calls `notifyStudentAndParents` for students with a submitted attempt, then `audit('quiz.release_results')`. A repeat call is a no-op.
- **AFTER_CLOSE (maintenance):** `sendAfterCloseResultsReleased(now)` finds quizzes where `resultsVisibility = AFTER_CLOSE AND availableUntil ≤ now AND resultsReleasedAt IS NULL`. For each one it claims with `updateMany(... resultsReleasedAt: null → now)`, and only when count = 1 does it notify. That makes it idempotent across concurrent cron calls (A6, FR-35).
- **IMMEDIATELY:** no notification.

### 4.6 Maintenance (FR-18, FR-35)
`autoSubmitExpiredAttempts(now)` finds attempts with `status = IN_PROGRESS AND deadlineAt < now − 30s`, takes up to 200 per call, and runs `submitAttempt(id, {auto:true})` on each. The per-call cap keeps a cron tick bounded; the next tick and the lazy path cover any remainder.

### 4.7 Score export to PRD-11 (FR-22, FR-33)
`getStudentQuizScore(quizId, studentId)` returns `{score, maxScore, percent, isPractice, attemptsCounted} | null`, computed by `applyScoringPolicy` over GRADED attempts only. HIGHEST takes the max percent, LATEST takes the latest `submittedAt`, AVERAGE takes the Decimal mean, all with fixed2. It returns null when there are no GRADED attempts. There is no endpoint; PRD-11 imports it.

### 4.8 Analytics (FR-26, FR-27)
- **Input:** submitted attempts with their answers, aggregated in memory (class sizes are small).
- **Summary stats:** count, mean, median, max, min, and mean of `submittedAt − startedAt`.
- **Histogram:** 10 buckets by percent, with 100% placed in the last bucket.
- **Per question:** % with `isCorrect = true`, average `pointsAwarded`, and for choice types an option-id count, with the most-chosen wrong option marked.
- **CSV:** `toCsv` rows of student, attemptNumber, score, then one points column per question in quiz order.

---

## 5. Security and access (NFR-1, NFR-5)

| Actor | Can |
|---|---|
| ADMIN / course teacher | All manage routes for their courses, any attempt in those courses |
| STUDENT (ACTIVE enrolled) | List and take PUBLISHED quizzes; read and write **own** attempts; results only via `toStudentResult` |
| PARENT (linked to an enrolled student) | Read-only: completed results of linked children, only when `resultsVisible` |

- Student-path Prisma queries never `select` `correct` or `explanation`. The serializers add those fields back only when `resultsVisible && showCorrectAnswers` (defence in depth).
- The answer-PUT response carries no grading data.
- Inaccessible ids return NOT_FOUND, not FORBIDDEN, so their existence isn't revealed.
- Test: a serializer unit test walks the output recursively and asserts no `correct` key exists before visibility (AC-7).

---

## 6. Testing map (NFR-8, ADR-8)

| Level | Target | Reqs |
|---|---|---|
| Unit (Vitest, no DB) | `gradeAnswer` per type, incl. the FR-2 example ({A,B} → 0, {A} → 2) and `' Photosynthesis '`; `needsReview`; `computeDeadline` (timed, untimed, extra time, capped by availableUntil); `attemptLimit`; `applyScoringPolicy` ×3; `seededShuffle` determinism; `resultsVisible` ×3; `canPublish`; serializers (no `correct` key) | FR-3, FR-4, FR-13, FR-20, FR-22, FR-23, FR-9, NFR-1 |
| Integration (Vitest + test DB) | Autosave returns 409 after deadline + 30 s and the attempt is auto-submitted; GET auto-submits an expired attempt; regrade changes auto-graded answers but not manual ones; concurrent start returns one attempt; double submit is a no-op | FR-16, FR-18, FR-10, FR-19, FR-17 |
| E2E (Playwright, 1 spec) | Teacher builds a 4-question quiz (incl. an essay) and publishes it → student starts, answers, `page.reload()`, answers persist, submits → teacher grades the essay → student sees results. Includes an axe check on the player | NFR-8, NFR-3, FR-15 |

`npm run lint && npm run typecheck && npm test` must stay green. QA's banned-import scan covers NFR-4.

---

## 7. Requirements Traceability

| Req | Design element(s) |
|---|---|
| FR-1 | §2 migration `add_quizzes`; schema models/enums exactly per PRD; relations and indexes only |
| FR-2 | §3.2 `src/lib/validators/quiz.ts` |
| FR-3 | `grading.ts` `gradeAnswer` (choice rules, partial credit) |
| FR-4 | `grading.ts` `normalizeShortAnswer` + `needsReview`; manual override §4.4 |
| FR-5 | `gradeAnswer` ESSAY → null; `correct.guidance` server-only |
| FR-6 | `/edit` page, `QuizSettingsPanel`, `quizSettingsSchema` superRefine |
| FR-7 | `QuestionList` (dnd-kit + MUI), `QuestionEditor`, questions/reorder routes |
| FR-8 | Builder points total; `QuizPlayer mode="preview"` (A10) |
| FR-9 | `canPublish`; DRAFT→PUBLISHED conditional update §4.1 |
| FR-10 | Edit lock in `quiz-service`; `regradeQuiz`; `/regrade` route |
| FR-11 | `course-tabs.ts` entry; `listCourseQuizzes` role-shaped; `CourseQuizzesView`; A2 |
| FR-12 | `/quizzes/[quizId]/take` start screen + ConfirmDialog |
| FR-13 | `startOrResumeAttempt`, `seededShuffle`, `computeDeadline` §4.2 |
| FR-14 | `QuizPlayer` layout, navigator, sticky timer |
| FR-15 | `useAutosave` hook; answer PUT §4.3 |
| FR-16 | `saveAnswer` deadline + 30 s → auto-submit + CONFLICT |
| FR-17 | `submitAttempt` §4.4; submit route |
| FR-18 | `ensureNotExpired` (lazy) + `autoSubmitExpiredAttempts` §4.6 |
| FR-19 | Partial unique index §2; P2002 resume §4.2; localStorage merge on mount |
| FR-20 | `resultsVisible`; `releaseResults`; result page placeholder text |
| FR-21 | `toStudentResult`; result page |
| FR-22 | `getStudentQuizScore` + `applyScoringPolicy` §4.7 |
| FR-23 | `attemptLimit`; start CONFLICT §4.2 |
| FR-24 | `/grade` page, `QuizGradingWorkspace`, grade route |
| FR-25 | `recomputeAttempt` |
| FR-26 | `analytics.ts`; `/analytics` page; x-charts BarChart |
| FR-27 | Per-question stats; `analyticsCsv` via `toCsv` |
| FR-28 | `upsertAccommodation`; accommodations route; feeds `computeDeadline`/`attemptLimit`; A7 |
| FR-29 | `types.ts` `quiz.published`; notify on DRAFT→PUBLISHED (A9) |
| FR-30 | `types.ts` `quiz.results_released`; release + maintenance claim §4.5 (A6) |
| FR-31 | Quiz/question route files §3.3 |
| FR-32 | Attempt route files §3.3 |
| FR-33 | `isPractice` in `getStudentQuizScore`; A4 |
| FR-34 | Reuse `course-access.ts`; `access.ts` `assertCanAccessAttempt` |
| FR-35 | Two calls in `internal/email/dispatch/route.ts`; idempotent via status guard and claim |
| FR-36 | `prisma/seed.ts` three quizzes |
| FR-37 | No work: no sidebar entry (A1) |
| FR-38 | `audit()` in grade, regrade, release, accommodation service functions |
| FR-39 | MarkdownEditor/MarkdownView + FileUpload; `'quiz'` file context |
| NFR-1 | `serializers.ts`, student-path selects, serializer unit test §5 |
| NFR-2 | Composite PK upsert; 2-query hot path §4.3 |
| NFR-3 | Native MUI Radio/Checkbox; aria-live at 5/1 min; keyboard reorder fallback; axe in e2e |
| NFR-4 | MUI-only component list §3.4; mui-mcp lookup is a dev gate (ADR-7) |
| NFR-5 | requireUser/requirePageRole + course/attempt checks on every handler/page §5 |
| NFR-6 | `withHandler`/Zod/`ok`/`paginated`; error mapping §3.3; UTC + school tz display |
| NFR-7 | `src/server/quiz/` layout; reuse list §3.1; zero new deps |
| NFR-8 | Testing map §6 |
| NFR-9 | Builder defaults (SINGLE_CHOICE), Enter adds option, Duplicate, inline editing |
| NFR-10 | Scope fence §1.3 |
