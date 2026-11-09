# Tech Stack Decisions: PRD-11 Gradebook, Grading Scales & Report Cards

Ticket: SH-11 · Phase: architect (arch-research-stack) · Timestamp: 2026-11-09T13:00:00Z · Status: complete

**Base stack (checked against the workspace).** `artifacts/intake/tech-stack.json` reports `react` at 100% confidence, and `package.json` matches it: Next.js 14.2.18 App Router, React 18.3.1, TypeScript strict, Prisma 5.20.0 (`@prisma/client` 5.20.0) on PostgreSQL 16, Zod 3.23.8, papaparse ^5.4.1, tsx 4.16.2, MUI 9.5.0 (material, icons-material, material-nextjs, x-data-grid, x-date-pickers, x-charts), `@mui/x-internals` overridden to 9.1.0, Vitest 2.1.1 and Playwright 1.47.2.

Intake reported no blockers (`handoff-to-architect.json`, `blockers: []`, confidence 95%). No NFR pushes toward a different stack:

- **NFR-2** (35×80 gradebook in under 800 ms): three indexed queries (items, grades, enrolments), then the pure calculation in memory.
- **NFR-3** (600 students × 8 courses in under 30 s): batch loading per course and term, then in-memory calculation.
- **NFR-11** (A4 print): CSS `@media print`.

None of these needs a cache, a queue, a PDF engine or a grid library. **Overall decision: keep the stack and add no dependencies (NFR-7, NFR-9).**

---

## ADR-1: Keep the existing stack and add no dependencies

**Context.** NFR-9 forbids re-scaffolding and requires reuse of existing code. NFR-7 limits UI to MUI 9.5.0 and MUI X. Every capability PRD-11 needs is already installed or already in the repo.

**Decision.** Add nothing to `dependencies` or `devDependencies`. Map each need to something that already exists:

| Need | Use | Req |
|---|---|---|
| Grade maths | `Decimal`, `dec`, `fixed2` from `src/server/assignments/grading-math.ts` (Prisma.Decimal). Import them; don't copy them. | FR-10–FR-15, NFR-1 |
| Validation | Zod schemas in `src/lib/validators/gradebook.ts`, shared by the client forms and the route handlers | FR-16, FR-17, FR-39, FR-40 |
| Gradebook grid | `DataGrid` from `@mui/x-data-grid` (MIT), used directly (see ADR-4) | FR-18–FR-21, FR-24, NFR-8 |
| Admin lists (scales, report cards) | Existing `src/components/DataTable` | FR-16, FR-29 |
| Band and category editors | MUI `TextField`, `Select`, `Autocomplete`, `Dialog` | FR-16, FR-17, FR-22, FR-23 |
| Date and term inputs | `@mui/x-date-pickers` `DatePicker` | FR-22 |
| CSV export | `toCsv` from `src/server/csv.ts` | FR-25 |
| Quiz score | `applyScoringPolicy` + `resultsVisible` from `src/server/quiz/grading.ts` (see ADR-6) | FR-7 |
| Access control | `assertCanViewCourse` / `assertCanManageCourse` (`src/server/auth/course-access.ts`) and `assertCanViewStudent` / `getAccessibleStudentIds` (`src/server/auth/student-access.ts`) | FR-37, FR-39, FR-42, NFR-6 |
| Term attendance summary | Reuse the `attendance-service.ts` groupBy aggregation, run once per term for the filtered students | FR-30, NFR-3 |
| Timezone date rules | `schoolToday` (`src/server/attendance/attendance-rules.ts`) with `SchoolSettings.timezone` | FR-3, FR-10, FR-24, NFR-10 |
| Notifications and audit | `notify()` (`src/server/notifications/notify.ts`, types in `types.ts`) and `audit()` (`src/server/audit.ts`) | FR-34, FR-38, NFR-4 |
| Confirmations and toasts | Existing `ConfirmDialog` and `Toast`/`useToast` | FR-34, NFR-7 |
| Printing | `@media print` + `window.print()` | FR-35, NFR-11 |
| Backfill runner | `tsx` (already a devDependency) | FR-8 |

**Consequences.** `package.json` changes only by one script (ADR-7). There's no lockfile churn or license review, and nothing new for QA's banned-import scan. Every UI component still has to be looked up via mui-mcp before use (NFR-7).

---

## ADR-2: Store grades as Prisma `Decimal` and calculate in pure functions

**Context.** NFR-1 requires Decimal arithmetic and pure, unit-tested calculation. FR-13 rounds half-up at band edges (89.95 → 90.0), which floating point can get wrong. FR-15 must reproduce 78.0% C+ exactly.

**Decision.**
- Make `Grade.score`, `GradeItem.maxPoints`, `GradeCategory.weight`, `GradingScale` band `minPercent` and `TermGradeOverride.percent` `Decimal` columns, with precision set by the FR-1 schema spec.
- Put `src/server/gradebook/grade-calc.ts` on plain inputs only: items, grades, categories, scale, override and `now`. It does no Prisma I/O, and it computes everything in `Decimal`.
- Round the course percent once, at the end, with `toDecimalPlaces(1, Decimal.ROUND_HALF_UP)`, then do the band lookup (FR-13).
- Convert to `number` or `string` only at the serializer boundary.

**Consequences.** Calculation is deterministic and the Vitest matrix (NFR-1, NFR-12) needs no database. NFR-3 follows from this: batched loading feeds the same pure function. Callers must not round category percents before weighting, because only the final value is rounded.

---

## ADR-3: Store grading scale bands as a JSON column validated by Zod

**Context.** FR-1 says "exactly as specified". FR-16 validates bands as a set: strictly descending, lowest minimum 0, unique letters. Bands are always read and written together with their scale, and nothing queries a band on its own.

**Decision.** Follow the PRD's `GradingScale` model as written. If it defines bands as `Json`, keep them as a JSON array of `{ letter, minPercent, gpa?, descriptor? }`. Treat the array as one unit and validate it with a single Zod schema in `gradebook.ts`. Enforce "exactly one default" in a service transaction that clears the old default when a new one is set. Add a partial unique index (`WHERE "isDefault"`) in the migration SQL as a backstop.

**Consequences.** The band editor saves in one write, and the scale reaches `grade-calc.ts` with no join. GPA is stored only and never computed (NFR-13). If the PRD's FR-1 instead specifies a separate band table, use it; this ADR then reduces to "validate as a set in Zod".

---

## ADR-4: Build the gradebook on MIT `DataGrid` directly, not the `DataTable` wrapper

**Context.** FR-18 to FR-21 and FR-24 need `columnGroupingModel`, `processRowUpdate`, custom edit cells, column menu items, row virtualisation (60×120) and a sticky header. NFR-8 forbids Pro and Premium features, so there are no pinned columns. The existing `DataTable` wraps `DataGrid` for URL-paginated, searchable server lists, and its props don't expose grouping or editing.

**Decision.**
- Use `<DataGrid>` from `@mui/x-data-grid` in a new `src/components/gradebook/GradebookGrid.tsx`.
- Keep the default row and column virtualisation, and turn off pagination (`hideFooterPagination`).
- Handle keyboard input (digit, E, M, Delete, Enter or arrow keys) in a custom `renderEditCell` and `onCellKeyDown`, then commit through `processRowUpdate` and `onProcessRowUpdateError` for per-cell error state.
- Before writing, confirm every prop against the v9.5.0 docs through mui-mcp (`useMuiDocs`/`fetchDocs`). This is intake's FR-20 risk.

**Consequences.** One consumer of raw `DataGrid` is justified by needs `DataTable` doesn't cover. Admin lists still use `DataTable` (FR-16, FR-29). Without pinned columns, the student-name column scrolls away horizontally, which the PRD accepts ("sticky header, no pinned columns").

---

## ADR-5: Sync with direct service calls inside existing transactions, not events or a queue

**Context.** FR-3 to FR-7 must react to publish, unpublish, archive, delete, return, exemption and quiz-graded events. NFR-5 needs Grade rows to never hold scores that haven't been released. The repo has no event bus. Its only background process is `worker:email`, and it's out of scope.

**Decision.** Add `src/server/gradebook/sync.ts` with idempotent upserts keyed on `(source, sourceId)` and `(gradeItemId, studentId)`. Call it from the existing assignment, quiz, submission-return and exemption services, inside their existing `prisma.$transaction` when there is one.
- Saving a grade without returning it doesn't call sync (FR-5).
- Practice quizzes return early (`Quiz.isPractice`).
- An item with no matching term is skipped and logged with `logger.warn` (intake assumption, FR-3).

**Consequences.** Sync can't drift out of step with the source write. Scores are written only on return or visibility, so privacy holds at the storage layer as well as in serializers. Each hook adds a few ms to the source write, which is fine at this scale. The backfill (ADR-7) reuses the same functions.

---

## ADR-6: Create `getStudentQuizScore` from the existing quiz grading helpers

**Context.** FR-7 names `getStudentQuizScore`, but it doesn't exist. `src/server/quiz/grading.ts` already exports `applyScoringPolicy(policy, attempts)`, which returns `{ score, maxScore, percent }` as fixed2 strings, `resultsVisible(quiz, attempt, now)` and `percentOf`.

**Decision.** Add `getStudentQuizScore(quiz, gradedAttempts, now)` next to these helpers in `src/server/quiz/grading.ts`. It filters attempts to GRADED and results-visible, calls `applyScoringPolicy` and returns `score / maxScore × quiz.maxScore` as `Decimal`, or `null`. Sync stores that value as `Grade.score` against `GradeItem.maxPoints = quiz.maxScore`.

**Consequences.** There's one source of truth for the quiz score policy, and PRD-10's helpers stay unchanged. When a quiz uses `AFTER_CLOSE` or `MANUAL` visibility, sync has to run again when results become visible. That means at close and on release; dev-planning should hook the release action. Otherwise the score fills in at backfill or at the next attempt event.

---

## ADR-7: Run the backfill as a `tsx` script that reuses sync

**Context.** FR-8 requires an idempotent `npm run gradebook:backfill`, and the seed must call it. NFR-12 needs an idempotency integration test.

**Decision.** Add `scripts/gradebook-backfill.ts`, which exports `backfill()` and has a CLI entry point. The script is a loop over existing published assignments, non-practice quizzes, returned submissions, visible graded attempts and exemptions, calling the ADR-5 sync functions. Add one script line to `package.json`: `"gradebook:backfill": "tsx scripts/gradebook-backfill.ts"`. `prisma/seed.ts` imports and calls `backfill()` (FR-41).

**Consequences.** Idempotency comes from the upsert keys, so there's no "already ran" flag. It follows the `worker:email` pattern. Running it twice gives identical row counts, which is the test assertion.

---

## ADR-8: Freeze report cards as a JSON snapshot on the row

**Context.** FR-30 lists a fixed set of snapshot fields. FR-31 and AC-8 need PUBLISHED cards to stay unchanged when grades are edited or cards are regenerated. NFR-3 requires generating 600 × 8 in under 30 s.

**Decision.**
- Store `ReportCard.snapshot` as `Json` (per the FR-1 model), typed by a Zod schema in `src/server/report-cards/`.
- Generation batch-loads per term and does no per-student queries:
  - courses and enrolments for the filtered students
  - items, grades, categories and overrides for those courses
  - the scale
  - one attendance groupBy for the term range
- Run `grade-calc.ts` in memory, then `createMany` new cards and `update` existing ones, always filtered with `where: { status: 'DRAFT' }`.
- Nothing in `src/server/gradebook/` writes to `ReportCard`.

**Consequences.** The print view and student tab read only the snapshot, which is fast and immutable. Unpublishing returns a card to DRAFT, and the next generation can then refresh it (FR-34, with an audit entry). Snapshot JSON is not queryable, which is fine because nothing filters on it.

---

## ADR-9: Build the print view with CSS, not a PDF library

**Context.** FR-35 and NFR-11 need A4 portrait pages, a letterhead, signature lines, a hidden app sidebar and page breaks for "Print all". The intake stack notes say no PDF library is needed.

**Decision.** Render `/report-cards/[id]/print` and the bulk print route as server components. Use MUI `Table` and `Typography` styled through `sx` and theme `GlobalStyles` with `@page { size: A4 portrait }` and `@media print` rules that hide the app shell (sidebar, app bar, buttons). Add `break-after: page` per card. A small client `Button` calls `window.print()`.

**Consequences.** There's no new dependency and no server-side rendering farm, and "Save as PDF" is the browser's own feature. Print fidelity depends on the browser. The Playwright test (NFR-12) checks the print media, not PDF bytes.

---

## ADR-10: Compare dates in the school timezone

**Context.** NFR-10 says the school timezone is the reference for date rules. Intake's assumption is that "past due" means `now > dueAt`, compared as an exact instant.

**Decision.** Compare past-due status as a UTC instant (`now > dueAt`). This applies to FR-10 missing items and the FR-24 "mark all missing" action. For term containment (FR-3), convert `dueAt` or `availableUntil` to a school-local date with `schoolToday(date, tz)` and compare it with the term's `startDate` and `endDate`. Show all dates through the existing `DateDisplay` component in `SchoolSettings.timezone`.

**Consequences.** Reusing the same helper as attendance avoids off-by-one-day errors at term boundaries. No date library is added.
