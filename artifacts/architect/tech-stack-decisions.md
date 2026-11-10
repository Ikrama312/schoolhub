# Tech Stack Decisions: PRD-16 Role Dashboards, Reports & Early-Warning Insights

Ticket: SH-16 · Phase: architect (arch-research-stack) · Timestamp: 2026-11-10T13:00:00Z · Status: complete

> This file replaces the SH-15 version. The other files in `artifacts/architect/` are still from SH-15 until their own sub-tasks rewrite them.

**Summary:** keep intake's detected stack (`react`, 98 %). It meets every FR/NFR. **No new runtime or dev dependencies.** All of the following are already installed and pinned in `package.json`: Next.js 14.2.18 App Router, React 18.3.1, TypeScript strict, MUI 9.5.0 with `@mui/x-charts`, `@mui/x-data-grid` and `@mui/x-date-pickers` 9.5.0, Prisma 5.20.0 on PostgreSQL 16, Auth.js 5.0.0-beta.25, Zod 3.23.8, date-fns 3.6.0 with date-fns-tz 3.2.0, Vitest 2.1.1, Playwright 1.47.2 with `@axe-core/playwright` 4.10.0, and tsx 4.16.2.

Verified in the codebase: `src/server/dashboards/` and `src/server/reports/` do not exist yet. There is no `unstable_cache` or `revalidateTag` usage, no React error boundary, and no `seed:large` script. `@mui/x-charts` is already used in `QuizAnalytics.tsx`. `src/lib/dates.ts` and `src/server/csv.ts` already provide the timezone and CSV helpers.

---

## ADR-1: Keep the existing stack and add no dependencies

**Context:** NFR-8 (brownfield reuse), NFR-4 (MUI-only UI), and NFR-10 (lint/typecheck/test stay green). The new features are dashboards, charts, tables, aggregate queries, a rule engine, caching and a seed script, and the installed stack covers all of them.

**Decision:** Use only installed packages. Do not add charting, error-boundary, faker, cron, cache or date libraries.

**Consequences:** No lockfile churn and no new attack surface. The few small helpers we still need are covered in ADR-4 and ADR-10.

## ADR-2: Use async Server Components for widgets, each in Suspense with a per-widget error boundary

**Context:** FR-1, FR-2 and NFR-1 (first content in under 1.5 s). Next.js 14's `error.tsx` works at route-segment level, so it cannot isolate one widget's failure. React 18 has no built-in component-level error boundary, and none exists in `src/` yet.

**Decision:**
- `/dashboard/page.tsx` stays a server component. It checks the role, keeps the PARENT redirect to `/my-children`, and renders one of three role dashboards (FR-1).
- Each widget is an `async` server component that loads its own data and is wrapped in `<Suspense fallback={<LoadingSkeleton/>}>` (reuse `src/components/LoadingSkeleton`), so widgets stream independently.
- Add one small client `WidgetErrorBoundary`: a class component of about 25 lines using `getDerivedStateFromError`. It renders an MUI `Alert` with the text "This widget could not load" and a "Retry" `Button` that resets its state and calls `router.refresh()`. It lives in `src/components/WidgetErrorBoundary/` and is the only new shared component (FR-2).

**Consequences:** One slow widget, such as at-risk, does not block the others. Widgets read data through server-side services directly, not through `/api/dashboard/*`. The FR-41 GET endpoints are thin JSON wrappers around the same service functions, for API parity and tests.

## ADR-3: Cache aggregates with `unstable_cache`, using role-scoped keys and tags

**Context:** FR-23, FR-24, NFR-1 and NFR-12. Next.js 14.2 provides `unstable_cache(fn, keyParts, { revalidate, tags })` and `revalidateTag()`.

**Decision:**
- Wrap the expensive reads in `src/server/dashboards/insights.ts`: admin KPIs, the attendance trend, the enrollment and grade distributions, and risk summaries and lists.
- Use `revalidate: 900` (15 minutes) and `3600` (60 minutes) for at-risk data.
- Key parts must include the scope: `['admin']`, or `['teacher', teacherId]` for teacher-scoped data. This keeps one teacher's cached data out of another teacher's view (NFR-3).
- Tags: `dashboard:admin`, `dashboard:teacher`, `dashboard:student` and `insights:at-risk`.
- `POST /api/dashboard/refresh` (ADMIN only) calls `revalidateTag` for each tag after it triggers the risk recompute (ADR-6).
- Each cached function returns `{ data, computedAt: ISO string }`, and the widget shows "Updated N min ago" from `computedAt` (FR-24).

**Consequences:**
- `unstable_cache` serializes results to JSON, so cached values must not contain `Date` objects; use ISO strings.
- The cache lives in each Next.js server process, which is acceptable for a single-node deployment.
- `ponytail:` ceiling: with several app instances each one has its own cache, and Refresh only clears the instance that handles the request. Add a shared cache handler if the app is scaled out.
- Per-user student widgets (FR-10 to FR-15) are cheap, single-student queries and are **not** cached. That avoids one cache entry per student.

## ADR-4: Use MUI X Charts, the shared DataTable, and visually hidden data for accessibility

**Context:** FR-15 to FR-19, FR-33 to FR-39, NFR-2, NFR-4 and NFR-5.

**Decision:**
- Use `LineChart` (FR-17 and the report trends), `BarChart` (FR-18 stacked by gender, the FR-19 histogram, and the reports) and `Gauge` (FR-15), all from `@mui/x-charts` 9.5.0.
- Draw the FR-17 threshold with the chart's reference-line component, `ChartsReferenceLine`.
- All tables use the existing `src/components/DataTable` (x-data-grid).
- Charts are client components that receive serializable props from the server.
- For NFR-2, every chart gets an `aria-label` summary built on the server, for example "Attendance trend: 94.2 % average, lowest 88.1 % on 3 Oct". It also gets a visually hidden MUI `Table` built with the `visuallyHidden` style from `@mui/utils`, which comes with `@mui/material`.
- Series use labels and distinct marks or patterns, not colour alone.
- Per NFR-5, the dev phase must look up each component through mui-mcp (`useMuiDocs` and `fetchDocs`, version 9.5.0) before using it. If MCP is unavailable, that is a blocker.

**Consequences:** No Recharts, Tailwind or shadcn (NFR-4). Each chart duplicates its data once, for the hidden table, which is trivial at these data sizes.

## ADR-5: Implement risk scoring as rule-based pure functions plus a Prisma snapshot with embedded capped history

**Context:** FR-25 to FR-28, FR-31, FR-32, NFR-9 and NFR-11 (no ML). FR-28 is LOW confidence because "one row per student per term, upserted" conflicts with the trend arrow and history requirements.

**Decision:**
- `src/server/dashboards/risk.ts` exports pure, database-free functions `attendanceSignal`, `gradesSignal`, `missingSignal` and `overallLevel`. They take numbers and return `'HIGH' | 'MEDIUM' | null` plus a reason string. That makes the NFR-9 boundary tests plain Vitest tables.
- A separate loader, `computeRiskInputs(termId, studentIds)`, fetches data in bulk, using a fixed number of queries per run rather than per student.
- **FR-28 resolution:** keep `@@unique([studentId, termId])` on `StudentRiskSnapshot`. Add `previousLevel RiskLevel?` and `history Json`, a list of `{ level, computedAt, reasons }` capped at the last 10 **level changes**. Unchanged recomputes update `computedAt` only, so hourly runs do not flood the history. The trend arrow compares `level` with `previousLevel`, and the Insights tab renders `history`.
- Add `highNotifiedAt DateTime?` to enforce the FR-32 rule of at most one notification per 14 days without querying the Notification table.
- New enum `RiskLevel { MEDIUM HIGH }`. `none` is stored as a `null` level.
- The "Missing" count reuses the definition from `src/server/assignments/reminders.ts`: published, due within the last 30 days, no submission, not exempt, and `submissionType != NO_SUBMISSION`.
- A student with no data has no signal.

**Consequences:** One table and one migration, with no separate history table. History is limited to 10 level changes, which is enough for a "short history". `ponytail:` add a `StudentRiskSnapshotHistory` table if long-range trend analytics are ever needed.

## ADR-6: Hook the hourly recompute into the existing internal dispatch cron, gated in the database

**Context:** FR-27 and NFR-12. `src/app/api/internal/email/dispatch/route.ts` already runs the maintenance passes, each in its own try/catch. It currently gates the daily purge with an in-memory `lastPurgeAt`, which does not survive restarts or work across instances.

**Decision:**
- Add a `recomputeRiskSnapshots()` call in its own try/catch block.
- Gate it with `max(computedAt)` from `StudentRiskSnapshot` for the current term: skip the run if the latest snapshot is less than 60 minutes old.
- Admin Refresh bypasses the gate.
- On completion, call `revalidateTag('insights:at-risk')`.
- Notifications use the existing `notify()` with the new type `insights.student_high_risk` (default email on). The type is registered wherever notification types and preferences are declared.

**Consequences:** No new scheduler. The "at most once per hour" rule holds across restarts and instances because it is gated in the database.

## ADR-7: Use Prisma aggregates first and parameterized `$queryRaw` for time-bucketed reports

**Context:** FR-16 to FR-22, FR-34 to FR-39 and NFR-1 (reports in under 3 s on 600 students over one school year).

**Decision:**
- Use `groupBy`, `count` and `aggregate` for simple counts.
- Use tagged-template `prisma.$queryRaw` (parameterized only, never `$queryRawUnsafe`) where Prisma cannot group by date or bucket. That covers the daily attendance rate over 30 school days, the 10 % grade histogram with median (`percentile_cont`), monthly enrollments and archives, and on-time, late and missing rates.
- Bucket dates in SQL with `AT TIME ZONE $tz` (NFR-7).
- The attendance report (FR-35) and course percentages (FR-13, FR-19, FR-36) must call the existing `attendance-service.ts` and the gradebook `grade-calc.ts` and `student-grades-service.ts`, so the numbers match the Grades tab.
- Dev should check with `EXPLAIN` against `seed:large` and add indexes only where a query is slow. `AttendanceRecord @@index([studentId, createdAt])` already exists.

**Consequences:** A small amount of raw SQL, kept in the `src/server/reports/` and `src/server/dashboards/` services and covered by NFR-9 integration tests with known totals.

## ADR-8: Validate with Zod, keep handlers thin, export CSV through the existing helper, and enforce access server-side

**Context:** FR-30, FR-33, FR-41 to FR-44, NFR-3 and NFR-6.

**Decision:**
- Put the schemas in `src/lib/validators/dashboards.ts` and `src/lib/validators/reports.ts`.
- `reportKey` is a `z.enum([...6 keys])`, and an unknown key returns a 404 `NOT_FOUND`.
- Handlers use the existing `withHandler`, `ok` and `AppError` from `src/server/http.ts`.
- `?format=csv` goes through `toCsv` and `escapeCsvCell` in `src/server/csv.ts`, which already protects against formula injection, using the same column list as the table.
- Teacher scope = `getAccessibleStudentIds()`. Filters are applied as an intersection with that set, so they can never widen it (FR-42).

**Consequences:** No new HTTP or CSV code.

## ADR-9: Do all date logic in the school timezone with date-fns-tz through `src/lib/dates.ts`

**Context:** FR-3, FR-4, FR-6, FR-10, FR-11, FR-17 and NFR-7.

**Decision:**
- Reuse `schoolNow`, `schoolDateOf`, `schoolMidnight`, `addDateDays`, `nowAndNext` (for the Now/Next badges) and `formatInSchoolTz`.
- Add a `greetingFor(now, tz)` helper next to them, and a "school days" helper that reads the existing teaching-days and holiday data.

**Consequences:** One timezone source of truth. Timestamps stay in UTC in the database.

## ADR-10: Write a deterministic large seed as a tsx script with an inline PRNG

**Context:** FR-45, FR-46 and NFR-1. The existing seed runs with `tsx prisma/seed.ts` through `db:seed`. Faker is not installed.

**Decision:**
- Add `prisma/seed-large.ts` and the npm script `"seed:large": "tsx prisma/seed-large.ts"`.
- Use an inline mulberry32 PRNG (about 6 lines) with a fixed seed, plus fixed name lists, instead of adding faker.
- Use `createMany` in batches for 600 students, 40 teachers and 60 school days of attendance, assignments and grades.
- The default `prisma/seed.ts` stays small but must create at least 3 students at each risk level (High, Medium and none) by planting attendance, grades and missing work that cross the FR-25 thresholds (FR-46).

**Consequences:** Results are reproducible, and there is no new dependency.

## ADR-11: Handle missing upstream data sources with empty states and direct reads instead of fixes outside scope

**Context:** FR-8, FR-14, FR-21 and FR-38. There is no `Announcement` model (PRD-12) and no calendar service (PRD-14). NFR-11 says not to modify other PRDs' behaviour.

**Decision:**
- **Announcements:** FR-8 and FR-14 render the existing `EmptyState` with the text "Announcements not available". FR-38 omits the read-rate metric and its column note says "not available". Expose this through one `announcementsAvailable = false` guard in the dashboards service, so it is a one-line change once PRD-12 ships the model.
- **Events:** FR-21 reads `CalendarEvent` directly with a small Prisma query: school-wide, `start >= now`, ordered by start, `take: 5`. It does not expand recurrences. The existing `src/server/calendar/recurrence.ts` can be wired in later.

**Consequences:** These requirements are implemented in degraded form, not blocked. This is recorded as a dependency gap for `system-design.md`. Intake reported no blockers.

---

## Requirement → ADR map

| ADR | Requirements |
|---|---|
| ADR-1 | NFR-4, NFR-8, NFR-10 |
| ADR-2 | FR-1, FR-2, FR-41, NFR-1 |
| ADR-3 | FR-23, FR-24, NFR-1, NFR-3, NFR-12 |
| ADR-4 | FR-15, FR-16, FR-17, FR-18, FR-19, FR-29, FR-33–FR-39, NFR-2, NFR-4, NFR-5 |
| ADR-5 | FR-7, FR-20, FR-25, FR-26, FR-27, FR-28, FR-29, FR-31, FR-32, NFR-9, NFR-11 |
| ADR-6 | FR-24, FR-27, FR-32, NFR-12 |
| ADR-7 | FR-5, FR-6, FR-12, FR-13, FR-16–FR-22, FR-34–FR-39, NFR-1, NFR-7, NFR-9 |
| ADR-8 | FR-30, FR-33, FR-40, FR-41–FR-44, NFR-3, NFR-6 |
| ADR-9 | FR-3, FR-4, FR-6, FR-10, FR-11, FR-17, NFR-7 |
| ADR-10 | FR-45, FR-46, NFR-1, NFR-9 |
| ADR-11 | FR-8, FR-14, FR-21, FR-38, NFR-11 |

FR-9 (quick-action links) and FR-40 (navigation entries) are plain MUI links and config edits in `src/config/navigation.ts` and `src/config/student-tabs.ts`, and need no stack decision.
