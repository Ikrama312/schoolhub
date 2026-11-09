# Requirements Analysis Notes — ticket SH-11

Written by `arch-research-reqs` for `arch-design-system`. This is a supporting document, not a primary phase output.
Source: `artifacts/intake/requirements.json` (2026-11-09T12:00:00Z), PRD-11 Gradebook, Grading Scales & Report Cards (SCH-011). It has 42 FRs and 13 NFRs (55 requirements) at 95% confidence.
`handoff-to-architect.json` lists **no blockers**. Its flagged assumptions (FR-6, FR-7, FR-13, FR-27/33, NFR-10, FR-3 no-term) are restated in §4 so `system-design.md` can carry them forward.

> As of this writing the other files in `artifacts/architect/` (system-design.md, tech-stack-decisions.md, api-contracts.json, handoff-to-dev-planning.json, threat-model-notes.json) are **leftovers from earlier tickets**. Their owning sub-tasks must overwrite them, and none of them is SH-11 input.

## 1. Brownfield facts verified on disk

| # | Fact | Evidence | Impact on SH-11 |
|---|---|---|---|
| B1 | **`getStudentQuizScore(quizId, studentId)` already exists.** It is labelled "PRD-11 export". It loads GRADED attempts, applies `applyScoringPolicy(quiz.scoringPolicy, …)`, and returns `{score, maxScore, percent, attemptsCounted, isPractice}` (fixed2 strings) or null. | src/server/quiz/attempt-service.ts L355-372 | **This corrects intake** (B-finding 5 and the FR-7 assumption). FR-7 calls it directly, with no new helper. It does **not** check `resultsVisible`, so the sync caller must gate on that (NFR-5). The batch path (FR-8 backfill, NFR-3) should run `applyScoringPolicy` in memory over attempts it has already loaded, rather than calling this per student. |
| B2 | `resultsVisible(quiz, attempt, now)` covers IMMEDIATELY / AFTER_CLOSE (`now >= availableUntil`) / MANUAL (`resultsReleasedAt != null`). | src/server/quiz/grading.ts L94 | FR-7 / NFR-5 gate. AFTER_CLOSE depends on time, so a GRADED attempt is not syncable until close. See B4. |
| B3 | Every quiz attempt status change goes through `recomputeAttempt(tx, attemptId)`. It is called from `submitAttempt` (L123, which includes auto-submit), `gradeAnswerManually` (L338) and `regradeQuiz` (quiz-service L435). | attempt-service.ts L73-81 | FR-7 hook. After each caller commits, call `syncQuizGrade(quizId, studentId)`, which no-ops unless GRADED + visible + !isPractice. Making this one function the only quiz sync entry point covers all three callers. |
| B4 | Results become visible through `releaseResults` (MANUAL, quiz-service L464) and `sendAfterCloseResultsReleased` (AFTER_CLOSE). The latter claims `resultsReleasedAt` with `updateMany` on each maintenance tick. | quiz-service.ts L464; quiz/maintenance.ts L27-40 | FR-7 also needs a **bulk** `syncQuizGrades(quizId)` in both places. Otherwise AFTER_CLOSE and MANUAL quizzes never reach the gradebook. The maintenance claim is already idempotent, so put the sync after `count === 1`. |
| B5 | Quiz lifecycle: `createQuiz`, `updateQuiz` (DRAFT→PUBLISHED and PUBLISHED→CLOSED via guarded `updateMany`, L304-305), `deleteQuiz` (hard delete, L317). Quizzes have **no archive**. | quiz-service.ts L259-317 | FR-3: upsert the item on →PUBLISHED. FR-4: delete the item on deleteQuiz. CLOSED is **not** unpublish, so the item stays visible. Settings edits to a published quiz (title, availableUntil, categoryId, max) re-upsert the item. |
| B6 | Assignment lifecycle: `createAssignment` / `updateAssignment` (status DRAFT/SCHEDULED/PUBLISHED); `publishOnce` (cron, makes SCHEDULED visible once `availableFrom` passes); `deleteOrArchiveAssignment` (hard delete in a tx, or sets `archivedAt` when submissions exist, L479-492). `isAssignmentVisible` = !archivedAt && published-or-scheduled-reached. | assignments-service.ts L67-74, L292-330, L437-492 | FR-3/FR-4: compute GradeItem.isVisible from `isAssignmentVisible`. Upsert on create/update/publishOnce, set isVisible=false on archive, delete inside the delete tx. **FR-24's teacher hide toggle conflicts with this** (see §3 R2). |
| B7 | Return paths: `gradeSubmission` (`returning = input.return && status !== 'RETURNED'`; it also re-grades an already-RETURNED submission), `bulkReturn`, and `gradeOffline` (`input.return`). | assignments-service.ts ~L696-800 | FR-5: sync when the submission **is RETURNED after the write**, not only on the transition. Re-grading a returned submission must update Grade.score, and grade-without-return must not sync (AC-3). Use one `syncSubmissionGrade(submissionId)` from all three. |
| B8 | `setExemption(…, exempt)` upserts or deletes `GradeExemption` (L818/L824) and audits `assignment.exempt` / `assignment.unexempt`. | assignments-service.ts L815-838 | FR-6: call `syncSubmissionGrade` (or a by-(assignment, student) variant) after both branches. Unexempt re-derives the score from a RETURNED submission, else null. |
| B9 | GradeItem has a polymorphic `source + sourceId` with **no FK**. Assignment and Quiz deletes will not cascade. | FR-1 model spec | FR-4: delete the GradeItem explicitly inside the same transaction as the source delete (and in `deleteQuiz`, which today runs outside a tx). Grade → GradeItem should be `onDelete: Cascade`. |
| B10 | `Term` has no `isCurrent`. It has `academicYearId`, `startDate`/`endDate` as `@db.Date`, `order`. `AcademicYear.isCurrent` exists. `Course.academicYearId` exists. | schema.prisma L240-252, Course ~L415 | FR-3 term placement: pick the term of **the course's academic year** whose `[startDate, endDate]` contains dueAt, comparing dates in the school timezone (NFR-10). The fallback "current term" is the term of that year containing today (tz), else skip + `logger.warn`. Put this in one pure helper `termFor(date, terms, tz)`. |
| B11 | `getSchoolTimezone()` is exported from assignments-service. `dec` / `fixed2` / `Decimal` come from grading-math (isomorphic). `percentOf` (1 dp half-up) is in quiz/grading.ts. | assignments-service.ts L57; grading-math.ts L7-15; grading.ts L133 | NFR-1/NFR-10/FR-13 reuse these. `percentOf` rounds to 1 dp on a single value. grade-calc must keep full-precision Decimal until the **final** rounding (FR-13), so it must not round category percents early. |
| B12 | `assertCanViewCourse` / `assertCanManageCourse` exist. `getAccessibleStudentIds` / `assertCanViewStudent` cover own student, linked parent (`ParentStudentLink`), teacher and admin, with homeroom handled there too. `src/server/quiz/access.ts` has `canManageCourse`. | src/server/auth/course-access.ts, student-access.ts | FR-39 "manage"/"view" and FR-42 reuse these. FR-37 report-card access is new: ADMIN; teachers of any course on the card or the homeroom teacher; the student or a linked parent only when PUBLISHED. Return NOT_FOUND to everyone else (AC-7). |
| B13 | Attendance aggregation already exists: `getReport(filters)` → `StudentSummaryRow` (StatusCounts per student) using a single `groupBy(studentId, status)`. It filters by date range, grade level, section and course. | attendance-service.ts L528-582 | FR-30 attendance summary and NFR-3 batching: call `getReport({from: term.start, to: term.end, sectionId/gradeLevelId})` **once** per generate request. Do not loop per student. Rate formula: reuse whatever StatusCounts consumers use. Do not invent a new one. |
| B14 | `SchoolSettings` singleton: name, shortName, logoUrl, timezone, address fields. Student profile: `admissionNumber`, `gradeLevel`. `Section.homeroomTeacherId`. | schema.prisma L109-113, L198-215 | FR-30 snapshot fields all come from existing models. No schema change beyond FR-1. |
| B15 | `NOTIFICATION_TYPES` const already contains assignment.* and quiz.* entries. `notify()` and `notifyStudentAndParents()` never throw. `audit()` never throws. | notifications/types.ts, notify.ts L28/L98, audit.ts L26 | FR-38: add `grade.posted` (ACADEMIC, defaultEmail false, STUDENT+PARENT) and `report_card.published` (defaultEmail true, STUDENT+PARENT). Call them after commit. NFR-4 audit actions: `grade.update`, `termOverride.upsert`, `reportCard.unpublish` (plus `reportCard.publish` and `gradingScale.*` as nice-to-haves). |
| B16 | `courseTabs` / `studentTabs` are static arrays. `studentTabs` notes "No tab bar renders studentTabs yet". `navigation` is a flat array with `roles` and an optional `group: 'Administration'`. | src/config/*.ts | FR-18/28: add course tabs `gradebook` (TEACHER, ADMIN) and `grades` (STUDENT, PARENT). FR-26/36: add student tabs `grades` and `report-cards`. These are reachable by URL only, the same as `assignments`. FR-27/33 + admin pages: nav entries `/grades`, `/report-cards`, `/admin/grading-scales`, `/admin/report-cards`. |
| B17 | `toCsv(columns, rows)` + `escapeCsvCell` are in src/server/csv.ts. Shared components: DataTable, ConfirmDialog, Toast (useToast), PageHeader, EmptyState, StatCard, DateDisplay, UserPicker, FormField, LoadingSkeleton. **No existing `@mui/x-data-grid` usage in src.** | src/server/csv.ts; src/components/ | FR-25: export on the server with `toCsv`, building the same columns as the grid. FR-18 is the first DataGrid in the codebase, so its MIT-tier API (columnGroupingModel, processRowUpdate, virtualisation, no pinning) must be looked up via mui-mcp for 9.5.0 (NFR-7/8). FR-29 table → DataTable. |
| B18 | Scripts: `db:seed` = `tsx prisma/seed.ts`. There is no `gradebook:backfill`. The seed looks up courses by code with `findCourse([...])`. | package.json; prisma/seed.ts | FR-8: add `"gradebook:backfill": "tsx scripts/gradebook-backfill.ts"`, a thin wrapper over an exported `backfillGradebook()` in src/server/gradebook/ that the seed also calls before the FR-41 data. |
| B19 | Postgres. Migrations already hand-add raw SQL partial indexes. Prisma 5.20. | prisma/migrations/* | FR-1: one migration. It needs `@@unique([source, sourceId])` on GradeItem (sync and backfill idempotency), `@@unique([gradeItemId, studentId])` on Grade, `@@unique([courseId, termId, studentId])` on TermGradeOverride, and `@@unique([studentId, termId])` on ReportCard. These make the upserts race-safe. A one-default-scale rule can be a partial unique index `WHERE "isDefault"` (FR-16). |

## 2. Requirement → architectural concern

Concern legend: **DM** data model/migration · **SYNC** source→gradebook sync hook · **CALC** pure calculation · **API** REST endpoint · **UI** page/component · **AUTH** access boundary · **JOB** script/batch · **NOTIF** notification · **AUD** audit · **CFG** config registry.

| Req | Concern | Notes |
|---|---|---|
| FR-1 | DM | New enums + 6 models in one `prisma migrate` migration. Use the unique keys from B19. Grade: `score Decimal?`, `excused`, `missing`, `comment`, `gradedById`, `gradedAt`. ReportCard: `status`, `snapshot Json`, `homeroomComment`, `principalComment`, `publishedAt`, `publishedById`. |
| FR-2 | DM, UI | Nullable `Course.gradingScaleId`, `Assignment.categoryId` and `Quiz.categoryId` with `onDelete: SetNull`. Category deletion via FR-40 must not delete sources. Add one `Select` to the existing assignment and quiz editors, plus the validator fields in assignments.ts / quiz.ts (optional and nullable). Don't change existing behaviour. |
| FR-3 | SYNC | `upsertGradeItemFromAssignment(id)` / `…FromQuiz(id)` keyed on (source, sourceId). Skip practice quizzes. Term placement via `termFor` (B10). Callers per B5/B6. Keep the GradeItem's term stable after first creation unless the date changes, so grades don't jump terms on unrelated edits. |
| FR-4 | SYNC | Archive sets isVisible=false. Delete removes the GradeItem in the same tx (B9). Quiz has no archive or unpublish. A practice-toggle after publish should delete or hide the item. |
| FR-5 | SYNC | `syncSubmissionGrade` from 3 return paths (B7). It writes only when RETURNED. Score = `finalScore`. |
| FR-6 | SYNC | From `setExemption` (B8). Exemption wins over the score: excused=true and the score is kept. |
| FR-7 | SYNC | Per-attempt `syncQuizGrade` after `recomputeAttempt` callers (B3). Bulk `syncQuizGrades` on release and AFTER_CLOSE (B4). Score scaled: `score/maxScore × GradeItem.maxPoints`, Decimal. |
| FR-8 | JOB | `backfillGradebook()`: batch load per course, reuse the same upsert builders as live sync (one code path), idempotent through the unique keys. npm script + seed call (B18). |
| FR-9 | API, AUTH | The service rejects score/excused/missing edits on non-MANUAL items (`AppError('FORBIDDEN'/'VALIDATION_ERROR')`). Comment stays editable. The grid marks those columns non-editable. |
| FR-10 | CALC | `src/server/gradebook/grade-calc.ts`: pure, Decimal-only, no Prisma client import (types only). Input: items, grades, categories, scale, override, `now`. Counted = visible ∧ ¬excused ∧ (score≠null ∨ (missing ∧ now>dueAt)). |
| FR-11 | CALC | Drop lowest by item **percentage**, keeping ≥1. Ties are dropped deterministically (by dueAt, then id). |
| FR-12 | CALC | Implicit "Uncategorised" bucket. What weight does it get? The PRD is silent, so see §3 R3. No categories gives a points total. |
| FR-13 | CALC | `toDecimalPlaces(1, ROUND_HALF_UP)` only at the end. Bands are sorted descending, first `percent >= minPercent`. |
| FR-14 | CALC | The override is applied after computing. A letter-only override keeps the computed percent. A percent-only override probably re-derives the letter from the scale (unstated, so flag it). |
| FR-15 | CALC, UI | Golden unit test (78.0 C+). The gradebook and student Grades **must call the same function**, with no client-side recomputation. |
| FR-16 | API, UI, DM | `/admin/grading-scales` (ADMIN). Band validation lives in a Zod refinement shared by client and server. "Exactly one default" uses a tx that clears others + a partial unique index. Deleting a scale in use is either blocked or falls back to the default; decide this. |
| FR-17 | UI, API | Course settings page. The live weight sum is client-side, with the 100 check repeated server-side in FR-40. Decimal weights: compare with `dec(sum).eq(100)`, not floats. |
| FR-18 | UI, API, CALC | First DataGrid. The server returns one denormalised payload `{students, items, categories, grades, computed}` for (course, term) in a fixed number of queries (NFR-2). Columns are built client-side from it. Sort by last name on the server. |
| FR-19 | UI | Pure cell renderer. "Late" needs `Submission.isLate`, so the gradebook payload must carry the source submission's isLate. |
| FR-20 | UI, API | `processRowUpdate` → PATCH a single grade. E/M/Delete need a custom edit cell / `onCellKeyDown` (check mui-mcp). Optimistic update with per-cell error. Audited (NFR-4). Triggers `grade.posted` (FR-38). |
| FR-21 | UI | The cell click opens a link to the submission grading page or the quiz attempt. The payload needs `submissionId` / `attemptId` per synced grade. |
| FR-22 | API, UI | POST manual item. Validate that the term belongs to the course's academic year and the category belongs to the course. |
| FR-23 | API, UI, AUD | PUT override (upsert). Comment ≤1000 chars. Audit with old/new values. |
| FR-24 | API, UI | Toggle visibility (see R2). Bulk-missing allowed only if `now > dueAt` and only for ungraded rows. Stats come from the computed payload, client-side, over counted scores. |
| FR-25 | API | Server CSV via `toCsv`, using the same row builder as the grid. "As displayed" means EX/M/— markers and the term letter. |
| FR-26 | UI, API, CFG | Student tab → `GET /api/students/:id/grades?termId`. The colour thresholds come from a single helper reused by FR-27/28. |
| FR-27 | UI, CFG, AUTH | `/grades` reuses the FR-26 component. Parent child selector from `getAccessibleStudentIds`. Nav entry. |
| FR-28 | UI, CFG | Course tab `grades` (STUDENT, PARENT): same endpoint filtered by courseId. |
| FR-29 | UI, API | `/admin/report-cards`: list query joins students (grade level, section filters) with ReportCard status for the term. Missing-data warnings are computed in batch (ungraded counted-eligible items, missing TermGradeOverride.comment per course). |
| FR-30 | JOB, API | `generate`: batch load (NFR-3), compute in memory, write the snapshot JSON (versioned shape, e.g. `snapshot.v = 1`). Teacher comment = `TermGradeOverride.comment`. Attendance via B13. |
| FR-31 | JOB, DM | `upsert` with `where status = DRAFT` semantics: createMany for new cards, `updateMany({status:'DRAFT'})` for existing ones, never touching PUBLISHED. Grade-edit services never import report-cards code. |
| FR-32 | API, UI, AUTH | PATCH: field-level role check (homeroomComment: homeroom teacher of the student's section or ADMIN; principalComment: ADMIN). Edits are allowed only while DRAFT (implied, so flag it). |
| FR-33 | UI, CFG, AUTH | `/report-cards` (TEACHER): drafts for sections where `homeroomTeacherId = user.id`. Nav entry. |
| FR-34 | API, NOTIF, AUD | Publish (one or bulk) with a guarded `updateMany({status:'DRAFT'})`, then notify after commit. Unpublish: ADMIN, reason required, audit, back to DRAFT. |
| FR-35 | UI | `/report-cards/[id]/print` renders from the **snapshot only**. `@media print` via MUI `GlobalStyles`, hiding the sidebar. Bulk print: one page renders N cards with `break-after: page`. |
| FR-36 | UI, CFG, API | Student tab "Report cards". The list endpoint filters to PUBLISHED for student/parent (NFR-5). |
| FR-37 | AUTH | New `assertCanViewReportCard`. Non-entitled users get NOT_FOUND, so existence isn't leaked. |
| FR-38 | NOTIF | Register 2 types (B15). `grade.posted`: only for MANUAL items, only when a score is first entered or changed (one per student per item, so an idempotency marker such as `Grade.notifiedAt` is needed; flag it). |
| FR-39 | API, AUTH | Thin route handlers using `withHandler`, Zod in `src/lib/validators/gradebook.ts`, and services in `src/server/gradebook/` + `src/server/report-cards/`. |
| FR-40 | API | Replace-all in a tx: delete missing ids (sources → SetNull), upsert the rest. Weights total 100 (Decimal). |
| FR-41 | JOB | Seed: scale, 7A categories, 'Oral presentation' + grades, draft S1 cards for 7A with MATH/ENG override comments. Run after `backfillGradebook()`. |
| FR-42 | API, AUTH | Student serializer: visible items only. Grade rows only exist for released scores (sync gating), so the risk is mainly hidden items and MANUAL items with isVisible=false. Still filter explicitly. |
| NFR-1 | CALC | Decimal throughout. Unit matrix in `grade-calc.test.ts`. |
| NFR-2 | API | Gradebook: ~5 queries (enrollments, items, grades, categories, scale + override), all indexed by (courseId, termId). The grid virtualises. |
| NFR-3 | JOB | Generation: per term, `findMany` items/grades/overrides/categories for all courses in scope with `in` filters, then group in memory. One attendance `groupBy`. Chunk the writes. |
| NFR-4 | AUD | Old/new values in metadata for grade.update, termOverride.upsert and reportCard.unpublish. |
| NFR-5 | AUTH | Enforced in 3 layers: sync gating (B2/B7), student serializer (FR-42), report-card guard (FR-37). Integration tests for each. |
| NFR-6 | AUTH | Every route uses requireUser/requireRole + an entity check (B12). Server pages check too, not just the API. |
| NFR-7 | UI | MUI only, with mui-mcp lookup. Toast via useToast, confirm via Dialog/ConfirmDialog. |
| NFR-8 | UI | DataGrid MIT: no `pinnedColumns` and no `@mui/x-data-grid-pro`. Sticky header is the default. |
| NFR-9 | all | New code only in src/server/gradebook/ and src/server/report-cards/. Hooks into existing services are one-line calls. Use `logger`, no console.log. |
| NFR-10 | CALC, SYNC | Past-due uses an instant comparison (`now > dueAt`). Term containment uses a tz date comparison (B10). |
| NFR-11 | UI | A4 portrait `@page` rule. Long course lists may need a 2nd page, with table rows set to `break-inside: avoid`. |
| NFR-12 | all | Tests per the intake list. Integration tests hit the real sync hooks (B3/B4/B7). |
| NFR-13 | — | Scope guard: store `gpa`, never compute it. No rank or transcript. |

## 3. Risks / decisions for `arch-design-system`

- **R1 (FR-7 timing):** AFTER_CLOSE and MANUAL visibility arrive later than GRADED. Without the B4 bulk hooks, those quizzes never sync. Syncing early would break NFR-5.
- **R2 (FR-4 vs FR-24):** the teacher's hide toggle and the source-driven `isVisible` share one column. Re-saving an assignment would silently re-show a teacher-hidden item. Options: (a) source sync writes isVisible only on publish/archive *transitions*; (b) add a separate `hiddenByTeacher` flag and make visible = sourceVisible ∧ ¬hiddenByTeacher. (b) is clearer but adds a column beyond FR-1's "exactly as specified". Pick one and state it.
- **R3 (FR-12 Uncategorised weight):** the PRD doesn't say what weight the implicit bucket carries when real categories exist. A sensible default is weight 0, so it's shown but excluded from the weighted mean, unless it's the only bucket. This affects the FR-15 golden test only if it has uncategorised items (it doesn't). Flag it.
- **R4 (FR-38 dedupe):** "one notification per student per item" needs a marker. A nullable `Grade.notifiedAt` claimed via `updateMany` follows the existing claim pattern.
- **R5 (FR-3 term drift):** re-deriving the term on every edit can move existing grades between terms. Only recompute it when dueAt/availableUntil changes.
- **R6 (FR-16 delete):** deleting a scale referenced by courses or by DRAFT snapshots (PUBLISHED ones embed the legend, so they're safe). Recommend blocking the delete with CONFLICT while courses reference the scale.
- **R7 (first DataGrid):** there is no in-repo precedent. Keyboard E/M/Delete handling within the MIT tier is the main implementation risk (intake keyRisk). The design should keep the grid behind one client component.

## 4. Carried-forward assumptions (from intake, adjusted)

1. FR-6: unexempting clears excused and re-syncs the score from the source.
2. FR-7: **use the existing `getStudentQuizScore`** (B1) plus a caller-side `resultsVisible` gate. This replaces intake's "build a new helper".
3. FR-13: 89.95 → 90.0 → **A−** under the seed scale. The test asserts 90.0 and the 90-band letter.
4. FR-27/FR-33: add nav entries per the convention.
5. NFR-10: past due = `now > dueAt` (exact instant). Term containment is evaluated in the school timezone.
6. FR-3: no containing term and no current term → skip the item + `logger.warn`.
7. New and unstated (needs sign-off): FR-14 percent-only override re-derives the letter; FR-32 comments are editable only while DRAFT; FR-34 unpublish returns to DRAFT.
