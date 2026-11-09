# File Structure — SH-10 · PRD-10 Quizzes & Online Exams

Phase: dev-planning · 2026-11-09T13:30:00Z. `+` = CREATE, `~` = MODIFY. No DELETEs, no new dependencies (ADR-1).
Per system-design §3.1, deadline/scoring/shuffle live in `grading.ts` (supersedes ADR-3's separate files).

```
prisma/
  ~ schema.prisma                      TASK-1
  ~ seed.ts                            TASK-22
prisma/migrations/20261110000000_add_quizzes/
  + migration.sql                      TASK-1
src/app/(app)/courses/[courseId]/quizzes/
  + CourseQuizzesView.tsx              TASK-15
  + page.tsx                           TASK-15
src/app/(app)/courses/[courseId]/quizzes/[quizId]/analytics/
  + QuizAnalytics.tsx                  TASK-21
  + page.tsx                           TASK-21
src/app/(app)/courses/[courseId]/quizzes/[quizId]/edit/
  + QuestionEditor.tsx                 TASK-17
  + QuestionList.tsx                   TASK-17
  + QuizBuilder.tsx                    TASK-18
  + QuizSettingsPanel.tsx              TASK-18
  + page.tsx                           TASK-18
src/app/(app)/courses/[courseId]/quizzes/[quizId]/grade/
  + QuizGradingWorkspace.tsx           TASK-20
  + page.tsx                           TASK-20
src/app/(app)/courses/[courseId]/quizzes/new/
  + page.tsx                           TASK-15
src/app/(app)/quizzes/[quizId]/attempts/[attemptId]/
  + page.tsx                           TASK-19
src/app/(app)/quizzes/[quizId]/take/
  + QuizPlayer.tsx                     TASK-16
  + page.tsx                           TASK-16
  + useAutosave.ts                     TASK-16
src/app/api/attempts/[id]/
  + route.ts                           TASK-13
src/app/api/attempts/[id]/answers/[questionId]/
  + route.ts                           TASK-13
src/app/api/attempts/[id]/answers/[questionId]/grade/
  + route.ts                           TASK-13
src/app/api/attempts/[id]/submit/
  + route.ts                           TASK-13
src/app/api/courses/[id]/quizzes/
  + route.ts                           TASK-11
src/app/api/internal/email/dispatch/
  ~ route.ts                           TASK-10
src/app/api/questions/[id]/
  + route.ts                           TASK-11
src/app/api/quizzes/[id]/
  + route.ts                           TASK-11
src/app/api/quizzes/[id]/accommodations/[studentId]/
  + route.ts                           TASK-12
src/app/api/quizzes/[id]/analytics/
  + route.ts                           TASK-12
src/app/api/quizzes/[id]/attempts/
  + route.ts                           TASK-13
src/app/api/quizzes/[id]/questions/
  + route.ts                           TASK-11
src/app/api/quizzes/[id]/questions/reorder/
  + route.ts                           TASK-11
src/app/api/quizzes/[id]/regrade/
  + route.ts                           TASK-12
src/app/api/quizzes/[id]/release-results/
  + route.ts                           TASK-12
src/config/
  ~ course-tabs.ts                     TASK-15
src/lib/validators/
  + quiz.ts                            TASK-2
src/server/files/
  ~ contexts.ts                        TASK-5
src/server/notifications/
  ~ types.ts                           TASK-5
src/server/quiz/
  + access.ts                          TASK-6
  + analytics.ts                       TASK-9
  + attempt-service.ts                 TASK-7
  + grading.ts                         TASK-3
  + maintenance.ts                     TASK-10
  + quiz-service.ts                    TASK-8
  + serializers.ts                     TASK-4
tests/e2e/
  + quizzes.spec.ts                    TASK-23
tests/integration/quiz/
  + attempts.test.ts                   TASK-14
  + regrade.test.ts                    TASK-14
tests/unit/quiz/
  + grading.test.ts                    TASK-3
  + quiz-validators.test.ts            TASK-2
  + serializers.test.ts                TASK-4
```

FR-37: no file (no sidebar entry, A1). NFR-10: scope fence, no file.
