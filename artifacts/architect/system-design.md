# System Design: PRD-16 Role Dashboards, Reports & Early-Warning Insights

Ticket: SH-16 · Phase: architect (arch-design-system) · Timestamp: 2026-11-10T14:00:00Z · Status: complete

Inputs: `artifacts/intake/requirements.json` (FR-1 to FR-46, NFR-1 to NFR-12), `artifacts/intake/handoff-to-architect.json`, `artifacts/architect/tech-stack-decisions.md` (ADR-1 to ADR-11), `artifacts/architect/requirements-analysis-notes.md`. The SH-15 version of this file was moved to `artifacts/architect/.prev-SH-15/system-design.md`.

---

## 1. Overview

PRD-16 replaces the placeholder `/dashboard` with three role dashboards (Admin, Teacher, Student), adds a rule-based early-warning engine with a persisted snapshot, an at-risk list page, a student "Insights" tab, and an admin Reports centre with six reports. This is a **brownfield** change (NFR-8). It adds no dependencies (ADR-1) and creates two new service folders, `src/server/dashboards/` and `src/server/reports/`.

Design principles:
- **Services are the single source.** Server-component widgets, the `/api/*` JSON routes and the CSV exports all call the same service functions. Routes are thin (NFR-6).
- **Scope is enforced inside services.** Every service function takes an `AccessUser` and intersects with `getAccessibleStudentIds()` (NFR-3).
- **Pure rules, batch loaders.** Risk thresholds are pure functions (NFR-9). Data for 600 students is loaded in a fixed number of grouped queries, never per student (NFR-1).
- **Cache only shared aggregates.** Admin and teacher-scoped aggregates use `unstable_cache`. Per-student widgets are cheap and not cached (ADR-3).

### Blockers and dependency gaps

Intake reported **no blockers** (`handoff-to-architect.json: blockers: []`, confidence 91 %). The following warnings are resolved by design decisions and are degraded rather than blocked:

| Gap | Requirements | Resolution |
|---|---|---|
| No `Announcement` model (PRD-12) | FR-8, FR-14, FR-38 | Announcement widgets render `EmptyState` "Announcements not available yet". The engagement report omits the read-rate metric and shows a note. The FR-9 "New announcement" quick action is hidden because its route does not exist. One `ANNOUNCEMENTS_AVAILABLE = false` constant in `src/server/dashboards/announcements.ts` gates all three, following the stub precedent `parent/overview-service.listUnreadAnnouncements` (ADR-11). **Dependency gap on PRD-12.** |
| No calendar service/API (PRD-14) | FR-21 | Read `CalendarEvent` directly with school-wide audience, expand recurrences with the existing `calendar/recurrence.expandOccurrences`, take the next 5. |
| FR-28 history conflicts with "one row per student per term" | FR-27, FR-28, FR-29, FR-31 | Keep one row per (student, term). Add `previousLevel` and a capped `history` Json (§4.1). |
| "Missing" is derived, not stored | FR-11, FR-25, FR-37 | One shared predicate `missingWork()` (§3.5), extracted from `assignments/reminders.ts`. |
| NFR-5 mui-mcp lookup | NFR-5 | Process step for dev and QA. If the MCP server is unavailable during dev, dev must report it as a blocker. |

---

## 2. Component Breakdown

### 2.1 Pages and UI (`src/app/(app)/…`)

| Path | Kind | Responsibility | Reqs |
|---|---|---|---|
| `dashboard/page.tsx` | Server page (edit) | Keep the PARENT → `/my-children` redirect. Switch on role and render `AdminDashboard`, `TeacherDashboard` or `StudentDashboard`. Any other role → `notFound()`. | FR-1 |
| `dashboard/_components/GreetingHeader.tsx` | Server | `greetingFor(now, tz)` + first name + school-tz date + `getCurrentTerm().name`. | FR-3, NFR-7 |
| `dashboard/_components/{Admin,Teacher,Student}Dashboard.tsx` | Server | MUI `Grid` layout of widgets. Each widget sits in `<Widget>`. | FR-1, FR-2 |
| `dashboard/_components/widgets/*.tsx` | Async server components, one per widget | Fetch through the service and render with MUI. Chart widgets pass serialisable props to a client chart component. | FR-4–FR-22 |
| `src/components/Widget/Widget.tsx` | Shared server wrapper (new) | MUI `Card` with a title, an optional "Updated N min ago" caption from `computedAt`, `<WidgetErrorBoundary>` and `<Suspense fallback={<LoadingSkeleton/>}>`. It is used by about 20 widgets, so the wrapper pays for itself. | FR-2, FR-24 |
| `src/components/Widget/WidgetErrorBoundary.tsx` | Client (new) | Class component with `getDerivedStateFromError`. It renders an `Alert` "This widget could not load" and a "Retry" `Button` that resets state and calls `router.refresh()`. | FR-2 |
| `src/components/charts/ChartA11y.tsx` | Client (new) | Wraps an x-charts chart with `aria-label={summary}` and a `visuallyHidden` MUI `Table` of the same rows. Used by every chart. | NFR-2 |
| `dashboard/_components/RefreshButton.tsx` | Client | ADMIN only. Sends `POST /api/dashboard/refresh`, shows a toast through `useToast`, then calls `router.refresh()`. | FR-24 |
| `insights/at-risk/page.tsx` | Server page (new) | `requireRole(['ADMIN','TEACHER'])`. Filters (level, reason, grade level, section) live in the URL search params. Uses the shared `DataTable` with level `Chip` (text, not colour only), reason chips, a trend arrow icon with an `aria-label`, and actions (open student → `/students/[id]/insights`; message parents → the existing PRD-13 new-conversation flow, prefilled). A CSV button links to `/api/insights/at-risk?…&format=csv`. | FR-29, FR-30, NFR-3 |
| `students/[id]/insights/page.tsx` | Server page (new) | `assertCanViewStudent`. Shows the current signal values (attendance %, courses below 60 %, missing count), the level badge and a history list from `snapshot.history`. | FR-31, FR-43 |
| `admin/reports/page.tsx` + `admin/reports/[reportKey]/page.tsx` | Server pages (new) | ADMIN. The index lists the six reports. The report page has an academic-year/term selector and report filters (x-date-pickers for date ranges) in the URL, then a chart, a `DataTable` and a CSV link. Unknown `reportKey` → `notFound()`. | FR-33–FR-39, FR-44 |
| `src/config/navigation.ts` | Config (edit) | After "Dashboard": `Reports` (`/admin/reports`, ADMIN) and `At-risk students` (`/insights/at-risk`, ADMIN and TEACHER). | FR-40 |
| `src/config/student-tabs.ts` | Config (edit) | Append `{ key: 'insights', label: 'Insights', href: id => \`/students/${id}/insights\`, roles: ['ADMIN','TEACHER'] }`. | FR-31 |

Reused components (NFR-8): `StatCard`, `DataTable`, `LoadingSkeleton`, `PageHeader`, `EmptyState`, `Toast`/`useToast`. Charts: `LineChart` with `ChartsReferenceLine`, `BarChart` (stacked, histogram) and `Gauge` from `@mui/x-charts` 9.5.0 (NFR-4).

### 2.2 Services — `src/server/dashboards/`

| File | Exports | Reqs |
|---|---|---|
| `teacher.ts` | `getTodaysClasses(user)` (wraps `attendance-service.getToday` + `nowAndNext`), `getToGrade(user)` (count + oldest 5 ungraded submissions and quiz attempts needing manual grading), `getUpcomingDeadlines(user)` (next 7 days, submission rate = submissions / active enrolments, one grouped query), `getTeacherMessages(user)` (`messaging/conversations.unreadCount` + announcements stub). | FR-4, FR-5, FR-6, FR-8 |
| `student.ts` | `getStudentToday(user)` → `parent/overview-service.getToday(user, user.id)` (holiday-aware). `getDueSoon(user)` (next 7 days + `missingWork`, overdue first, flagged `overdue: true`). `getRecentGrades(user)` → overview-service. `getMyCourses(user)` (`getStudentGrades` for percent/letter, LessonProgress ratio, first incomplete visible lesson). `getTermAttendance(user)` (`countStatuses` + `attendanceRate` over the term range). | FR-10–FR-15 |
| `admin.ts` | `getKpis()` (cached): active students, active teachers, today's rate and the same weekday −7 days delta via `attendance-service.getOverview`, missing registers, pending absence notes. `getSafeguardingCount(user)` is **uncached** and only called when `isSafeguardingLead(user)`, so the count never sits in a shared cache entry. `getAttendanceTrend()` (cached). `getEnrollmentByGrade()` (cached). `getGradeDistribution()` (cached; uses the §3.4 batch loader). `getUpcomingEvents()`. `getRecentActivity()` (AuditLog `action` startsWith `user.`/`report_card.`/`settings.`, latest 10, actor joined). | FR-16–FR-19, FR-21, FR-22 |
| `insights.ts` | The `unstable_cache` wrappers and tag constants (§3.6). `getRiskSummary(user)` (counts by level and reason). `getTopAtRisk(user, n)`. | FR-7, FR-20, FR-23, FR-24 |
| `risk-rules.ts` | **Pure.** `attendanceSignal(pct, threshold)`, `gradesSignal(coursePcts)`, `missingSignal(count)`, `overallLevel(signals)`, `formatReason(signal)`. No Prisma import. | FR-25, FR-26, NFR-9, NFR-11 |
| `risk.ts` | `loadRiskInputs(termId, studentIds)` (batch). `recomputeRiskSnapshots({ force })`: hourly gate, compute, upsert, history append, FR-32 notify, `revalidateTag`. `listAtRisk(user, filters, page)`. `getStudentInsights(user, studentId)`. | FR-25–FR-32, FR-42, FR-43 |
| `missing-work.ts` | `missingWork({ studentIds, from, to, now })` → `Map<studentId, {assignmentId, dueAt, courseId}[]>`. The shared predicate (§3.5). `assignments/reminders.ts` is refactored to call it with its own 8-day window, keeping its behaviour. | FR-11, FR-25, FR-37 |
| `announcements.ts` | `ANNOUNCEMENTS_AVAILABLE = false`, `latestAnnouncements()` → `[]`. | FR-8, FR-14, FR-38 |

`greetingFor(now, tz)` and `schoolDaysBack(n, tz)` (the last n dates with at least one `AttendanceSession`) go in `src/lib/dates.ts` next to the existing helpers (ADR-9).

### 2.3 Services — `src/server/reports/`

| File | Responsibility | Reqs |
|---|---|---|
| `index.ts` | `REPORTS` registry: `key → { title, filterSchema (Zod), run(filters) → { chart, rows, summary }, columns }`. `REPORT_KEYS = Object.keys(REPORTS)`. The page, the API and the CSV all read this registry, so CSV rows equal table rows (FR-35 AC 7) and an unknown key is a 404. | FR-33, FR-44 |
| `enrollment.ts` | Active students by grade level × section × gender (`groupBy`). New enrollments and archives by month (`$queryRaw date_trunc('month', … AT TIME ZONE tz)`). | FR-34 |
| `attendance.ts` | Calls `attendance-service.getReport(filters)` for per-student rows, then rolls up by grade level, section or course. Daily trend. Lowest 20 students. | FR-35 |
| `performance.ts` | Uses the §3.4 batch grade loader. Average percent and letter distribution (`letterFor`) by course and by subject. Section comparison for the same grade × subject. | FR-36 |
| `completion.ts` | On-time / late (`submittedAt` vs `dueAt`) / missing (`missingWork`) rates by course and by teacher for a date range. | FR-37 |
| `engagement.ts` | Lesson completion by course (LessonProgress). Distinct parents signed in over the last 7 and 30 days (`AuditLog action='auth.login.success'` joined to PARENT users, with `User.lastLoginAt` as a fallback). Announcement read rate is omitted with a note. | FR-38 |
| `workload.ts` | Per teacher: courses, distinct students, weekly `TimetableSlot` count, grading backlog (same query as `getToGrade`, grouped by teacher). | FR-39 |

### 2.4 API routes (`src/app/api/…`, thin: `withHandler` → `requireRole` → `parseQuery` (Zod) → service → `ok`/`paginated`/CSV)

| Route | Roles | Service | Reqs |
|---|---|---|---|
| `GET /api/dashboard/teacher` | TEACHER | `dashboards/teacher.*` + `getTopAtRisk` | FR-41 |
| `GET /api/dashboard/student` | STUDENT | `dashboards/student.*` | FR-41 |
| `GET /api/dashboard/admin` | ADMIN | `dashboards/admin.*` + `getRiskSummary` | FR-41 |
| `POST /api/dashboard/refresh` | ADMIN | `recomputeRiskSnapshots({ force: true })`, then `revalidateTag` on all tags, then `audit({ action: 'dashboard.refresh' })` | FR-24, FR-27 |
| `GET /api/insights/at-risk` | ADMIN, TEACHER | `listAtRisk`. Query: `level, reason, gradeLevel, sectionId, page, pageSize ≤ 100, format=csv` | FR-29, FR-30, FR-42 |
| `GET /api/students/[id]/insights` | ADMIN, TEACHER of the student | `getStudentInsights` (`assertCanViewStudent` → FORBIDDEN) | FR-43 |
| `GET /api/reports/[reportKey]` | ADMIN | `REPORTS[key].run`. `?format=csv` → `toCsv(columns, rows)` with `Content-Disposition: attachment`. Unknown key → 404 `NOT_FOUND` | FR-44 |

Validators: `src/lib/validators/dashboards.ts` (at-risk filters, insights params) and `src/lib/validators/reports.ts` (`reportKey` enum + per-report filter schemas) (NFR-6).

### 2.5 Background job

`src/app/api/internal/email/dispatch/route.ts` gets one more isolated `try { await recomputeRiskSnapshots() } catch (e) { logger.error(...) }` block. The gate is in the database: skip if `max(computedAt)` for the current term is under 60 minutes old (FR-27, NFR-12, ADR-6).

### 2.6 Notifications

Add `'insights.student_high_risk'` to `NOTIFICATION_TYPES` in `src/server/notifications/types.ts` (category ACADEMIC, recipient TEACHER, email default `true`). Send it through the existing `notify()` (FR-32).

### 2.7 Seed

- `prisma/seed-large.ts` + `"seed:large": "tsx prisma/seed-large.ts"`: a mulberry32 PRNG with a fixed seed, 600 students across Grades 6–8 (8 sections), 40 teachers, timetables, 60 school days of attendance, assignments, submissions and grades. Uses `createMany` in batches of 1,000 (FR-45).
- `prisma/seed.ts` (edit): plant at least 3 students per level (High, Medium and none) by seeding attendance, grades and missing work that cross the FR-25 thresholds. At the end it calls `recomputeRiskSnapshots({ force: true })` so the list is populated right after seeding (FR-46).

---

## 3. Data Flow

### 3.1 Dashboard request

```
GET /dashboard
  └─ page.tsx (server): getCurrentUser() ─ PARENT → redirect('/my-children')
       └─ <RoleDashboard>  → streams shell + GreetingHeader immediately (NFR-1 first content)
            ├─ <Widget title="To grade"><Suspense><ToGradeWidget/></Suspense></Widget>
            │      └─ dashboards/teacher.getToGrade(user) ── Prisma (scoped)
            ├─ <Widget title="At-risk students">… insights.getTopAtRisk(user,5)
            │      └─ unstable_cache(['risk','teacher',userId], {revalidate:3600, tags:['insights:at-risk']})
            │            └─ StudentRiskSnapshot WHERE studentId IN accessible
            └─ … each widget streams independently; a throw inside one → WidgetErrorBoundary → Alert + Retry
```

### 3.2 Admin refresh

```
RefreshButton → POST /api/dashboard/refresh (ADMIN)
  → risk.recomputeRiskSnapshots({force:true})
  → revalidateTag('dashboard:admin'), ('dashboard:teacher'), ('insights:at-risk')
  → audit('dashboard.refresh') → 200 { data: { refreshedAt } }
  → client: toast + router.refresh() → widgets re-render with new computedAt
```

### 3.3 Risk recompute (hourly cron or Refresh)

```
recomputeRiskSnapshots({force})
 1. term = getCurrentTerm(); none → return { skipped: 'no-term' }
 2. if !force and max(computedAt where termId) > now−60min → return { skipped: 'fresh' }
 3. students = ACTIVE students enrolled in the current term
 4. inputs = loadRiskInputs(term, students)            ← fixed number of grouped queries
      attendancePct  : AttendanceRecord groupBy(studentId,status) in term range → attendanceRate()
      coursePcts     : batch grade loader (§3.4) → computeStudentTerm per (student,course)
      missingCount   : missingWork({from: today−30d, to: now})
 5. for each student: signals = [attendanceSignal, gradesSignal, missingSignal]; level = overallLevel(signals)
 6. upsert StudentRiskSnapshot(studentId, termId):
      level changed → previousLevel = old.level; history = [ {level,reasons,computedAt}, ...old.history ].slice(0,10)
      unchanged     → update reasons, signals, computedAt only
 7. for each (old ∈ {null, MEDIUM}) → HIGH:
      claimed = updateMany(where {id, OR:[highNotifiedAt null, highNotifiedAt < now−14d]}, data {highNotifiedAt: now})
      claimed.count === 1 && homeroomTeacherId → notify(homeroomTeacher, 'insights.student_high_risk', {studentId, reasons})
      no homeroom teacher → logger.warn, skip
 8. revalidateTag('insights:at-risk')
```

Upserts run in chunked `$transaction`s of about 100 rows. Step 7 uses an atomic claim, so two concurrent cron processes cannot double-notify (§3 Q8 of the notes).

Risk rules (FR-25, FR-26). These are pure functions, and every boundary has a unit test (NFR-9):

| Signal | Medium | High | No data |
|---|---|---|---|
| Attendance | `pct < threshold` (SchoolSettings.attendanceAlertThreshold, default 90) | `pct < 80` | no records → null |
| Grades | any course `< 60` | `≥ 2` courses `< 60` **or** any `< 50` | null percents ignored |
| Missing (30 days) | 3–4 | `≥ 5` | 0–2 → null |
| **Overall** | exactly one Medium | any High **or** ≥ 2 Medium | otherwise none (`level = null`) |

The reasons Json is an array of `{ signal: 'ATTENDANCE'|'GRADES'|'MISSING', level, value, label }`. Labels look like `"Attendance 78 %"`, `"2 courses < 60 %"` and `"6 missing"`, and the chips and CSV use them directly.

### 3.4 Batch grade loader (shared by FR-19, FR-25 and FR-36)

`gradebook/batch-grades.ts` exports `loadTermPercents(termId, studentIds?)`. It runs about 5 queries: courses in the term with their scales, grade items, grades, categories and overrides. It groups the rows in memory and calls the existing pure `computeStudentTerm` for each (student, course). The result is `Map<studentId, {courseId, percent, letter}[]>`. Because it uses the same calculation as `getStudentGrades`, dashboard and report numbers equal the Grades tab (FR-13, NFR-8). FR-13 itself calls `getStudentGrades` directly, since it is a single student.

### 3.5 Missing-work predicate

The predicate is: the assignment is published (`visibleWhere(now)`), `dueAt ∈ [from, min(to, now))`, `submissionType ≠ NO_SUBMISSION`, the student is actively enrolled in the course, there is no `Submission`, and there is no `GradeExemption`. It runs as one query for the assignments in the window joined to active enrolments, then subtracts submissions and exemptions in memory. FR-11 uses a "term start → now" window for overdue items, FR-25 uses 30 days, and FR-37 uses the report's date range.

### 3.6 Cache keys and tags (FR-23, NFR-3)

| Cached function | Key parts | revalidate | Tags |
|---|---|---|---|
| `admin.getKpis` (without safeguarding) | `['dash','admin','kpis', today]` | 900 | `dashboard:admin` |
| `admin.getAttendanceTrend` | `['dash','admin','trend', today]` | 900 | `dashboard:admin` |
| `admin.getEnrollmentByGrade` | `['dash','admin','enrollment']` | 900 | `dashboard:admin` |
| `admin.getGradeDistribution` | `['dash','admin','grades', termId]` | 900 | `dashboard:admin` |
| teacher `getToGrade`, `getUpcomingDeadlines` | `['dash','teacher', userId, …]` | 900 | `dashboard:teacher` |
| `insights.getRiskSummary` / `getTopAtRisk` | `['risk', 'admin']` or `['risk','teacher', userId]` | 3600 | `insights:at-risk` |

Every cached value is `{ data, computedAt: string }` and contains no `Date` or `Decimal`. Teacher keys always include `userId`, so no cache entry is ever shared across teachers. The safeguarding count and all student widgets are never cached. `getTodaysClasses` is not cached either, because the attendance taken/not-taken state must be live.

`ponytail:` the cache is per process (ADR-3). Add a shared cache handler if the app runs on more than one instance.

### 3.7 At-risk list and CSV (FR-29, FR-30, FR-42)

```
GET /api/insights/at-risk?level&reason&gradeLevel&sectionId&page&format
 → scope = getAccessibleStudentIds(user)           // 'ALL' | ids
 → where = { termId: current, level: not null,
             studentId: scope==='ALL' ? undefined : { in: scope },     // intersection: filters can't widen
             level?, reasons: reason ? { array_contains: [{signal}] } : undefined,
             student: { sectionMembers: { some: { section: { gradeLevel?, id: sectionId? } } } } }
 → format=csv ? toCsv(AT_RISK_COLUMNS, allRows) : paginated(rows, page, pageSize)
```

The page and the CSV both call `listAtRisk`, so the CSV matches the filtered table. Sort order: HIGH before MEDIUM, then by the number of reasons descending, then by name. The trend is `up` when the level rose since `previousLevel`, `down` when it fell, and `flat` otherwise.

---

## 4. Data Model Changes (one migration: `add_student_risk_snapshot`)

### 4.1 Prisma

```prisma
enum RiskLevel {
  MEDIUM
  HIGH
}

model StudentRiskSnapshot {
  id             String     @id @default(cuid())
  studentId      String
  termId         String
  level          RiskLevel?          // null = none
  previousLevel  RiskLevel?          // FR-28 trend arrow
  reasons        Json                // [{signal, level, value, label}]
  signals        Json                // {attendancePct, coursesBelow60, lowestCoursePct, missingCount} for the Insights tab
  history        Json     @default("[]")  // FR-28: last 10 level changes [{level, reasons, computedAt}]
  highNotifiedAt DateTime?           // FR-32 14-day claim
  computedAt     DateTime
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt
  student        User       @relation(fields: [studentId], references: [id], onDelete: Cascade)
  term           Term       @relation(fields: [termId], references: [id], onDelete: Cascade)

  @@unique([studentId, termId])
  @@index([termId, level])
  @@index([termId, computedAt])
}
```

`User` and `Term` get back-relations. `history` is appended only when the level changes, so hourly runs do not grow it. `ponytail:` it is capped at 10 entries. Add a history table if long-range trend analytics are ever needed (ADR-5).

### 4.2 Optional index

Add `AuditLog @@index([createdAt])` only if `EXPLAIN` on `seed:large` shows the FR-22 query is slow (ADR-7). It is not in the base migration.

---

## 5. Security and Privacy

- **Authorization.** Every page and handler calls `requireRole`. Services re-check scope: they take `AccessUser`, read `getAccessibleStudentIds`, and **intersect** it with filters (NFR-3, FR-42). The student insights endpoint uses `assertCanViewStudent` → 403 FORBIDDEN.
- **Cache isolation.** Teacher keys include `userId`. The safeguarding count is never cached and is shown only when `isSafeguardingLead` (FR-16).
- **CSV.** Every export goes through `src/server/csv.ts` `toCsv`/`escapeCsvCell`, which guards against formula injection (FR-30, FR-33).
- **SQL.** Only tagged-template `$queryRaw`. `$queryRawUnsafe` is never used (ADR-7).
- **Audit.** `dashboard.refresh` is audited. Report reads are not audited, which matches the existing admin read endpoints.
- **Notification content.** The notification contains the student name and reason labels only, no grades detail, and links to `/students/[id]/insights`, which is scope-checked.

## 6. Performance (NFR-1)

| Surface | Budget | How it is met |
|---|---|---|
| Dashboards: first content | < 1.5 s | The shell and greeting render without waiting. Widgets stream behind Suspense. Admin aggregates are cached for 15 minutes. At-risk data is read from the snapshot table and never computed live. |
| Reports | < 3 s | Grouped queries and `$queryRaw` bucketing. The batch grade loader uses about 5 queries. No per-student loops. |
| Risk recompute | Background | About 10 queries + chunked upserts for 600 students. It runs at most hourly. |

Dev must measure these against `seed:large` and add indexes only where `EXPLAIN` shows a sequential-scan hotspot.

## 7. Testing hooks (NFR-9, NFR-10)

- **Unit (Vitest):** `risk-rules.ts` boundaries: 90/89.9, 80/79.9, 60/59.9, 50/49.9, missing counts 2/3/4/5, Medium+Medium → High, threshold override. Also `greetingFor` hour boundaries in the tz, and the `missingWork` window edges.
- **Integration:** each report's `run()` on the default seed with known totals. CSV rows equal table rows. The at-risk scope intersection: a teacher filtering by another section gets 0 rows outside scope. Refresh revalidates the cache, so `computedAt` changes. The FR-32 14-day claim fires only once. The default seed yields at least 3 students per level (FR-46).
- **E2E (Playwright + axe):** one spec per role dashboard plus the parent redirect, `/insights/at-risk`, and `/admin/reports/attendance` with CSV download.
- **Lint:** no `console.log`. Logging uses `src/lib/logger.ts`.

## 8. Out of scope (NFR-11)

No drag-and-drop layouts, no ML scoring, no scheduled report emails, and no changes to PRD-17/18 behaviour. No Announcement model or calendar API is built here (they are dependency gaps, §1).

---

## 9. Requirements Traceability

| Req | Design element |
|---|---|
| FR-1 | `dashboard/page.tsx` role switch + PARENT redirect kept (§2.1) |
| FR-2 | `Widget` + `WidgetErrorBoundary` + Suspense/`LoadingSkeleton` (§2.1, §3.1) |
| FR-3 | `GreetingHeader`, `greetingFor` in `src/lib/dates.ts`, `getCurrentTerm` |
| FR-4 | `teacher.getTodaysClasses` (attendance-service `getToday` + `nowAndNext`), live |
| FR-5 | `teacher.getToGrade`, cached per teacher |
| FR-6 | `teacher.getUpcomingDeadlines` |
| FR-7 | `insights.getTopAtRisk(user, 5)` from snapshots |
| FR-8 | `teacher.getTeacherMessages`: `unreadCount` + announcements stub (§1 gap) |
| FR-9 | `QuickActionsWidget`: static MUI links; "New announcement" hidden (§1) |
| FR-10 | `student.getStudentToday` → overview-service `getToday` |
| FR-11 | `student.getDueSoon` + `missingWork` (§3.5) |
| FR-12 | `student.getRecentGrades` → overview-service |
| FR-13 | `student.getMyCourses` → `getStudentGrades` + LessonProgress |
| FR-14 | `announcements.latestAnnouncements` → `EmptyState` (§1) |
| FR-15 | `student.getTermAttendance` + x-charts `Gauge` |
| FR-16 | `admin.getKpis` (cached) + uncached `getSafeguardingCount` for leads |
| FR-17 | `admin.getAttendanceTrend` + `LineChart` + `ChartsReferenceLine` at the threshold |
| FR-18 | `admin.getEnrollmentByGrade` + stacked `BarChart` |
| FR-19 | `admin.getGradeDistribution` via the batch grade loader (§3.4) |
| FR-20 | `insights.getRiskSummary` |
| FR-21 | `admin.getUpcomingEvents` (CalendarEvent + `expandOccurrences`) |
| FR-22 | `admin.getRecentActivity` (AuditLog prefixes) |
| FR-23 | `insights.ts` `unstable_cache` wrappers (§3.6) |
| FR-24 | `computedAt` → "Updated N min ago"; `RefreshButton` + `POST /api/dashboard/refresh` (§3.2) |
| FR-25 | `risk-rules.ts` signals + `risk.loadRiskInputs` (§3.3) |
| FR-26 | `risk-rules.overallLevel` |
| FR-27 | `StudentRiskSnapshot` model + migration; cron hook with DB gate (§2.5, §4.1) |
| FR-28 | `previousLevel` + capped `history` Json (§4.1) |
| FR-29 | `/insights/at-risk` page + `risk.listAtRisk` (§3.7) |
| FR-30 | URL filters + `toCsv` from the same `listAtRisk` |
| FR-31 | `studentTabs` 'insights' entry + `students/[id]/insights` page |
| FR-32 | Step 7 of §3.3: atomic `highNotifiedAt` claim + `notify('insights.student_high_risk')` |
| FR-33 | `/admin/reports` + `REPORTS` registry + year/term selector + CSV (§2.3) |
| FR-34 | `reports/enrollment.ts` |
| FR-35 | `reports/attendance.ts` (reuses `attendance-service.getReport`) |
| FR-36 | `reports/performance.ts` (batch grade loader + `letterFor`) |
| FR-37 | `reports/completion.ts` + `missingWork` |
| FR-38 | `reports/engagement.ts`; announcement read rate omitted (§1) |
| FR-39 | `reports/workload.ts` |
| FR-40 | `src/config/navigation.ts` entries |
| FR-41 | `/api/dashboard/{teacher,student,admin}` GET + `/refresh` POST (§2.4) |
| FR-42 | `GET /api/insights/at-risk` with scope intersection (§3.7) |
| FR-43 | `GET /api/students/[id]/insights` + `assertCanViewStudent` |
| FR-44 | `GET /api/reports/[reportKey]`, registry-validated, 404 for unknown keys |
| FR-45 | `prisma/seed-large.ts` + `seed:large` script (§2.7) |
| FR-46 | `prisma/seed.ts` planted risk cohorts + forced recompute (§2.7) |
| NFR-1 | Streaming widgets, caching, batch loaders, snapshot reads (§6) |
| NFR-2 | `ChartA11y` aria summary + visually hidden table; text badges (§2.1) |
| NFR-3 | Scope in services, intersection, per-teacher cache keys (§5) |
| NFR-4 | MUI / MUI X only; shared components reused (§2.1) |
| NFR-5 | mui-mcp lookup as a dev/QA process step; unavailability = blocker (§1) |
| NFR-6 | Thin handlers, validators files, `paginated`, service folders (§2.4) |
| NFR-7 | `src/lib/dates.ts` / `schoolToday` for every window; SQL `AT TIME ZONE` |
| NFR-8 | Reuse table in §2 (attendance-service, grade-calc, overview-service, csv, notify, audit, components) |
| NFR-9 | Test hooks in §7 |
| NFR-10 | `logger` only; lint/typecheck/test green (§7) |
| NFR-11 | Out of scope (§8); rule-based `risk-rules.ts` |
| NFR-12 | 3600 s risk cache + hourly DB-gated recompute (§2.5, §3.6) |
