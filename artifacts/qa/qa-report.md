# QA Report — SH-10 (PRD-10 Quizzes & Online Exams)

## QA Summary

- ticketId: SH-10
- timestamp: 2026-11-09T07:57:09Z
- overallStatus: FAIL
- requirementsChecked: 49
- requirementsPassed: 47
- requirementsFailed: 2

> This file replaces the stale SH-9 QA report.
> **All 39 functional requirements PASS. The feature works end to end.**
> Two non-functional requirements FAIL, and neither is a feature defect:
> - **NFR-7:** two new `console.log` calls in the quiz seed (`prisma/seed.ts:463`, `:526`). The fix is to change them to `logger.info`, which the file already imports.
> - **NFR-8:** the full `npm run test` run is still not green. It has the **same 6 failing tests that were already failing before SH-10** (the SH-9 report lists them). None of them import quiz code.
>
> The verdict is consistent with SH-9, where the same two kinds of finding also produced FAIL. The feature is ready for review once the 2-line seed fix lands and the pre-existing failures are accepted as known or fixed separately.

## Headline findings

### 1. The build and tests run, and every quiz test is green
| Check | Result |
|---|---|
| `npx prisma migrate status` | ✅ 11 migrations, schema up to date (incl. `20261110000000_add_quizzes`) |
| `npm run lint` | ✅ no warnings/errors |
| `npx tsc --noEmit` | ✅ clean (incl. the new QA test) |
| Quiz unit + integration (`tests/unit/quiz`, `tests/integration/quiz`) | ✅ **53/53**: 37 unit, 8 dev integration, 8 new QA integration |
| E2E `tests/e2e/quizzes.spec.ts` (QA rerun on `next start -p 3100`) | ✅ **4/4** (build → publish → take with reload → grade essay → see results) |
| Full `vitest run` | ⚠️ 360/366. 6 failures, all pre-existing (see below) |

### 2. Full-suite failures are pre-existing and do not touch quiz code
| Failing test | Status before SH-10 |
|---|---|
| `attendance-qa.test.ts` FR-22, FR-10/FR-19 | Listed in the SH-9 report (time-of-day / attendance service) |
| `auth.test.ts` rate limit | Listed in SH-9 (flaky) |
| `auth-forms.test.tsx`, `useToast.test.tsx` | Listed in SH-9 |
| `lockout.test.ts` | Listed in SH-9 (next-auth ESM resolution under Node 24) |
| `email-dispatch.test.ts` AC-4 (concurrent dispatchers) | Flaky when run alongside other DB suites. Passed **3/3** when run alone. It tests `server/email/dispatch`, which SH-10 did not change; SH-10 only added two try/catch'd calls in the dispatch *route*. |

### 3. Dev's self-reported completion matches the code
- All 51 paths in `file-ownership-matrix.json` exist and contain real implementations.
- There are no `TODO` or `FIXME` markers and no stub functions in the quiz code.
- The two `ponytail:` notes in `attempt-service.ts` are documented trade-offs, not missing features: a hand-rolled cuid-shaped id, and a rare save-vs-submit race that a Regrade fixes.
- All 23 tasks are marked complete, and each maps to the code that implements it.

### 4. New QA tests (`tests/integration/quiz/qa-sh10.test.ts`, 8 tests) fill the gaps in dev's coverage
- **NFR-1:** asserts that the JSON from the student `getQuiz`, the in-progress attempt and the pre-release result never contains `"correct"`, `"explanation"` or the explanation text. Manager `getQuiz` does include them.
- **FR-11 / FR-31:** the course list is shaped by role (manager / student / parent). Drafts are hidden from students. A student outside the course and a teacher of another course get NOT_FOUND. A quiz with no attempts can be deleted.
- **FR-26 / FR-27:** checks the analytics summary (avg / median / high / low), the 10-bucket histogram, the option distribution, the most-chosen wrong option, and the CSV header and rows. Non-managers get NOT_FOUND.
- **FR-34 / NFR-5:** a parent sees a linked child's result only after release. An unlinked parent, another student and another teacher get NOT_FOUND. Cross-student autosave and cross-course grading are refused.
- **FR-28 / FR-38:** extra time feeds the deadline (10 + 15 = 25 min). An accommodation for a student not enrolled in the course gets NOT_FOUND. Accommodation, grade, regrade and release each write an `AuditLog` row.
- **FR-31:** reorder rejects a partial or duplicate id list.
- **NFR-2:** the median of 50 concurrent saves is under 50 ms. Saves are upserts: 2 rows after 51 saves.

## Requirement Results

| Requirement | Status | Evidence |
|---|---|---|
| FR-1 | PASS | `prisma/schema.prisma` (5 enums, 5 models, back-relations); `prisma/migrations/20261110000000_add_quizzes/migration.sql`; `migrate status` up to date; all integration tests use the models |
| FR-2 | PASS | `src/lib/validators/quiz.ts`; `tests/unit/quiz/quiz-validators.test.ts` (window, 1–300, 1–10, 0.5–100, 2–8 options, 1–10 accepted, 10,000 chars, accommodation limits) |
| FR-3 | PASS | `src/server/quiz/grading.ts`; `grading.test.ts` "MULTIPLE_CHOICE partial credit — FR-2 example" ({A,B}=0, {A}=2), SINGLE_CHOICE/TF all-or-nothing |
| FR-4 | PASS | `grading.test.ts` "SHORT_ANSWER normalises; ' Photosynthesis ' is correct"; `needsReview` test; override in `regrade.test.ts` |
| FR-5 | PASS | `grading.test.ts` "ESSAY is manual"; guidance in `correct.guidance` (`regrade.test.ts`) |
| FR-6 | PASS | `edit/QuizSettingsPanel.tsx`; time-limit ≤ window rule in `quiz-validators.test.ts` "rejects a time limit longer than the window" |
| FR-7 | PASS | `edit/QuestionList.tsx` (dnd-kit `useSortable`, Duplicate, Delete), `edit/QuestionEditor.tsx` (per-type editors); e2e adds 4 question types; server reorder tested in `qa-sh10.test.ts` |
| FR-8 | PASS | `edit/QuizBuilder.tsx` L112 (running points total), L115/187 (Preview as student, `QuizPlayer mode='preview'` skips saves, L259/279) |
| FR-9 | PASS | `grading.test.ts` "canPublish"; `regrade.test.ts` (publish with 0 questions → VALIDATION_ERROR) |
| FR-10 | PASS | `regrade.test.ts` (edit lock: add/delete/points/essay-correct → CONFLICT; accepted answers editable; regrade keeps manual grades) |
| FR-11 | PASS | `src/config/course-tabs.ts` L18; `CourseQuizzesView.tsx`; `qa-sh10.test.ts` role-shaped list test |
| FR-12 | PASS | `take/page.tsx` + `QuizPlayer.tsx` start screen (time limit, attempts, confirm dialog L128); e2e student step |
| FR-13 | PASS | `grading.test.ts` "computeDeadline" (AC-1) + "seededShuffle"; `serializers.test.ts` frozen order and seeded option shuffle |
| FR-14 | PASS | `QuizPlayer.tsx` (RadioGroup/Checkbox/TextField, LinearProgress L332, navigator L336, sticky header L308, red timer under 2 min L319) |
| FR-15 | PASS | `take/useAutosave.ts` (800 ms debounce, localStorage queue, 5 s retry); status pill labels `QuizPlayer.tsx` L221; e2e reload mid-attempt keeps answers |
| FR-16 | PASS | `attempts.test.ts` "autosave within grace succeeds; after deadline + 30 s it is 409 and the attempt is auto-submitted" |
| FR-17 | PASS | `regrade.test.ts` (essay → NEEDS_GRADING); `attempts.test.ts` double submit; unanswered count `QuizPlayer.tsx` L301 |
| FR-18 | PASS | `attempts.test.ts` "GET auto-submits an expired attempt" + maintenance auto-submit test |
| FR-19 | PASS | `attempts.test.ts` "resume returns the same attempt; concurrent starts produce one attempt"; e2e reload |
| FR-20 | PASS | `grading.test.ts` "resultsVisible"; `regrade.test.ts` manual release (idempotent); `qa-sh10.test.ts` parent hidden until release |
| FR-21 | PASS | `serializers.test.ts` (score, percent, correct + explanation only when showCorrectAnswers); `attempts/[attemptId]/page.tsx`; e2e "student sees the results" |
| FR-22 | PASS | `grading.test.ts` "applyScoringPolicy" HIGHEST/LATEST/AVERAGE; `attempts.test.ts` getStudentQuizScore |
| FR-23 | PASS | `grading.test.ts` "attemptLimit adds extra attempts"; `attempts.test.ts` attempt limit + accommodation (AC-8) |
| FR-24 | PASS | `grade/QuizGradingWorkspace.tsx` (By student / By question, step 0.5); `regrade.test.ts` override + over-max → VALIDATION_ERROR; e2e "teacher grades the essay" |
| FR-25 | PASS | `regrade.test.ts` essay graded → GRADED, score 6.50/7.00 |
| FR-26 | PASS | `analytics.ts`, `QuizAnalytics.tsx` (x-charts BarChart); `qa-sh10.test.ts` summary + histogram |
| FR-27 | PASS | `qa-sh10.test.ts` per-question % correct, avg points, option distribution, most-chosen wrong, CSV |
| FR-28 | PASS | `qa-sh10.test.ts` (extra time → 25-min deadline; non-enrolled → NOT_FOUND); `attempts.test.ts` extra attempt |
| FR-29 | PASS | `src/server/notifications/types.ts` L136 (`defaultEmail: false`, STUDENT); `regrade.test.ts` publish → 1 `quiz.published` notification |
| FR-30 | PASS | `types.ts` L144 (STUDENT + PARENT); `regrade.test.ts` MANUAL release notifies students + parent once; `attempts.test.ts` AFTER_CLOSE idempotent under concurrent runs |
| FR-31 | PASS | Route files under `src/app/api/{courses/[id]/quizzes,quizzes,questions}`; `regrade.test.ts` + `qa-sh10.test.ts` (CRUD, delete-only-without-attempts, reorder validation) |
| FR-32 | PASS | `src/app/api/attempts/**`, `quizzes/[id]/attempts`; `attempts.test.ts` (start/resume, save, submit, owner-only) |
| FR-33 | PASS | `attempts.test.ts` "getStudentQuizScore … reports isPractice" |
| FR-34 | PASS | `src/server/quiz/access.ts` wraps `course-access.ts`; `qa-sh10.test.ts` parent / outsider / other-teacher checks |
| FR-35 | PASS | `src/app/api/internal/email/dispatch/route.ts` L9, L40–50; `attempts.test.ts` "maintenance … idempotent under concurrent runs" |
| FR-36 | PASS | `prisma/seed.ts` L455–557 (Fractions Check CLOSED + GRADED attempts; Unit 1 Test AFTER_CLOSE +3 days; Parts of Speech practice, 3 attempts, HIGHEST). Verified by code inspection: the dev DB has no MATH-7A, so this QA run could not execute it (the dev log records an idempotent fixture run) |
| FR-37 | PASS | No sidebar entry needed per FR-37; the course tab (`course-tabs.ts` L18) plus direct routes cover it |
| FR-38 | PASS | `qa-sh10.test.ts` asserts AuditLog actions `quiz.accommodation`, `quizAnswer.grade`, `quiz.regrade`, `quiz.release_results` |
| FR-39 | PASS | `QuestionEditor.tsx` (MarkdownEditor + FileUpload); `QuizGradingWorkspace.tsx` MarkdownView; `files/contexts.ts` `'quiz'` resolver; `quiz-service.ts` `attachPromptFiles` |
| NFR-1 | PASS | `serializers.test.ts` (no `correct` key); `qa-sh10.test.ts` (no `correct`/`explanation` in student quiz, attempt, or pre-release result JSON) |
| NFR-2 | PASS | `attempt-service.ts` `saveAnswer` (one read + one upsert); `qa-sh10.test.ts` median of 50 concurrent saves < 50 ms, upsert-only. Not load-tested at 300 users |
| NFR-3 | PASS | `QuizPlayer.tsx` native MUI Radio/Checkbox; `aria-live="assertive"` L329, announced at 5 and 1 min L286–288; e2e axe scan of `<main>` |
| NFR-4 | PASS | Grep found no banned imports (Tailwind/Radix/Recharts/notistack/etc.) and no `className` in quiz UI; BarChart from `@mui/x-charts`; the dev log records the mui-mcp lookups |
| NFR-5 | PASS | Every quiz route handler and page calls `requireUser`/`requireRole` (static check); `qa-sh10.test.ts` + `attempts.test.ts` NOT_FOUND for non-owners and non-managers |
| NFR-6 | PASS | Handlers use `withHandler` + `parseBody(zod)` + `ok()`; pagination in `listCourseQuizzes`; `CONFLICT` after deadline (`attempts.test.ts`) |
| NFR-7 | **FAIL** | Code lives in `src/server/quiz/` and reuses `grading-math`, `notify`, `audit`, `csv`, `logger`, MarkdownView and ConfirmDialog, with no new deps. **But `prisma/seed.ts:463` and `:526` add `console.log`** ("skipping its quizzes"). Fix: use `logger.info` (already imported at L3) |
| NFR-8 | **FAIL** | All the required tests exist and pass: grading/deadline/policy/serializer units, autosave-after-deadline / auto-submit / regrade integration, and the 4-step e2e. **But `npm run test` is not green**: 6 failures, all pre-existing and outside SH-10 (Headline 2). lint and typecheck are green |
| NFR-9 | PASS | Builder flow: add + type picker + per-type editor + publish (`QuizBuilder.tsx`, `QuestionList.tsx`). The e2e builds and publishes a 4-question quiz through the UI. No human timing study was done |
| NFR-10 | PASS | Out of scope, and none of it is present (grep for lockdown/webcam/question bank in `src` and the schema: no matches) |

## Recommended follow-ups (not blocking feature behaviour)
1. **NFR-7:** in `prisma/seed.ts` L463 and L526, change `console.log` to `logger.info`.
2. **NFR-8:** triage the 6 pre-existing failures (carried over from SH-9), or mark them as known so the suite can be green.
3. **Coverage gaps (low risk):** a unit test for the `useAutosave` offline queue/retry, and an e2e for builder duplicate, drag and preview.
4. **From the dev log, outside SH-10's scope:** NUL bytes in `renderEmail` previews (`EmailOutbox` insert rejected); the chained-refine `DecimalError` in `validators/assignments.ts`; the app-shell sidebar axe `list` violation.
