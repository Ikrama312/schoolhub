# QA Report — SH-11 (PRD-11 Gradebook, Grading Scales & Report Cards)

## QA Summary

- ticketId: SH-11
- timestamp: 2026-11-09T14:29:37Z
- overallStatus: FAIL
- requirementsChecked: 55
- requirementsPassed: 54
- requirementsFailed: 1

> This file replaces the stale SH-10 QA report.
> **All 42 functional requirements PASS. All 48 SH-11 tests pass (unit, integration on Postgres, Playwright on a fresh prod build).**
> One non-functional requirement fails:
> - **NFR-12 (quality gate):** `npm run test` is not green. 10 tests fail in the full run. Nine are pre-existing auth/attendance/toast failures or contention flakes, and none import gradebook code. **One is new and caused by SH-11:** `qa-sh9` "SCHEDULED … notified once" is now flaky (Headline 1).
>
> The fix is small (move one line in `publishOnce`). After that, the remaining failures are the known pre-SH-11 set.

## Headline findings

### 1. SH-11 made `qa-sh9.test.ts` FR-13/FR-42 flaky (regression in the suite)
- **Observed:** failed in the full run, and failed 1 of 3 isolated runs (`expected +0 to be 1`, `tests/integration/assignments/qa-sh9.test.ts:141`). It is not in the SH-10 failure list.
- **Cause:** `publishOnce` (`src/server/assignments/assignments-service.ts:306-314`) claims `notifiedAt`, then **awaits `upsertItemFromAssignment` (≥4 queries) before `notify()`**. The student read path fires `publishOnce` fire-and-forget. The test's own awaited `publishOnce` calls then return early, because the claim is already taken, and it counts notifications before the background call has reached `notify()`. SH-11 widened that window.
- **Product risk (minor):** if the gradebook upsert throws after the claim, the `assignment.published` notification is lost permanently, because `notifiedAt` is already set.
- **Recommended fix:** call `upsertItemFromAssignment` **after** `notify()`, or wrap it in try/log so it can never block the notification. The test could also wait with `vi.waitFor`, but the ordering fix is the root cause. QA did not change product code.

### 2. Remaining full-suite failures are outside SH-11
| Failing test | Status |
|---|---|
| `attendance-qa.test.ts` FR-22, FR-10/FR-19 | Pre-existing (SH-9/SH-10 lists) |
| `auth.test.ts` rate limit | Pre-existing (flaky) |
| `auth.test.ts` password reset | Contention only: passes when the file is run alone |
| `auth-forms.test.tsx` ForgotPasswordForm | Pre-existing (fails alone too) |
| `auth-forms.test.tsx` ChangePasswordForm ×3 | Contention only: pass when the file is run alone |
| `useToast.test.tsx` auto-hide | Pre-existing |
| `lockout.test.ts` (file fails to load) | Pre-existing (next-auth ESM) |

Full run: **399/409 pass**. SH-11 changed no auth, attendance or toast code (`git diff --stat`).

### 3. Environment note (not a defect)
The dev DB's current academic year (2026-2027) has **no terms**, so both SH-11 Playwright specs crash in `beforeAll` (`terms[0].id`). QA inserted a temporary term, ran both specs (**2/2 pass**), and then deleted the term. No rows referenced it.

## Gates run by QA
| Check | Result |
|---|---|
| `npm run lint` | ✅ no warnings or errors |
| `npm run typecheck` | ✅ clean (including the QA test files) |
| `next build` | ✅ |
| `prisma migrate status` | ✅ up to date (12 migrations). `grading_scale_one_default` index present |
| SH-11 unit (25) + integration (21) | ✅ 46/46 |
| SH-11 Playwright (prod build :3100) | ✅ 2/2 |
| Full `vitest run` | ❌ 399/409 (Headlines 1–2) |
| Static: banned UI imports / Pro grid features / `console.*` in new code | ✅ none |

## Tests added by QA
- `tests/integration/gradebook/qa-sh11.test.ts` (7 tests, Postgres). Covers FR-40 weights, FR-15 end to end in both the gradebook and the student view, FR-18 sort, FR-38 + NFR-4 grade.posted once with audit old→new, FR-9 synced comment-only, FR-42/NFR-5 hidden and unreturned exclusion for student and parent, NFR-6 refusals, FR-24 mark-missing due gate, FR-14 letter-only override + audit, and the **NFR-2 perf check (35×80 < 800 ms)**. Self-cleaning; verified 3/3 runs with zero leftovers.
- `tests/unit/gradebook/validators.test.ts` (4 tests). Covers FR-16 band rules, weight sum, unique category names, the 1,000-character comment cap.

## Dev completion check
All 33 tasks in `task-completion-markers.json` were checked. All 77 files in `file-ownership-matrix.json` exist and contain real implementations. No `TODO`/`FIXME`/stub markers were found in the new code.

## Requirement Results

| Requirement | Status | Evidence |
|---|---|---|
| FR-1 | PASS | `prisma/migrations/20261111000000_add_gradebook/migration.sql` and `prisma/schema.prisma`. `migrate status` up to date. All integration tests write these models |
| FR-2 | PASS | `schema.prisma` (Course.gradingScaleId, Assignment/Quiz.categoryId). Category select in `AssignmentForm.tsx:285-288` and `QuizSettingsPanel.tsx:123`. `assertCategoryInCourse` in `gradebook-sync.ts:92` |
| FR-3 | PASS | `gradebook-sync.test.ts` "publishing an assignment creates its item in the containing term". `term-placement.test.ts` |
| FR-4 | PASS | `gradebook-sync.test.ts` "FR-4: archive hides, hard delete removes". Practice/delete quiz test |
| FR-5 | PASS | `gradebook-sync.test.ts` "AC-3: return syncs the score; saving without returning does not" |
| FR-6 | PASS | `gradebook-sync.test.ts` "FR-6 / A1: exemption sets excused; removing it re-derives" |
| FR-7 | PASS | `gradebook-sync.test.ts` FR-7 IMMEDIATELY / MANUAL / AFTER_CLOSE tests (scaled to maxPoints) |
| FR-8 | PASS | `backfill.test.ts` "a second run changes nothing". `package.json` `gradebook:backfill`. `scripts/gradebook-backfill.ts`. `seed.ts:590` |
| FR-9 | PASS | `qa-sh11.test.ts` "FR-9: synced grades accept a comment only" (score/excused/maxPoints → VALIDATION_ERROR). Manual grades are edited in the same file and in the e2e |
| FR-10 | PASS | `grade-calc.test.ts` AC-5, hidden-items, strict-due-boundary and nothing-counted cases |
| FR-11 | PASS | `grade-calc.test.ts` "AC-2: dropLowest 1" and "never drops every counted item" |
| FR-12 | PASS | `grade-calc.test.ts` no-categories, empty-categories renormalised, A8 Uncategorised |
| FR-13 | PASS | `grade-calc.test.ts` "89.95 → 90.0 → A-", 76.95→77.0 C+, 76.94→76.9 C |
| FR-14 | PASS | `grade-calc.test.ts` AC-6 / A12. `qa-sh11.test.ts` letter-only override via service (78.0 B, computed C+) |
| FR-15 | PASS | `grade-calc.test.ts` golden case. `qa-sh11.test.ts` 78.0 C+ in both `getGradebook` and `getStudentGrades`. `gradebook.spec.ts` e2e |
| FR-16 | PASS | `validators.test.ts` FR-16. `scales-service.ts` default swap / no un-default. DB partial unique index `grading_scale_one_default`. `admin/grading-scales/*`. (The service has no runtime test, see coverage report) |
| FR-17 | PASS | `qa-sh11.test.ts` weights≠100 rejected. `GradebookSettingsClient.tsx` (live sum via `weightSum`, scale select) |
| FR-18 | PASS | `GradebookGrid.tsx:380` `columnGroupingModel`, no pinned columns. `qa-sh11.test.ts` last-name sort + NFR-2 35×80. `gradebook.spec.ts` |
| FR-19 | PASS | `GradebookGrid.tsx:112-115` (EX / M / —), `:226` M in red, `:230` late clock icon |
| FR-20 | PASS | `gradebook.spec.ts` (digits+Enter, E, M, Delete → 78.0% C+, 6 audit rows). `GradebookGrid.tsx:303-317` |
| FR-21 | PASS | `GradebookGrid.tsx:343-344`. The target routes `assignments/[assignmentId]/grade` and `quizzes/[quizId]/attempts/[attemptId]` exist |
| FR-22 | PASS | `AddManualItemDialog.tsx`. `api/courses/[id]/grade-items/route.ts`. `qa-sh11.test.ts` `createManualItem` |
| FR-23 | PASS | `TermOverrideDialog.tsx`. `api/courses/[id]/term-overrides/[studentId]/route.ts`. `validators.test.ts` 1,000-character cap. `qa-sh11.test.ts` override |
| FR-24 | PASS | `qa-sh11.test.ts` mark-missing refused before due and applied after. Hide via `updateItem`. `ItemStatsDialog.tsx:19` (avg/median/high/low) |
| FR-25 | PASS | `gradebook-service.ts` `exportGradebookCsv` uses `toCsv` from `@/server/csv`. Export button in `GradebookGrid.tsx:365` (no runtime test) |
| FR-26 | PASS | `student-tabs.ts:17`. `StudentGradesView.tsx`. `grade-calc.test.ts` gradeColour. `qa-sh11.test.ts` colour `warning` at 78.0 |
| FR-27 | PASS | `src/app/(app)/grades/page.tsx` + `GradesClient.tsx`. Nav entry `navigation.ts:39` (STUDENT, PARENT) |
| FR-28 | PASS | `course-tabs.ts:22`. `courses/[courseId]/grades/page.tsx`. `qa-sh11.test.ts` course-filtered `getStudentGrades` |
| FR-29 | PASS | `report-cards.test.ts` "roster shows status and warnings". `ReportCardsAdminClient.tsx` |
| FR-30 | PASS | `report-cards.test.ts` "generates a draft snapshot". `snapshot.ts` |
| FR-31 | PASS | `report-cards.test.ts` "AC-8 … regeneration skips PUBLISHED". `report-card-service.ts` `updateMany where status DRAFT` |
| FR-32 | PASS | `report-cards.test.ts` "comments follow field-level rules". `access.ts:25` `canEditHomeroomComment`. `report-cards/[id]/*` |
| FR-33 | PASS | `src/app/(app)/report-cards/page.tsx`. Nav `navigation.ts:41` (TEACHER) |
| FR-34 | PASS | `report-cards.test.ts` "AC-7: publish notifies Sam and Pat" and "unpublish … audited reason". `report-cards.spec.ts` |
| FR-35 | PASS | `report-cards.spec.ts` (print view hides sidebar / app bar / button under `print` media). `ReportCardDocument.tsx:24-31` (A4, page breaks). `PrintButton.tsx` `window.print()`. `report-cards/print/page.tsx` bulk |
| FR-36 | PASS | `student-tabs.ts:18`. `students/[id]/report-cards/page.tsx` |
| FR-37 | PASS | `report-cards.test.ts` "a 7B student gets NOT_FOUND", drafts hidden from family. `access.ts:13-18` |
| FR-38 | PASS | `notifications/types.ts:153,161` (defaultEmail false/true). `qa-sh11.test.ts` grade.posted once per student per item, including parent. `report-cards.test.ts` report_card.published |
| FR-39 | PASS | All 17 route files are thin (`requireUser`/`requireRole('ADMIN')` → validator → service). Services call `assertCanManageCourse` / `assertCanViewStudent`. `qa-sh11.test.ts` FORBIDDEN cases |
| FR-40 | PASS | `qa-sh11.test.ts` 40+50 → VALIDATION_ERROR, 40+60 OK. `categories-service.ts` full replace in a transaction |
| FR-41 | PASS | `prisma/seed.ts:548-604` (Standard A–F bands, 7A Homework 30/drop 1, Quizzes 30, Exams 40, Oral presentation, S1 drafts). "Standard A–F" is the default in the dev DB. The 7A block was verified by Dev on temp fixtures; QA did not re-run it (no 7A courses in the dev DB) |
| FR-42 | PASS | `qa-sh11.test.ts` "student view hides hidden items and unreturned scores" (student + parent) and refusal of other student / unlinked parent |
| NFR-1 | PASS | `grade-calc.ts` is pure (no Prisma, `now` injected) and uses Decimal helpers from `grading-math`. `grade-calc.test.ts` matrix (17) |
| NFR-2 | PASS | `qa-sh11.test.ts` "NFR-2: 35 students × 80 items loads in under 800 ms" (`getGradebook`, warm), 3/3 runs |
| NFR-3 | PASS | `report-card-service.ts` generate uses a fixed set of `findMany` calls plus one `loadCourseTermData` for all students/courses, and chunked `createMany`/`updateMany` (no N+1). The 600×8 < 30 s timing was **not load-tested** (Dev also skipped the optional perf test) |
| NFR-4 | PASS | `qa-sh11.test.ts` grade.update audit old 7.00 → new 8.00, termOverride.upsert audit old/new. `report-cards.test.ts` unpublish audit with reason |
| NFR-5 | PASS | `qa-sh11.test.ts` (hidden / unreturned). `report-cards.test.ts` (draft hidden). `gradebook-sync.test.ts` MANUAL quiz syncs only on release |
| NFR-6 | PASS | `qa-sh11.test.ts` other teacher FORBIDDEN on gradebook and putGrade, student FORBIDDEN on putGrade, other student / unlinked parent refused. `report-cards.test.ts` 7B NOT_FOUND |
| NFR-7 | PASS | Static scan: new UI imports only `@mui/material`, `@mui/icons-material`, `@mui/x-data-grid`, `@mui/x-date-pickers`, `react`, `next`. No banned libraries. Minor: two raw `<span>`s (`GradingScalesClient.tsx:68` is the MUI-documented Tooltip-on-disabled wrapper; `StudentGradesView.tsx:117` could be `Typography`) |
| NFR-8 | PASS | Repo-wide grep: no `pinnedColumns`, `DataGridPro`/`Premium`, row grouping or aggregation. `columnGroupingModel` + `processRowUpdate` only |
| NFR-9 | PASS | Reuses `csv.ts`, `grading-math`, `student-access`, `course-access`, `notify`, `audit`, `logger`, quiz `resultsVisible`. New code in `src/server/gradebook/` and `src/server/report-cards/`. No `console.*` in new code or in the seed diff. (DataGrid used instead of `DataTable` for 2 lists. The deviation is justified in dev-log) |
| NFR-10 | PASS | `term-placement.ts:21-22` uses `schoolToday(date, tz)`. `term-placement.test.ts` "uses the school-local date at day boundaries". Past-due is a strict instant compare (`grade-calc.test.ts` boundary) |
| NFR-11 | PASS | `report-cards.spec.ts` print media check. `ReportCardDocument.tsx:24` `@page { size: A4 portrait; margin: 12mm }`, one card per page |
| NFR-12 | **FAIL** | lint ✅, typecheck ✅, all required SH-11 tests exist and pass. **But `npm run test` is 399/409**: 1 SH-11-induced flake (`qa-sh9` FR-13/FR-42, Headline 1) plus pre-existing failures (Headline 2) |
| NFR-13 | PASS | `grade-calc.ts` never reads `gpa`. GPA is only stored in band JSON (`validators/gradebook.ts:42`). No rank or transcript code |

## Recommended actions
1. **Fix Headline 1:** in `publishOnce`, run the gradebook upsert after `notify()`, or guard it with try/log. Then rerun `qa-sh9.test.ts` several times.
2. Triage or quarantine the pre-existing auth/attendance/toast/lockout failures so the suite can be green (carried over from SH-9/SH-10).
3. Restore a term for the current academic year in the dev DB (the e2e specs require one), or make the specs create their own term.
4. Optional: add runtime tests for `scales-service.ts` and the CSV export, and a load test for NFR-3.
