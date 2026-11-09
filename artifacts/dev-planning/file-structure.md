# File Structure: SH-11 Gradebook, Grading Scales & Report Cards

Generated 2026-11-09T12:14:35Z. `+` = CREATE, `~` = MODIFY. Owning task in brackets. No deletions.

```
./
  ~ package.json  [TASK-9]
prisma/
  ~ schema.prisma  [TASK-1]
  ~ seed.ts  [TASK-32]
prisma/migrations/20261111000000_add_gradebook/
  + migration.sql  [TASK-1]
scripts/
  + gradebook-backfill.ts  [TASK-9]
src/app/(app)/admin/grading-scales/
  + GradingScalesClient.tsx  [TASK-22]
  + ScaleEditorDialog.tsx  [TASK-22]
  + page.tsx  [TASK-22]
src/app/(app)/admin/report-cards/
  + ReportCardsAdminClient.tsx  [TASK-29]
  + page.tsx  [TASK-29]
src/app/(app)/courses/[courseId]/assignments/
  ~ AssignmentForm.tsx  [TASK-24]
src/app/(app)/courses/[courseId]/gradebook/
  + page.tsx  [TASK-26]
src/app/(app)/courses/[courseId]/gradebook/settings/
  + GradebookSettingsClient.tsx  [TASK-23]
  + page.tsx  [TASK-23]
src/app/(app)/courses/[courseId]/grades/
  + page.tsx  [TASK-27]
src/app/(app)/courses/[courseId]/quizzes/[quizId]/edit/
  ~ QuizSettingsPanel.tsx  [TASK-24]
src/app/(app)/grades/
  + GradesClient.tsx  [TASK-27]
  + page.tsx  [TASK-27]
src/app/(app)/report-cards/
  + page.tsx  [TASK-30]
src/app/(app)/report-cards/[id]/
  + ReportCardReviewClient.tsx  [TASK-30]
  + page.tsx  [TASK-30]
src/app/(app)/report-cards/[id]/print/
  + page.tsx  [TASK-28]
src/app/(app)/report-cards/print/
  + page.tsx  [TASK-28]
src/app/(app)/students/[id]/grades/
  + page.tsx  [TASK-27]
src/app/(app)/students/[id]/report-cards/
  + page.tsx  [TASK-31]
src/app/api/courses/[id]/grade-categories/
  + route.ts  [TASK-13]
src/app/api/courses/[id]/grade-items/
  + route.ts  [TASK-15]
src/app/api/courses/[id]/gradebook/
  + route.ts  [TASK-15]
src/app/api/courses/[id]/term-overrides/[studentId]/
  + route.ts  [TASK-15]
src/app/api/grade-items/[id]/
  + route.ts  [TASK-15]
src/app/api/grade-items/[id]/grades/[studentId]/
  + route.ts  [TASK-15]
src/app/api/grade-items/[id]/mark-missing/
  + route.ts  [TASK-15]
src/app/api/grading-scales/
  + route.ts  [TASK-12]
src/app/api/grading-scales/[id]/
  + route.ts  [TASK-12]
src/app/api/report-cards/
  + route.ts  [TASK-19]
src/app/api/report-cards/[id]/
  + route.ts  [TASK-19]
src/app/api/report-cards/generate/
  + route.ts  [TASK-19]
src/app/api/report-cards/publish/
  + route.ts  [TASK-19]
src/app/api/report-cards/unpublish/
  + route.ts  [TASK-19]
src/app/api/students/[id]/grades/
  + route.ts  [TASK-16]
src/components/gradebook/
  + AddManualItemDialog.tsx  [TASK-25]
  + GradebookGrid.tsx  [TASK-26]
  + ItemStatsDialog.tsx  [TASK-25]
  + StudentGradesView.tsx  [TASK-27]
  + TermOverrideDialog.tsx  [TASK-25]
src/components/report-cards/
  + PrintButton.tsx  [TASK-28]
  + ReportCardDocument.tsx  [TASK-28]
src/config/
  ~ course-tabs.ts  [TASK-21]
  ~ navigation.ts  [TASK-21]
  ~ student-tabs.ts  [TASK-21]
src/lib/validators/
  ~ assignments.ts  [TASK-6]
  + gradebook.ts  [TASK-2]
  ~ quiz.ts  [TASK-7]
src/server/assignments/
  ~ assignments-service.ts  [TASK-6]
src/server/gradebook/
  + backfill.ts  [TASK-9]
  + categories-service.ts  [TASK-13]
  + grade-calc.ts  [TASK-3]
  + gradebook-service.ts  [TASK-14]
  + gradebook-sync.ts  [TASK-5]
  + load.ts  [TASK-10]
  + scales-service.ts  [TASK-12]
  + student-grades-service.ts  [TASK-16]
  + term-placement.ts  [TASK-4]
src/server/notifications/
  ~ types.ts  [TASK-11]
src/server/quiz/
  ~ attempt-service.ts  [TASK-7]
  ~ maintenance.ts  [TASK-7]
  ~ quiz-service.ts  [TASK-7]
src/server/report-cards/
  + access.ts  [TASK-17]
  + report-card-service.ts  [TASK-18]
  + snapshot.ts  [TASK-17]
tests/e2e/
  + gradebook.spec.ts  [TASK-33]
  + report-cards.spec.ts  [TASK-33]
tests/integration/gradebook/
  + backfill.test.ts  [TASK-9]
  + gradebook-sync.test.ts  [TASK-8]
tests/integration/report-cards/
  + report-cards.test.ts  [TASK-20]
tests/unit/gradebook/
  + grade-calc.test.ts  [TASK-3]
  + term-placement.test.ts  [TASK-4]
```

Notes:
- Base API path is `/api` (existing convention). Route handlers stay thin (withHandler -> Zod -> service -> ok()).
- `getStudentQuizScore` already exists in `src/server/quiz/attempt-service.ts`; reuse it (system-design A2 supersedes ADR-6).
- Sync module is `gradebook-sync.ts` (system-design) not `sync.ts` (ADR-5); backfill lives in `src/server/gradebook/backfill.ts` with a thin CLI in `scripts/`.
- Optional perf test (system-design §6, CI-skippable) intentionally not planned; add if NFR-2/NFR-3 need proof beyond QA.
- Migration dir timestamp `20261111000000` sorts after the latest existing migration (`20261110000000_add_quizzes`).
