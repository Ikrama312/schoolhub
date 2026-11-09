# Dev Log — SH-11 (PRD-11 Gradebook, Grading Scales & Report Cards)

> Before this run, this file held the SH-10 log and `task-completion-markers.json` held SH-10's markers. Following the established precedent, both were replaced for SH-11. This is SH-11's first dev iteration.
> `dev-rerun-count.json` was left untouched because the engine owns it.

## Iteration 1 (2026-11-09)

All 33 tasks in `implementation-plan.json` were implemented in dependency order, at the exact paths in `file-ownership-matrix.json`.

### Checklist
- TASK-1: Prisma schema + migration 20261111000000_add_gradebook (partial unique index grading_scale_one_default) — ✓ complete
- TASK-2: Zod validators src/lib/validators/gradebook.ts — ✓ complete
- TASK-3: Pure Decimal grade-calc.ts + unit matrix — ✓ complete
- TASK-4: term-placement.ts + unit tests — ✓ complete
- TASK-5: gradebook-sync.ts (item/grade sync + pure row builders) — ✓ complete
- TASK-6: Assignment hooks + categoryId in assignment validators — ✓ complete
- TASK-7: Quiz hooks (quiz-service, attempt-service, maintenance) + categoryId in quiz validators — ✓ complete
- TASK-8: Sync integration tests — ✓ complete
- TASK-9: Backfill module, CLI script, npm script, idempotency test — ✓ complete
- TASK-10: Batched loader load.ts — ✓ complete
- TASK-11: grade.posted / report_card.published notification types — ✓ complete
- TASK-12: Grading scales service + routes — ✓ complete
- TASK-13: Categories service + route — ✓ complete
- TASK-14: Gradebook service — ✓ complete
- TASK-15: Gradebook API routes — ✓ complete
- TASK-16: Student grades service + route — ✓ complete
- TASK-17: Report card snapshot + access — ✓ complete
- TASK-18: Report card service — ✓ complete
- TASK-19: Report card API routes — ✓ complete
- TASK-20: Report card integration tests — ✓ complete
- TASK-21: Course tabs, student tabs, navigation entries — ✓ complete
- TASK-22: Admin grading scales page + ScaleEditorDialog — ✓ complete
- TASK-23: Course gradebook settings page — ✓ complete
- TASK-24: Category Select in assignment and quiz editors — ✓ complete
- TASK-25: AddManualItemDialog, TermOverrideDialog, ItemStatsDialog — ✓ complete
- TASK-26: GradebookGrid (MIT DataGrid) + gradebook page — ✓ complete
- TASK-27: StudentGradesView + its three host pages — ✓ complete
- TASK-28: ReportCardDocument, PrintButton, single and bulk print pages — ✓ complete
- TASK-29: Admin report cards page — ✓ complete
- TASK-30: Homeroom list + review page — ✓ complete
- TASK-31: Student "Report cards" tab — ✓ complete
- TASK-32: Seed (scale, 7A categories, backfill, Oral presentation, S1 comments, 7A drafts) — ✓ complete
- TASK-33: Playwright gradebook.spec.ts + report-cards.spec.ts — ✓ complete

### Verification
| Check | Result |
|---|---|
| `npm run lint` | ✔ no warnings or errors |
| `npx tsc --noEmit` | ✔ clean |
| `next build` | ✔ |
| New unit tests (`tests/unit/gradebook/*`) | 21/21 pass. Includes the FR-15 golden case (78.0 C+), 89.95 → 90.0 → A-, AC-2, AC-5, AC-6, A8, A12 and tz day boundaries. |
| New integration tests (sync 8, backfill 1, report cards 5) against Postgres | 14/14 pass |
| Existing assignment/quiz integration suites after the hooks | pass. assignments was rerun 3× after fixing the race in bug 1 below. |
| Full `vitest run` | 402/409. 5 of the 7 failures are the pre-existing ones recorded by SH-9/SH-10: attendance-qa FR-22/FR-10, auth-forms, useToast, lockout, auth rate-limit. The other 2 are email-dispatch "stuck in SENDING" and qa-sh10 "autosave < 50 ms". Both pass when run on their own, twice. They are shared-DB / timing interference under the parallel full run, and neither imports gradebook code. |
| Playwright `gradebook.spec.ts` + `report-cards.spec.ts` on a prod build (port 3100) | 2/2 pass. The specs cover: keyboard edits (digits+Enter, E, M, Delete) → 78.0% C+, with 6 `grade.update` audit rows; admin generate → publish → 2 notifications; parent print view with sidebar, app bar and print button hidden under `print` media. |
| Seed | Against temporary 7A fixtures (MATH-7A/ENG-7A, 2 students), the seed creates: the scale, 3 categories per course, backfilled items (7) and grades (6), Oral presentation graded ×2, 4 S1 comment overrides and 2 DRAFT cards with snapshots. A rerun creates 0 items/grades. The fixtures were removed afterwards. The dev DB has no 7A courses, so `npm run db:seed` logs a skip, the same as the assignments/quizzes seeds. The "Standard A–F" default scale stays in the dev DB as seed data. |

### Bugs found and fixed during verification
1. **Concurrent `publishOnce` → duplicate item create.** The read path fires `publishOnce` fire-and-forget, and a second call raced it on `GradeItem.sourceId @unique`. This was caught by qa-sh9 under the full run. Item creation now uses `createMany({ skipDuplicates: true })`, and in `publishOnce` the upsert runs only for the notifiedAt claim winner.
2. **Grid edit wiped other cells.** In `processRowUpdate`, columns not present on the row object were read as "cleared", so entering the Exam score erased both HW scores (e2e showed 70.0 instead of 78.0). Only the edited field is now considered.
3. **Server page called a function exported from a `'use client'` module.** The roster warning text ("2 courses have ungraded items", "No teacher comment for X") is now computed in `listReportCards` (`warningText`).

### Decisions / deviations (for QA)
- **Migration:** generated with `prisma migrate diff --from-schema-datasource --to-schema-datamodel` (same reason as SH-10: the DB role can't create a shadow DB). The partial unique index was appended and the migration applied with `migrate deploy`. `db push` was not used.
- **MUI lookups (NFR-7):** mui-mcp was reachable. The x-data-grid docs (column groups, column menu) were fetched. mui-mcp serves 9.17 docs, so every prop used (`columnGroupingModel`, `processRowUpdate`, `onProcessRowUpdateError`, `isCellEditable`, `onCellKeyDown` + `defaultMuiPrevented`, `GridColumnMenu` slots/`displayOrder`, `hideMenu`, `hideFooter`) was also checked against the installed 9.5.0 `.d.ts`. No pinned columns are used.
- **Grid editing:** the grid uses the DataGrid's built-in numeric edit cell (digits start editing, Enter/Tab commit and move, blur commits) instead of a custom `renderEditCell`. E / M / Delete are handled in `onCellKeyDown` in view mode. Saves are optimistic, with rollback and a per-cell error outline and tooltip.
- **Lists use DataGrid directly** for scales and the admin report-card roster, not the shared `DataTable`. `DataTable` is URL/server-paginated and has a search box, which doesn't suit complete client-side lists. The contract requires the roster to be unpaginated for "Publish all".
- **A7 visibility transitions:** `upsertItemFromAssignment/Quiz(db, id, { wasVisible })`. The hook passes the source's pre-write visibility, so plain edits never touch `isVisible`.
- **Quiz hooks run after commit and never throw** (logged), like `notify()`. Assignment hooks run inside the caller's transaction, so `gradeSubmission`, `bulkReturn`, `gradeOffline`, `setExemption` and archive are now transactions.
- **`syncQuizGrade`** sets the score back to null if a regrade leaves the student with no GRADED attempt.
- **Snapshot builder signature** gained a `term` argument. The design listed 6 args, but the v1 shape needs term name/dates/year.
- **Report card comment edits** are audited as `reportCard.comment`. Generation is audited as `reportCard.generate`. Both are extras beyond NFR-4.
- **`/report-cards` for ADMIN** redirects to `/admin/report-cards`.
- **Manual item date** is chosen with a DatePicker and stored as 23:59 school-local on that day.
- **Out of scope noted, not built:** the optional perf integration test (35×80 < 800 ms, 600×8 < 30 s) listed as "optional, CI-skippable" in system-design §6 isn't in the plan's file list.
