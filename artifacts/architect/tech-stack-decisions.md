# Tech Stack Decisions: PRD-10 Quizzes & Online Exams

Ticket: SH-10 · Phase: architect (arch-research-stack) · Timestamp: 2026-11-09T12:30:00Z · Status: complete

**Base stack (confirmed against the workspace).** `artifacts/intake/tech-stack.json` reports `react` at 100% confidence, and `package.json` matches it: Next.js 14.2.18 App Router, React 18.3.1, TypeScript strict, Prisma 5.20.0 on PostgreSQL 16, Auth.js (next-auth 5.0.0-beta.25), Zod 3.23.8, MUI 9.5.0 (material, icons-material, material-nextjs, x-data-grid, x-date-pickers, x-charts), `@mui/x-internals` overridden to 9.1.0, @dnd-kit/core 6.3.1 + @dnd-kit/sortable 10.0.0, Vitest 2.1.1 and Playwright 1.47.2.

Intake reported no blockers (`handoff-to-architect.json`, `blockers: []`). None of the NFRs pushes toward a different stack. NFR-2 (300 concurrent autosaves, <50 ms) is one indexed upsert per request, well within what Postgres handles. FR-15 calls this "offline", but it only means a localStorage retry queue, not offline-first sync. Nothing is realtime: the timer is display-only (FR-16). **Overall decision: keep the stack and add no dependencies (NFR-7).**

---

## ADR-1: Keep the existing stack and add zero dependencies

**Context.** NFR-7 forbids new dependencies and re-scaffolding. NFR-4 allows only MUI v9.5.0 and MUI X for UI. Every capability PRD-10 needs is already installed or already in the repo.

**Decision.** Add nothing to `dependencies` or `devDependencies`. Use the following:

| Need | Use | Req |
|---|---|---|
| Score maths | `dec` / `fixed2` / `Decimal` from `src/server/assignments/grading-math.ts` (Prisma.Decimal). Import them; don't copy them. | FR-3, FR-22, FR-25, NFR-7 |
| Validation | Zod schemas in `src/lib/validators/quiz.ts`, shared by the client forms and the route handlers | FR-2, NFR-6 |
| Question reorder | @dnd-kit/sortable with MUI list items. Up/Down buttons are the keyboard fallback. | FR-7, NFR-3 |
| Availability window inputs | `@mui/x-date-pickers` `DateTimePicker` | FR-6 |
| Score histogram | `@mui/x-charts` `BarChart` (first use in `src/`; look it up via mui-mcp) | FR-26, NFR-4 |
| Attempts and grading tables | Existing `src/components/DataTable` (x-data-grid) | FR-11, FR-24, FR-27 |
| Markdown prompts and images | Existing `MarkdownEditor`, `MarkdownView`, `FileUpload` | FR-39 |
| CSV export | `toCsv` from `src/server/csv.ts` | FR-27 |
| Confirmations and toasts | Existing `ConfirmDialog`, `Toast`/`useToast` | FR-12, FR-17, NFR-7 |
| Notifications and audit | `notify()` and `audit()` | FR-29, FR-30, FR-38 |
| Debounce and retry | `setTimeout`/`setInterval` in one small client hook (no lodash) | FR-15 |

**Consequences.** The lockfile doesn't change. Anything dev reaches for outside this table is a scope smell. The existing ESLint `no-restricted-imports` banned-library rule still guards NFR-4.

---

## ADR-2: Data model in one Prisma migration, with a partial unique index in raw SQL

**Context.** FR-1 adds 5 enums and 5 models. FR-19 requires at most one IN_PROGRESS attempt per (quiz, student), and `@@unique` can't express that because it is conditional on status. Intake's key-risks list calls out the race. The repo already has a precedent: `20261107000000_attendance/migration.sql` hand-adds `CREATE UNIQUE INDEX ... WHERE ...`, and `schema.prisma` notes this in a comment.

**Decision.**
- Create a single migration (`prisma migrate dev --create-only`, then edit it), for example `20261110000000_add_quizzes`. Run it after `20261109000000_add_assignments`.
- In `schema.prisma`, add `@@unique([quizId, studentId, attemptNumber])` on QuizAttempt and `@@id([attemptId, questionId])` (or `@@unique`) on QuizAnswer. The QuizAnswer key is what makes the NFR-2 upsert a single statement.
- In the migration SQL, add `CREATE UNIQUE INDEX "quiz_attempt_one_in_progress_uq" ON "QuizAttempt"("quizId","studentId") WHERE "status" = 'IN_PROGRESS';`. Add a schema comment pointing to it, as the attendance comment does.
- Start-or-resume (FR-19, FR-23, FR-32) runs in a `prisma.$transaction`. On a P2002 unique violation, re-read and return the existing IN_PROGRESS attempt. No advisory locks.
- Store all points and scores as `Decimal` columns. All timestamps are `timestamptz`/UTC (NFR-6).

**Consequences.** The database enforces race safety, so two tabs both clicking Start get the same attempt. `prisma db push` would drop the partial index, so dev and CI must use `migrate`. That is already the norm.

---

## ADR-3: Grading and deadline logic as pure functions in `src/server/quiz/`

**Context.** NFR-8 requires unit tests for every grading rule, the deadline maths with accommodations, and the scoring policies. NFR-7 sets the `src/server/<feature>/` layout (PRD-05/09 precedent).

**Decision.** Use plain TypeScript modules with no Prisma imports in the pure files:
- `grading.ts`: `gradeAnswer(question, response)` for SINGLE/TRUE_FALSE all-or-nothing, MULTIPLE_CHOICE partial credit `points × max(0,(c−i)/totalCorrect)`, SHORT_ANSWER normalise and match (trim, collapse whitespace, optional case folding), and ESSAY returns `needsReview` (FR-3, FR-4, FR-5).
- `deadline.ts`: `computeDeadline(startedAt, timeLimitMinutes, extraTimeMinutes, availableUntil)` returns min(start + limit + extra, availableUntil). An untimed quiz returns availableUntil (FR-13, FR-28).
- `scoring.ts`: `applyScoringPolicy(policy, gradedAttempts)` for HIGHEST/LATEST/AVERAGE (FR-22).
- `shuffle.ts`: a deterministic seeded shuffle with a small inline PRNG (mulberry32) seeded from a hash of the attempt id. No dependency (FR-13).
- `quiz-service.ts` / `attempt-service.ts` do the Prisma I/O and call the pure functions.

**Consequences.** The NFR-8 unit tests run in Vitest with no database. Regrade (FR-10) is just a loop over these functions. The shuffle stays reproducible for the life of an attempt.

---

## ADR-4: The server owns the deadline, and the autosave path stays one query

**Context.** NFR-2 sets the autosave budget at under 50 ms for 300 concurrent students. FR-16 makes the server the authority on the deadline (30 s grace, 409 after it). FR-18 auto-submits lazily on load.

**Decision.**
- `PUT /api/attempts/:id/answers/:questionId` reads only the QuizAttempt row (`studentId`, `status`, `deadlineAt`). It then does one `quizAnswer.upsert` on the composite key. If `now > deadlineAt + 30s`, it auto-submits and throws `AppError('CONFLICT')`; `src/server/http.ts` already maps CONFLICT to 409. It never loads the quiz or the questions on this path.
- Lazy auto-submit runs in a shared `ensureNotExpired(attempt)` called by GET attempt, the player page and the teacher views. The maintenance run calls `autoSubmitExpiredAttempts()` (ADR-6).
- The client timer derives its value from the `deadlineAt` the server returns. It never counts down from local start time.
- Autosave client: one hook with an 800 ms debounce, a failed-save queue in localStorage keyed by attempt id, and a 5 s retry interval (FR-15). The localStorage pattern already exists in `attendance/take/RegisterForm.tsx` and `SubmissionPanel.tsx`.

**Consequences.** Clock skew or a tampered client can't extend an attempt. The hot path stays at about 2 queries per save. No WebSockets or SSE are needed.

---

## ADR-5: A dedicated student serializer is the only shape students receive

**Context.** NFR-1: `correct`, `explanation` and scores must never reach a student's browser before results are visible. AC-7 and NFR-8 require a unit test that asserts the `correct` key is absent.

**Decision.** `src/server/quiz/serializers.ts` exports `toStudentQuiz`, `toStudentAttempt` and `toStudentResult`. Each builds its output by explicit allow-listing, never by spreading and deleting fields. Prisma `select` excludes `correct` and `explanation` on student code paths. `resultsVisible(quiz, attempt, now)` is a single pure function that decides IMMEDIATELY / AFTER_CLOSE / MANUAL (FR-20). It gates scores, and when `showCorrectAnswers` is set, it also gates correct answers and explanations (FR-21). Server components pass only serializer output to client components.

**Consequences.** One place to audit and test. The parent read-only views (FR-11, NFR-5) reuse `toStudentResult`.

---

## ADR-6: Background work goes through the existing maintenance dispatcher, with no new job runner

**Context.** FR-18, FR-30 and FR-35 need periodic auto-submit and a one-time AFTER_CLOSE results notification. `src/app/api/internal/email/dispatch/route.ts` already runs `sendDueReminders()` on every cron request, in its own try/catch.

**Decision.** Add two calls next to `sendDueReminders()`, each in its own try/catch with `logger`, following the same pattern:
- `autoSubmitExpiredAttempts(now)`: updates rows where `status = 'IN_PROGRESS' AND deadlineAt + 30s < now`. It is idempotent because of the status guard.
- `sendAfterCloseResultsNotifications(now)`: for closed AFTER_CLOSE quizzes. It is made idempotent by an atomic claim, either a nullable `resultsNotifiedAt` column on Quiz claimed with `updateMany ... where resultsNotifiedAt IS NULL` or a unique notification marker like `AssignmentReminder`. arch-design-system picks one. The `resultsNotifiedAt` column is the smaller change.

No BullMQ, no cron library, no `setInterval` on the server.

**Consequences.** Lazy auto-submit (ADR-4) covers attempts between cron ticks. The maintenance run is a backstop, so its frequency doesn't affect correctness.

---

## ADR-7: UI is MUI-only, and the mui-mcp lookup is a hard gate

**Context.** NFR-4 bans non-MUI UI libraries, allows styling only via theme, `sx` and `styled()`, and requires every component to be looked up through mui-mcp (useMuiDocs → fetchDocs). An unreachable MCP is a blocker. NFR-3 requires native radio/checkbox inputs and `aria-live` timer announcements.

**Decision.** Player: `RadioGroup`/`Radio`, `FormGroup`/`Checkbox`, `TextField` (multiline for essays, with a 10,000-character counter), `LinearProgress`, a navigator grid of `Button`s, and a sticky header built with `AppBar position="sticky"` or `Box` + `sx`. Timer: a `Typography` with an `aria-live="assertive"` region that announces only at 5 and 1 minutes and turns `error.main` under 2 minutes (FR-14, NFR-3). Status pill: `Chip`. Builder: `Accordion` or `Card` items in a dnd-kit `SortableContext`. Analytics: x-charts `BarChart` and `DataTable`. Dev must look up each component in mui-mcp before using it. If the MCP is unreachable, dev records a blocker and does not guess.

**Consequences.** QA's banned-import and resolvable-MUI-import checks (NFR-4) pass by construction. Dev's first use of x-charts needs the docs lookup, because `src/` has no existing usage to copy.

---

## ADR-8: Testing uses only the existing toolchain

**Context.** NFR-8 requires unit tests, integration tests and one Playwright e2e, and `npm run lint && typecheck && test` must stay green.

**Decision.**
- Unit tests in Vitest: grading.ts, deadline.ts, scoring.ts, shuffle.ts determinism, serializers (absence of the `correct` key) and `resultsVisible`.
- Integration tests in Vitest against the test database, using the existing harness: autosave returns 409 after deadline + grace, auto-submit on load, regrade, and a concurrent start returning one attempt (ADR-2).
- One e2e in Playwright: teacher builds a 4-question quiz, student takes it with a mid-attempt `page.reload()`, teacher grades the essay, student sees results.

**Consequences.** No new test tooling. The seed data (FR-36) gives the e2e and manual QA a ready-made state.

---

## Out of scope (NFR-10)

No lockdown browser, proctoring, question banks or LaTeX, so there is no evaluation of KaTeX/MathJax or media-capture libraries.
