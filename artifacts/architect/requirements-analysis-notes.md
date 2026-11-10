# Requirements Analysis Notes: ticket SH-16

Written by `arch-research-reqs` for `arch-design-system`. This is a supporting document, not a primary phase output.
Source: `artifacts/intake/requirements.json` (2026-11-10T12:00:00Z), PRD-16 Role Dashboards, Reports & Early-Warning Insights. It has 46 FRs and 12 NFRs (58 requirements) at 91% confidence.
`handoff-to-architect.json` lists **no blockers** and 7 warnings. §3 proposes a default for each open question so that `arch-design-system` can decide.
The previous SH-15 version of this file was moved to `artifacts/architect/.prev-SH-15/`. The other files in `artifacts/architect/` are still SH-15 outputs until their owning sub-tasks overwrite them.

## 1. Codebase facts verified (2026-11-10)

| Fact | Where | Impact |
|---|---|---|
| The dashboard page is a placeholder. It already redirects PARENT to `/my-children` | `src/app/(app)/dashboard/page.tsx` | FR-1: replace the body and keep the redirect line |
| `getAccessibleStudentIds(user)` returns `'ALL'` for ADMIN and `string[]` for TEACHER (active course enrolments + homeroom section members). `assertCanViewStudent` also exists | `src/server/auth/student-access.ts` | NFR-3, FR-7/29/42/43: one scope source. Students outside a teacher's scope get **FORBIDDEN**, not NOT_FOUND |
| `src/server/dashboards/` and `src/server/reports/` do not exist | — | NFR-6: create both as new feature folders |
| There is no `unstable_cache` or `revalidateTag` anywhere. Next is **14.2.18** | `package.json` | FR-23/24: `unstable_cache` + `revalidateTag` work on 14.2. There is no `'use cache'` |
| `SchoolSettings.timezone` and `attendanceAlertThreshold` (default 90) exist. `schoolToday(now, tz)` and `addDays` exist | `schema.prisma:222`, `attendance/attendance-rules.ts` | NFR-7, FR-17, FR-25: reuse these. Do not write new date helpers |
| `getCurrentTerm(date)` exists. `Term` has start and end dates and belongs to an academic year | `src/server/services/academicYears.ts:96` | FR-3, FR-15, FR-25, FR-33: use it as the "current term" source |
| Attendance service exports `getOverview(date)` (registers taken/missing + status counts), `getReport(filters)`, `getBelowThreshold()`, `attendanceRate()` and `countStatuses()` | `attendance/attendance-service.ts`, `attendance-rules.ts` | FR-16 (missing registers, today's rate), FR-17, FR-25 (attendance signal), FR-35: reuse these. Check `getReport` filters before you write new SQL |
| `computeStudentTerm`, `letterFor` and `isUngradedPastDue` are pure. `getStudentGrades(user, studentId, termId)` is the Grades-tab source | `gradebook/grade-calc.ts`, `student-grades-service.ts` | FR-13 "consistent with Grades tab", FR-19, FR-25, FR-36: call the same calc. Calling `getStudentGrades` per student will not scale to 600 students (NFR-1), so use a batch path that runs `computeStudentTerm` |
| "Missing" is derived. `SubmissionStatus` = SUBMITTED \| RETURNED. `reminders.ts` uses `visibleWhere(now)` + `submissionType != NO_SUBMISSION` + no submission + not exempt. Its lookback is 8 days | `assignments/reminders.ts` | FR-11, FR-25, FR-37: extract one shared `missingWhere(window)` predicate. Risk needs a 30-day window |
| Parent overview service has `getToday` (timetable plus `isNoSchool` holiday check), `getRecentGrades`, `getAssignmentsSummary` and `getUpcomingEvents` (CalendarEvent + `expandOccurrences`). `listUnreadAnnouncements` is a stub that returns `[]` (ADR-11 precedent) | `src/server/parent/overview-service.ts` | FR-10/11/12: student widgets can call these with `studentId = user.id`. FR-14 follows the same stub precedent. FR-21 copies the events query with a school-wide audience and no meetings |
| `CalendarEvent` (recurrence, `isNoSchool`) and `expandOccurrences(event, from, to, tz)` exist. There is still no calendar service or API | `schema.prisma:1281`, `calendar/recurrence.ts` | FR-21: read the model directly and expand recurrences. This removes the warning's "non-recurring only" limit |
| There is no `Announcement` model, only `announcements/audience.ts` | `schema.prisma` | FR-8, FR-14, FR-38: show an empty state or omit the metric |
| `messaging/conversations.unreadCount(userId)`. `isSafeguardingLead(user)`. `safeguarding.listReports` | `src/server/messaging/` | FR-8 unread count. FR-16 KPI only when `isSafeguardingLead`. For the count, add `count` on open reports. Do not page through the list |
| `audit({ action: 'auth.login.success' })` is written on login. `User.lastLoginAt` exists. `AuditLog` is indexed on `action` and `[actorId, createdAt]`, but not on `createdAt` alone | `auth/credentials.ts:83`, `schema.prisma:202` | FR-22: filter by action prefix and order by createdAt desc. This may need `@@index([createdAt])` for NFR-1. FR-38 parent sign-ins |
| `Gender` enum, `Section.homeroomTeacherId`, `TimetableSlot` and `LessonProgress` exist | `schema.prisma` | FR-18, FR-32 (homeroom recipient), FR-39, FR-13/38 |
| Notification types are a static map `NOTIFICATION_TYPES`. `notify()` is in `notify.ts` | `notifications/types.ts`, `notify.ts` | FR-32: add the key `insights.student_high_risk` (ACADEMIC, TEACHER, email default true) |
| The cron dispatch route runs isolated try/catch passes on every call. The daily purge uses an in-memory `lastPurgeAt` | `src/app/api/internal/email/dispatch/route.ts` | FR-27: add a risk pass. The "at most once per hour" rule must be stored in the DB (`max(computedAt)`), not in memory, because there are multiple processes |
| `csv.ts` exports `escapeCsvCell` and `toCsv(columns, rows)` | `src/server/csv.ts` | FR-30, FR-33: reuse these. They already guard against formula injection |
| `studentTabs` registry, and `navigation` with `roles` + `requires` flags | `src/config/student-tabs.ts`, `navigation.ts` | FR-31, FR-40: append entries only |
| `@mui/material`, `@mui/x-charts` and `@mui/x-data-grid` are 9.5.0. Prisma is 5.20, Zod 3.23 | `package.json` | NFR-4/5: no new dependencies are needed |
| There is no `seed:large` script. The seed lives in `prisma/seed.ts` | `package.json` | FR-45/46 |

## 2. Requirement → architectural concern

Concern codes: **UI** = new UI surface, **SVC** = service/query, **API** = endpoint, **DM** = data-model change, **JOB** = background/cron, **AUTH** = auth/scope boundary, **CACHE**, **CFG** = config registry, **XC** = cross-cutting rule.

### Dashboards shell

| Req | Concern | Notes |
|---|---|---|
| FR-1 | UI, AUTH | `/dashboard` page switches on `getCurrentUser().role`. Keep the PARENT redirect. Use three role components under `src/app/(app)/dashboard/_components/` (or similar) |
| FR-2 | UI | One async server component per widget inside `<Suspense fallback={<LoadingSkeleton/>}>` + a client error boundary with a Retry button (`router.refresh()`). This needs one shared `WidgetCard` wrapper (title, updated-ago, boundary). It is used by ~20 widgets, so the abstraction pays for itself |
| FR-3 | SVC, XC | Greeting by the hour in `SchoolSettings.timezone` (NFR-7) + `getCurrentTerm().name`. Pure function `greetingFor(now, tz)`, which is unit-testable |

### Teacher widgets (all scoped by `getAccessibleStudentIds` / taught courses, NFR-3)

| Req | Concern | Notes |
|---|---|---|
| FR-4 | SVC, UI | Today's TimetableSlots for the teacher's courses + attendance session existence per (course, period, date). `getToday(user)` in attendance-service probably already covers this. Check it before writing a new query. Now/Next comes from period times in the tz |
| FR-5 | SVC | Union of ungraded submissions (no grade on the linked GradeItem) and quiz attempts needing manual grading in the teacher's courses. Count + oldest 5 |
| FR-6 | SVC | Assignments/quizzes due within 7 days. Submission rate = submissions / active enrolments. Use one grouped query, not N+1 |
| FR-7 | SVC, AUTH | Read `StudentRiskSnapshot` filtered by accessible ids, order High > Medium, take 5. Do not compute live |
| FR-8 | SVC | `messaging.unreadCount` + announcements empty state (§3 Q1) |
| FR-9 | UI | Static links. No data. Check that the target routes exist (new announcement route is absent → omit or disable it, §3 Q1) |

### Student widgets (scope = self)

| Req | Concern | Notes |
|---|---|---|
| FR-10 | SVC | Reuse the parent `getToday(user, user.id)`, which already handles `isNoSchool` holidays |
| FR-11 | SVC | Due in the next 7 days + missing items first. Share the missing predicate with FR-25/37 |
| FR-12 | SVC | Reuse the parent `getRecentGrades` |
| FR-13 | SVC | `getStudentGrades` (same as the Grades tab) + LessonProgress ratio + first incomplete visible lesson (`isLessonVisible`) |
| FR-14 | SVC | Empty state (§3 Q1) |
| FR-15 | SVC, UI | Term attendance rate via `countStatuses`/`attendanceRate` over the term range. Display with x-charts `Gauge` |

### Admin widgets (ADMIN, cached)

| Req | Concern | Notes |
|---|---|---|
| FR-16 | SVC, CACHE, AUTH | Counts: active students/teachers, `getOverview(today)` rate + missing registers, the same weekday −7 days for the delta, pending absence notes (`absence-notes` service), safeguarding count **only if** `isSafeguardingLead`. The cache key must vary on lead status, or the safeguarding count must be fetched uncached separately |
| FR-17 | SVC, CACHE, UI | Daily rate for the last 30 **school days**. A school day is a date with ≥1 attendance session. That is simpler and more accurate than combining calendar + weekday logic. One `groupBy` on session date × status. `LineChart` + reference line at the threshold |
| FR-18 | SVC, CACHE, UI | Active students grouped by current-year section → grade level × gender. Stacked `BarChart` |
| FR-19 | SVC, CACHE, UI | Batch `computeStudentTerm` for all students in the current term → histogram in 10 % buckets, plus average and median. This is the most expensive admin query. See §4 |
| FR-20 | SVC | Group snapshots by level and reason. Reads the snapshot table only |
| FR-21 | SVC | The next 5 school-wide `CalendarEvent` occurrences via `expandOccurrences` (§3 Q2) |
| FR-22 | SVC | `AuditLog` where `action startsWith user./report_card./settings.`, latest 10, actor joined |

### Caching

| Req | Concern | Notes |
|---|---|---|
| FR-23 | CACHE | `unstable_cache` wrappers in `src/server/dashboards/insights.ts`. Key = role scope (ADMIN: `'all'`; TEACHER: userId). Tags: `dashboard:admin`, `dashboard:teacher:<id>`, `insights:risk`. `revalidate` 900 s; risk 3600 s. Cached values must be JSON-serialisable, so convert Decimal/Date to number/string |
| FR-24 | CACHE, API, UI | Return `computedAt` from each cached function → "Updated N min ago". `POST /api/dashboard/refresh` → `revalidateTag(...)` + `recomputeRisk({ force: true })`. Audit this admin action |
| NFR-12 | CACHE, JOB | Satisfied by FR-23 (60 min) + FR-27 (hourly recompute) |

### Early-warning risk

| Req | Concern | Notes |
|---|---|---|
| FR-25 | SVC | `risk.ts` has two parts. (a) Pure `scoreSignals({ attendancePct, coursePcts, missingCount }, threshold)` → per-signal level. (b) A batch loader that collects the three inputs for all ACTIVE students in the current term in a few grouped queries. Thresholds: attendance `< threshold` → Medium, `< 80` → High. Grades: any `< 60` → Medium, `≥2 < 60` or any `< 50` → High. Missing: 3–4 → Medium, `≥5` → High |
| FR-26 | SVC | Pure `combine(levels)`: any High or ≥2 Medium → High, exactly 1 Medium → Medium, otherwise none. Keep it in the same pure module as FR-25 for the NFR-9 unit tests |
| FR-27 | DM, JOB | New model + migration. Unique `(studentId, termId)`. Indexes on `(termId, level)`. Add `RiskLevel` enum (HIGH, MEDIUM, NONE). Hook into the dispatch route as an isolated pass, gated on `max(computedAt) < now − 1h` |
| FR-28 | DM | Conflicts with the "one row" rule. See §3 Q3 |
| FR-29 | UI, AUTH, SVC | Page `/insights/at-risk` (ADMIN, TEACHER). Server-side scope filter. Use the shared `DataTable`. Reason chips are formatted from `reasons` JSON. "Message parents" = link to the existing new-conversation flow (PRD-13) |
| FR-30 | SVC, API | The same service function serves the table and the CSV (`toCsv`), so their rows match. Filters: level, reason, grade level, section |
| FR-31 | CFG, UI, AUTH | Add `{ key: 'insights', roles: ['ADMIN','TEACHER'] }` to `studentTabs` + page `/students/[id]/insights` with `assertCanViewStudent` |
| FR-32 | JOB, XC | On upsert, if prev ∈ {none, MEDIUM} and new = HIGH, and there was no notification for this student in 14 days → `notify()` the homeroom teacher. A `lastHighNotifiedAt` column on the snapshot gives a DB-side 14-day claim, with no Notification table scan. If there is no homeroom teacher, skip and log |

### Reports centre

| Req | Concern | Notes |
|---|---|---|
| FR-33 | UI, SVC, API | `/admin/reports` with year/term selectors (`x-date-pickers` for ranges) and one sub-route per report. Use a `REPORTS` registry in `src/server/reports/index.ts`: `key → { schema (Zod), run(filters), columns }`. The page, the API and the CSV all use that one registry, which also makes FR-44's 404 for unknown keys trivial |
| FR-34 | SVC | Enrollment: SectionMember/grade/gender groupings. Monthly new/archived from `createdAt`/`archivedAt` |
| FR-35 | SVC | Reuse `attendance-service.getReport`/aggregate. Group by grade/section/course + daily trend + bottom 20 |
| FR-36 | SVC | Batch `computeStudentTerm` grouped by course and subject + `letterFor`. Section comparison within the same grade × subject. Shares the batch loader with FR-19/FR-25 |
| FR-37 | SVC | On-time/late = submission `submittedAt` vs `dueAt`. Missing = shared predicate. Group by course and teacher |
| FR-38 | SVC | LessonProgress completion by course. Parent sign-ins = distinct `actorId` on `auth.login.success` in the last 7 and 30 days (and/or `lastLoginAt`). Announcement read rate is omitted (§3 Q1) |
| FR-39 | SVC | Per teacher: courses, distinct students, TimetableSlot count/week, grading backlog (reuse the FR-5 query) |

### Navigation, API, seed

| Req | Concern | Notes |
|---|---|---|
| FR-40 | CFG | Add 'Reports' (ADMIN) and 'At-risk students' (ADMIN, TEACHER) after 'Dashboard' |
| FR-41 | API, AUTH | `GET /api/dashboard/{teacher,student,admin}` use the same service functions as the widgets, plus `requireRole`. Refresh uses POST, ADMIN only |
| FR-42 | API, AUTH | Zod query schema. **Intersect** the filtered ids with accessible ids so filters cannot widen scope. `?format=csv` → `text/csv` with a Content-Disposition header |
| FR-43 | API, AUTH | `assertCanViewStudent`, then the snapshot + current signal values |
| FR-44 | API | `reportKey` validated against the registry keys. Unknown key → 404 `NOT_FOUND` |
| FR-45 | XC | `prisma/seed-large.ts` + `"seed:large"` script. Use a seeded PRNG (a small mulberry32, no new dependency) |
| FR-46 | XC | The default seed builds ≥3 students per level. Tests should assert this by running `risk.ts` on the seed, not by hard-coding snapshot rows |

### Non-functional

| Req | Concern | Notes |
|---|---|---|
| NFR-1 | CACHE, SVC | Budget: 600 students × ~8 courses. Avoid per-student queries in risk, the grade distribution and reports. See §4 |
| NFR-2 | UI, XC | Every chart needs an `aria-label` summary built from the data + a visually hidden table. Use the MUI `visuallyHidden` util from `@mui/utils`, which comes in with material. Risk badges always show text (High/Medium), never colour alone |
| NFR-3 | AUTH | Enforce in the services (take `AccessUser`), not only in pages. Cached teacher data must be keyed per teacher id. **Never** share a teacher cache entry across users |
| NFR-4 | XC | MUI only: StatCard, DataTable, Gauge/LineChart/BarChart, Chip, Skeleton |
| NFR-5 | XC | The mui-mcp lookup is a dev/QA-phase process step and has no architectural impact. Flag it so dev-planning schedules it |
| NFR-6 | XC | Validators go in `src/lib/validators/dashboards.ts`, `insights.ts` and `reports.ts`. Use thin handlers and standard response shapes. Paginate the at-risk list |
| NFR-7 | XC | All windows (today, 7 days, 30 days, 30 school days) are computed from `schoolToday(now, tz)` |
| NFR-8 | XC | Reuse is listed per row above. **Do not** fork the attendance/gradebook calcs |
| NFR-9 | XC | Pure `risk-rules.ts` → boundary unit tests. Report integration tests on the seed. Playwright + axe per role |
| NFR-10 | XC | Use `logger`, not `console.log` |
| NFR-11 | XC | Rule-based only. No layout editor. No scheduled report emails |

## 3. Open questions — proposed defaults for arch-design-system

1. **Announcements (FR-8, FR-14, FR-38): proposed default is an empty state.** Render `EmptyState` with "Announcements not available yet", following the same stub pattern as `parent/overview-service.listUnreadAnnouncements` (ADR-11). Leave the announcement read rate out of the engagement report and add a note row. Hide 'New announcement' in FR-9 because the route does not exist. Record this as a dependency gap on PRD-12.
2. **Upcoming events (FR-21): read `CalendarEvent` directly.** Copy the `getUpcomingEvents` approach from the parent overview service: school-wide audience, `expandOccurrences`, next 5. Recurrence expansion already exists, so recurring events can be included.
3. **Snapshot history (FR-28): proposed option is (a), no new table.** Keep the unique `(studentId, termId)` row and add `previousLevel RiskLevel?` and `history Json` (an array capped at 10 entries of `{ level, reasons, computedAt }`, appended only when the level or the reasons change). That covers the trend arrow (level vs `previousLevel`) and the "short history" (FR-31) while keeping the "one row per student per term" rule in FR-27. Option (b), a `StudentRiskSnapshotHistory` table, is cleaner for analytics, but no requirement asks for it.
4. **Missing-work definition (FR-11/25/37):** published (`visibleWhere`), `dueAt` within the window and in the past, `submissionType != NO_SUBMISSION`, no submission, no `GradeExemption`, student actively enrolled. Extract this into one shared function used by reminders, risk, the student widget and the completion report.
5. **No-data students: no signal.** If a student has no attendance records, the attendance signal is none. If a course has a null percent, it is ignored.
6. **"Their students":** `getAccessibleStudentIds` for the dashboard and list scope. The FR-32 notification goes **only** to the homeroom teacher (`Section.homeroomTeacherId` of the current-year section).
7. **New (not in intake):** the cache key for the FR-16 safeguarding KPI. Fetch that count outside the shared admin cache, per user, because it is cheap. A shared cached value would otherwise leak the count to admins who are not safeguarding leads.
8. **New:** with several cron processes, two could run the hourly recompute at the same time. Upserts are idempotent. The FR-32 notification needs an atomic claim (`updateMany where lastHighNotifiedAt < now−14d`), the same claim pattern that `reminders.ts` already uses.

## 4. Performance hot spots (NFR-1)

| Hot spot | Risk | Suggested approach |
|---|---|---|
| Grades for every student (FR-19, FR-25, FR-36) | `getStudentGrades` in a loop = 600 × several queries | One batch loader: load the grade items, grades, categories and overrides for the current term in ~5 queries, then run `computeStudentTerm` in memory. Share it across the three uses. FR-19 is cached for 15 min. Risk reads it only during recompute |
| Attendance aggregates (FR-16/17/25/35) | Row scans over a year of records | `groupBy` on `(studentId, status)` and on `(session.date, status)`. Check the indexes on `AttendanceRecord(studentId)` and `AttendanceSession(date)` |
| Missing work (FR-11/25/37) | Anti-join for each student × assignment | One query over the assignments in the window × active enrolments, minus submissions and exemptions, counted in memory |
| AuditLog feed (FR-22) | No `createdAt` index | Add `@@index([createdAt])` if the seed:large measurement shows a slow query |
| At-risk list (FR-29/42) | — | Read snapshot rows only. Paginate them and include the student/section joins |
