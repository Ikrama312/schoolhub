# File Structure: SH-16 (PRD-16 Role Dashboards, Reports & Early-Warning Insights)

Phase: dev-planning · 2026-11-10T15:00:00Z · Brownfield. Only the files this ticket touches are listed.
`[C]` = CREATE and `[M]` = MODIFY. `(TASK-n)` names the task that owns the file. The source of truth is `file-ownership-matrix.json`.

```
package.json                                                    [M] (TASK-29)  "seed:large" script
prisma/
├── schema.prisma                                               [M] (TASK-1)   RiskLevel + StudentRiskSnapshot
├── migrations/20261115000000_add_student_risk_snapshot/
│   └── migration.sql                                           [C] (TASK-1)
├── seed.ts                                                     [M] (TASK-28)  ≥3 students per risk level
└── seed-large.ts                                               [C] (TASK-29)  600 students, mulberry32
src/
├── lib/
│   ├── dates.ts                                                [M] (TASK-3)   greetingFor, schoolDaysBack
│   └── validators/
│       ├── dashboards.ts                                       [C] (TASK-6)
│       └── reports.ts                                          [C] (TASK-6)
├── config/
│   ├── navigation.ts                                           [M] (TASK-27)
│   └── student-tabs.ts                                         [M] (TASK-22)
├── components/
│   ├── Widget/
│   │   ├── Widget.tsx                                          [C] (TASK-15)  Card + Suspense + boundary
│   │   └── WidgetErrorBoundary.tsx                             [C] (TASK-15)  client
│   └── charts/
│       └── ChartA11y.tsx                                       [C] (TASK-15)  client, aria + hidden table
├── server/
│   ├── assignments/reminders.ts                                [M] (TASK-4)   uses missingWork
│   ├── gradebook/batch-grades.ts                               [C] (TASK-5)   loadTermPercents
│   ├── notifications/types.ts                                  [M] (TASK-7)   insights.student_high_risk
│   ├── dashboards/
│   │   ├── risk-rules.ts                                       [C] (TASK-2)   pure
│   │   ├── missing-work.ts                                     [C] (TASK-4)
│   │   ├── insights.ts                                         [C] (TASK-8)   cache helper + tags + risk summary
│   │   ├── announcements.ts                                    [C] (TASK-8)   ANNOUNCEMENTS_AVAILABLE=false
│   │   ├── risk.ts                                             [C] (TASK-9)   recompute, listAtRisk, insights
│   │   ├── teacher.ts                                          [C] (TASK-11)
│   │   ├── student.ts                                          [C] (TASK-12)
│   │   └── admin.ts                                            [C] (TASK-13)
│   └── reports/
│       ├── enrollment.ts                                       [C] (TASK-23)
│       ├── attendance.ts                                       [C] (TASK-23)
│       ├── performance.ts                                      [C] (TASK-23)
│       ├── completion.ts                                       [C] (TASK-24)
│       ├── engagement.ts                                       [C] (TASK-24)
│       ├── workload.ts                                         [C] (TASK-24)
│       └── index.ts                                            [C] (TASK-25)  REPORTS registry
└── app/
    ├── (app)/
    │   ├── dashboard/
    │   │   ├── page.tsx                                        [M] (TASK-16)
    │   │   └── _components/
    │   │       ├── GreetingHeader.tsx                          [C] (TASK-16)
    │   │       ├── RefreshButton.tsx                           [C] (TASK-16)  client
    │   │       ├── TeacherDashboard.tsx                        [C] (TASK-17)
    │   │       ├── StudentDashboard.tsx                        [C] (TASK-18)
    │   │       ├── AdminDashboard.tsx                          [C] (TASK-19)
    │   │       └── widgets/
    │   │           ├── TodaysClassesWidget.tsx                 [C] (TASK-17)
    │   │           ├── ToGradeWidget.tsx                       [C] (TASK-17)
    │   │           ├── UpcomingDeadlinesWidget.tsx             [C] (TASK-17)
    │   │           ├── AtRiskWidget.tsx                        [C] (TASK-17)
    │   │           ├── TeacherMessagesWidget.tsx               [C] (TASK-17)
    │   │           ├── QuickActionsWidget.tsx                  [C] (TASK-17)
    │   │           ├── StudentTodayWidget.tsx                  [C] (TASK-18)
    │   │           ├── DueSoonWidget.tsx                       [C] (TASK-18)
    │   │           ├── RecentGradesWidget.tsx                  [C] (TASK-18)
    │   │           ├── MyCoursesWidget.tsx                     [C] (TASK-18)
    │   │           ├── AnnouncementsWidget.tsx                 [C] (TASK-18)
    │   │           ├── TermAttendanceWidget.tsx                [C] (TASK-18)
    │   │           ├── KpiRowWidget.tsx                        [C] (TASK-19)
    │   │           ├── AttendanceTrendWidget.tsx               [C] (TASK-19)
    │   │           ├── EnrollmentByGradeWidget.tsx             [C] (TASK-19)
    │   │           ├── GradeDistributionWidget.tsx             [C] (TASK-19)
    │   │           ├── RiskSummaryWidget.tsx                   [C] (TASK-19)
    │   │           ├── UpcomingEventsWidget.tsx                [C] (TASK-19)
    │   │           └── RecentActivityWidget.tsx                [C] (TASK-19)
    │   ├── insights/at-risk/
    │   │   ├── page.tsx                                        [C] (TASK-21)
    │   │   └── _components/AtRiskFilters.tsx                   [C] (TASK-21)  client
    │   ├── students/[id]/insights/page.tsx                     [C] (TASK-22)
    │   └── admin/reports/
    │       ├── page.tsx                                        [C] (TASK-26)
    │       └── [reportKey]/
    │           ├── page.tsx                                    [C] (TASK-26)
    │           └── _components/ReportFilters.tsx               [C] (TASK-26)  client
    └── api/
        ├── dashboard/{teacher,student,admin,refresh}/route.ts  [C] (TASK-20)
        ├── insights/at-risk/route.ts                           [C] (TASK-21)
        ├── students/[id]/insights/route.ts                     [C] (TASK-22)
        ├── reports/[reportKey]/route.ts                        [C] (TASK-26)
        └── internal/email/dispatch/route.ts                    [M] (TASK-14)  hourly recompute hook
tests/
├── unit/
│   ├── dashboards/risk-rules.test.ts                           [C] (TASK-2)
│   ├── dates.test.ts                                           [M] (TASK-3)
│   └── WidgetErrorBoundary.test.tsx                            [C] (TASK-15)
├── integration/
│   ├── dashboards/missing-work.test.ts                         [C] (TASK-4)
│   ├── gradebook/batch-grades.test.ts                          [C] (TASK-5)
│   ├── dashboards/risk.test.ts                                 [C] (TASK-10)
│   ├── email-dispatch.test.ts                                  [M] (TASK-14)
│   ├── dashboards/dashboard-api.test.ts                        [C] (TASK-20)
│   └── reports/reports.test.ts                                 [C] (TASK-25)
└── e2e/
    ├── dashboard.spec.ts                                       [M] (TASK-30)
    ├── insights.spec.ts                                        [C] (TASK-30)
    └── reports.spec.ts                                         [C] (TASK-30)
```

Reused without changes (NFR-8): `StatCard`, `DataTable`, `LoadingSkeleton`, `PageHeader`, `EmptyState`, `Toast`/`useToast`, `src/server/csv.ts`, `src/server/http.ts`, `attendance-service`, `grade-calc`/`student-grades-service`, `parent/overview-service`, `calendar/recurrence`, `notify()`, `audit()`, `auth/student-access`.

## Suggested execution order

1. **Foundations** (no dependencies, parallel): TASK-1, TASK-2, TASK-3, TASK-4, TASK-5, TASK-6, TASK-7, TASK-15
2. **Engine:** TASK-8 → TASK-9 → TASK-10, TASK-14, TASK-28, TASK-29
3. **Services:** TASK-11, TASK-12, TASK-13, TASK-23, TASK-24 → TASK-25
4. **UI and API:** TASK-17, TASK-18, TASK-19 → TASK-16. Then TASK-20, TASK-21, TASK-22, TASK-26 → TASK-27
5. **E2E:** TASK-30
