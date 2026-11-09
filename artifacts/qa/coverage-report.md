# Coverage Report — SH-11 (PRD-11 Gradebook, Grading Scales & Report Cards)

- ticketId: SH-11
- timestamp: 2026-11-09T14:29:37Z

> This file replaces the stale SH-10 coverage report.

## Method

No coverage instrumenter is installed (`@vitest/coverage-v8` is not a dependency), and QA did not add one. Coverage is therefore mapped by hand: for each new or changed module, the tests that exercise it **and were run by QA in this phase**.

## Tests run by QA

| Suite | Tests | Result |
|---|---|---|
| `tests/unit/gradebook/grade-calc.test.ts` (Dev) | 17 | ✅ pass |
| `tests/unit/gradebook/term-placement.test.ts` (Dev) | 4 | ✅ pass |
| `tests/unit/gradebook/validators.test.ts` (**QA, new**) | 4 | ✅ pass |
| `tests/integration/gradebook/gradebook-sync.test.ts` (Dev) | 8 | ✅ pass (Postgres) |
| `tests/integration/gradebook/backfill.test.ts` (Dev) | 1 | ✅ pass (Postgres) |
| `tests/integration/report-cards/report-cards.test.ts` (Dev) | 5 | ✅ pass (Postgres) |
| `tests/integration/gradebook/qa-sh11.test.ts` (**QA, new**) | 7 | ✅ pass 3/3 runs (Postgres) |
| `tests/e2e/gradebook.spec.ts` (Dev, Playwright, fresh prod build :3100) | 1 | ✅ pass |
| `tests/e2e/report-cards.spec.ts` (Dev, Playwright, fresh prod build :3100) | 1 | ✅ pass |
| **SH-11 total** | **48** | **48/48** |

Integration tests are skipped without `TEST_DATABASE_URL`. QA ran them with `TEST_DATABASE_URL=$DATABASE_URL`, after confirming with `prisma migrate status` that the schema is up to date.

## Per-module coverage

| Module | Covered by | Coverage | Gaps |
|---|---|---|---|
| `src/server/gradebook/grade-calc.ts` | grade-calc unit (17), qa-sh11, e2e | **High.** Every exported function is tested: no categories, empty categories, drop lowest, never-drop-all, missing vs ungraded vs excused, hidden, strict due boundary, rounding at band edges (89.95→90.0 A−, 76.95→77.0 C+), letter-only / percent-only / both overrides, colour bands | `applyDropLowest` tie-breaks (equal ratios → dueAt → id) are not asserted |
| `src/server/gradebook/term-placement.ts` | term-placement unit (4) | **High** | — |
| `src/lib/validators/gradebook.ts` | validators unit (QA), qa-sh11 (via `.parse`) | **Medium-high.** Covers band rules, weight sum, unique category names, the 1,000-character comment cap | `reportCardPatchSchema`, `unpublishSchema` are only covered indirectly by report-cards integration |
| `src/server/gradebook/gradebook-sync.ts` | gradebook-sync (8), backfill, qa-sh11 | **High.** Covers assignment publish/draft/archive/delete, return vs save, exemption on/off, A7 hide-survives-resave, quiz IMMEDIATELY / MANUAL / AFTER_CLOSE, practice | `assertCategoryInCourse` rejection (foreign category) is not asserted; the no-term skip path (A6) is only unit-covered via `termFor` |
| `src/server/gradebook/backfill.ts` + `scripts/gradebook-backfill.ts` | backfill (1) | **Medium.** Idempotency is proven | The CLI wrapper (18 lines) is untested |
| `src/server/gradebook/load.ts` | qa-sh11, report-cards, e2e | **High** (indirect) | — |
| `src/server/gradebook/gradebook-service.ts` | qa-sh11 (7), e2e | **Medium-high.** Covers getGradebook (sort, result, 35×80 perf), createManualItem, putGrade (manual, synced-comment-only, out-of-course teacher, student refused, audit, grade.posted once), updateItem (synced reject / hide), markAllMissing (before / after due), putTermOverride (letter-only, unknown letter, audit) | `exportGradebookCsv` (FR-25), `deleteItem`, `updateItem` maxPoints-below-existing-score guard |
| `src/server/gradebook/categories-service.ts` | qa-sh11 | **Medium.** Covers the weights≠100 reject and a valid replace | Foreign-id reject, gradingScaleId change |
| `src/server/gradebook/scales-service.ts` | — (validators only) | **Low.** The service is untested. QA did not exercise create/update/delete, because those would flip the school default in the shared dev DB | Admin-only guard, default swap, A11 delete conflicts. The DB invariant is enforced by the partial unique index `grading_scale_one_default` (present in the DB) |
| `src/server/gradebook/student-grades-service.ts` | qa-sh11, e2e (parent) | **High.** Covers student and parent views, hidden item excluded, unreturned score null, other student / unlinked parent refused | — |
| `src/server/report-cards/report-card-service.ts`, `snapshot.ts`, `access.ts` | report-cards integration (5), report-cards e2e | **High.** Covers generate, roster warnings, draft hidden from family, comment field rules, publish + notifications, 7B NOT_FOUND, snapshot immutability, regenerate skips PUBLISHED, unpublish with reason | NFR-3 (600×8 < 30 s) is not load-tested |
| `src/server/assignments/assignments-service.ts` (hooks) | gradebook-sync, existing assignment suites | **High** | See qa-report Headline 1: `publishOnce` change made `qa-sh9` flaky |
| `src/server/quiz/*` (hooks) | gradebook-sync (3 quiz tests), existing quiz suites | **High** | — |
| `src/server/notifications/types.ts` | qa-sh11 (grade.posted), report-cards (report_card.published) | **High** | — |
| API route handlers (`src/app/api/**`, 17 files, 9–19 lines each) | e2e (gradebook PUT grades, report-card generate/publish/GET) | **Low-medium.** Handlers are thin (validator → service) | No HTTP-level tests for grading-scales, grade-categories, term-overrides, mark-missing, students/:id/grades |
| UI: `GradebookGrid.tsx` | gradebook e2e | **Medium.** Covers keyboard edit (digits+Enter, E, M, Delete), 78.0% C+ | Column menu (hide/show, mark missing, stats), Export CSV button, synced-cell click-through, Add item / Override dialogs |
| UI: `ReportCardDocument.tsx`, `PrintButton.tsx`, print pages | report-cards e2e | **Medium.** Covers the parent print view with chrome hidden under `print` media | Bulk "Print all" page |
| UI: `StudentGradesView.tsx`, `/grades`, `/students/[id]/grades`, course Grades | — | **Low.** Only the data layer is tested (qa-sh11) | Rendering, child selector |
| UI: admin grading-scales, gradebook settings, admin report-cards roster, homeroom list/review, student report-cards tab | report-cards e2e (admin roster only) | **Low** | Scale editor, settings live-sum chip, homeroom review page |
| `prisma/seed.ts` (PRD-11 block) | Dev manual run on temp 7A fixtures (dev-log) | **Not re-run by QA.** The dev DB has no 7A courses, so the block would only log a skip | — |

## Summary

- **Server logic** (calc, sync, backfill, student grades, report cards): well covered. Every PRD "Test Requirements" item (calculation matrix, sync hooks, backfill idempotency, snapshot immutability, the 3 Playwright flows) exists and passes.
- **Estimated line coverage of new server code: ~75–80%** (hand estimate). The main untested pieces are `scales-service.ts`, `exportGradebookCsv`, `deleteItem`, and the CLI wrapper.
- **UI components: ~35–40%** (hand estimate). Only the two e2e flows exercise them.
- **Recommended additions:** an HTTP test for `/api/grading-scales` on an isolated DB; a CSV export assertion; a Playwright check for the column menu and the student Grades tab.
