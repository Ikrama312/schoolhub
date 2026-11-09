# PRD-07: Attendance Tracking

**Ticket:** SCH-007 · **Depends on:** PRD-00 – PRD-06 · **Run mode:** `--brownfield --tech-stack react`

## Summary

Teachers record attendance per course meeting (date + period) from a fast, mobile-friendly register; homeroom teachers can also take a daily register for their section. Parents are notified automatically when their child is marked absent or late. Students and parents see attendance history with percentages; admins get school-wide attendance reports with CSV export and a list of students below an attendance threshold.

## Platform Context (shared by every SchoolHub PRD)

SchoolHub is a single-school web platform for administrators, teachers, students and parents. It is built incrementally by a sequence of PRDs (PRD-00 … PRD-18). **When this PRD runs, every lower-numbered PRD is already implemented in the workspace.** Reuse existing models, services, components and helpers — never re-scaffold the project, never duplicate a helper that already exists, never rename existing routes or models.

### Fixed technology decisions

| Concern | Decision |
|---|---|
| Framework | Next.js 14 (App Router), React 18, TypeScript `strict: true` |
| UI components | **Material UI only** — `@mui/material` v9 (+ `@emotion/react`, `@emotion/styled`), `@mui/material-nextjs` (App Router cache provider), `@mui/icons-material`. Every component is looked up through the MUI MCP server first (see "UI component rule" below) |
| Theming | MUI `createTheme` with `cssVariables: true` and light/dark `colorSchemes`, `InitColorSchemeScript`, `useColorScheme()` for the toggle; styling only through the theme, the `sx` prop and `styled()` — no Tailwind, no CSS modules |
| Dates & pickers | `@mui/x-date-pickers` v9 (MIT) with `AdapterDateFns`; `date-fns` + `date-fns-tz` for logic |
| Database | PostgreSQL 16 via Prisma ORM (`prisma/schema.prisma`), migrations with `prisma migrate` |
| Auth | Auth.js (NextAuth v5) Credentials provider, JWT session strategy, bcrypt password hashes |
| Validation | Zod schemas in `src/lib/validators/<feature>.ts`, shared by client forms and API handlers |
| Forms | React Hook Form + `@hookform/resolvers/zod` |
| Data tables | `@mui/x-data-grid` v9 (MIT `DataGrid`, server-side pagination/sorting/filtering) wrapped by the shared `DataTable` component |
| Charts | `@mui/x-charts` v9 (MIT) |
| Email | Nodemailer via the `EmailOutbox` table (from PRD-04); dev transport logs to console |
| Calendar UI | `@mui/x-scheduler` (MIT Community `EventCalendar`; pin the exact version found via the MUI MCP — it is in beta) |
| Tests | Vitest + Testing Library (unit/integration), Playwright (e2e in `tests/e2e`) |
| Local infra | `docker-compose.yml` with Postgres; `.env.example` documents every env var |

### UI component rule (mandatory — applies to every screen in this PRD)

1. **Material UI components only.** Every visible UI element is built from `@mui/material`, `@mui/icons-material` or the MUI X packages listed above (`@mui/x-data-grid`, `@mui/x-date-pickers`, `@mui/x-charts`, `@mui/x-scheduler`) — composed with `Box`, `Stack`, `Grid` and the theme. Hand-styled raw HTML (`<div>`/`<button>`/`<table>` with custom CSS) is not allowed where an MUI component exists.
2. **Look up every component through the MUI MCP server (`mui-mcp`) before using it.** Call `useMuiDocs` with the package (for example `@mui/material@9.5.0`, `@mui/x-data-grid`) to get the docs index, then `fetchDocs` on the component's page, and use only props, slots and imports documented there for the installed version. Never write MUI code from memory, and never invent props. If the MCP server is unreachable, stop and report it as a blocker instead of guessing.
3. **Banned:** Tailwind CSS, shadcn/ui, Radix UI, Headless UI, Chakra UI, Ant Design, Bootstrap, `lucide-react`, `next-themes`, `@tanstack/react-table`, Recharts, FullCalendar, `react-select`, `react-datepicker`, `sonner`, `notistack` and any other component or styling library. PRD-00 enforces this with an ESLint `no-restricted-imports` rule.
4. **Allowed non-visual libraries** (they render no UI of their own): React Hook Form, Zod, `@dnd-kit/core` and `@dnd-kit/sortable` (drag behaviour only — draggable items are MUI components), `react-markdown` + `remark-gfm` + `rehype-sanitize` (every Markdown element is mapped to an MUI component through the `components` prop), `papaparse`, `date-fns`. Email templates (`@react-email/components`) are exempt because email clients cannot render MUI.
5. Shared wrappers live in `src/components/shared/` and are themselves built from MUI. Toasts use MUI `Snackbar` + `Alert` through the shared `useToast()` hook from PRD-00; side panels use `Drawer`; confirmations use `Dialog`; pickers and searchable selects use `Autocomplete`.
6. Intake must record this rule as a non-functional requirement, and QA must check it: no banned imports, and every MUI import resolves to a documented component.

### Code layout and conventions

- `src/app/(public)/…` public pages, `src/app/(auth)/…` sign-in flows, `src/app/(app)/…` authenticated app with the shared sidebar shell.
- `src/app/api/<feature>/…/route.ts` REST route handlers. Handlers are thin: parse with Zod → call a service → return JSON.
- `src/server/services/<feature>.ts` business logic and Prisma access. Server components may call services directly; client components call the REST API. New features follow PRD-05's precedent of a feature-named subdirectory instead: `src/server/<feature>/<feature>-service.ts` (for example `src/server/sections/sections-service.ts`), not this older flat path — which remains accurate only for the already-built PRD-02/03-era services that still live there.
- `src/server/auth/requireRole.ts` exposes `requireUser()`, `requireRole(...roles)` and per-entity access checks. Every handler and every server page enforces access server-side; hiding a button is never the only protection.
- Response shape: success `{ "data": … }`; list `{ "data": [...], "page": 1, "pageSize": 20, "total": 134 }`; error `{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details": {…} } }`. Error codes: `VALIDATION_ERROR` (400), `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `RATE_LIMITED` (429), `INTERNAL` (500).
- Pagination: `?page=` (default 1) and `?pageSize=` (default 20, maximum 100). Sorting: `?sort=field&order=asc|desc`. Search: `?q=`.
- IDs are `cuid()` strings. Every model has `createdAt` and `updatedAt`. Timestamps are stored in UTC and displayed in the school timezone from `SchoolSettings.timezone`. Date-only values use `@db.Date`.
- Sidebar navigation lives in `src/config/navigation.ts` as an array of `{ label, href, icon, roles }`. A PRD that adds a page adds its nav entry there.
- Student detail page `/students/[studentId]` is tab-based; tabs are registered in `src/config/student-tabs.ts`. Feature PRDs add a tab there instead of creating a separate student page.
- Mutations that change records owned by someone else write an `AuditLog` row through `audit()` (from PRD-01).
- Notifications go through `notify()` (from PRD-04). Notification type keys are registered in `src/server/notifications/types.ts`.
- No `console.log` in committed code except the dev email transport; use the `logger` from `src/lib/logger.ts`.

### Roles

`ADMIN` (school office staff and principal), `TEACHER`, `STUDENT`, `PARENT` (parent or guardian). A user has exactly one role. Parents see data only for students linked to them; students see only their own data; teachers see data for courses they teach and sections they are homeroom teacher of; admins see everything.

### Assumptions and constraints

- **Assumptions:** one school per deployment (no multi-tenancy); English-only UI; the school timezone is the reference for every date rule; users have a modern evergreen browser (last 2 versions of Chrome, Edge, Firefox, Safari).
- **Constraints:** this PRD is delivered in a single forge run, so its scope must not expand beyond the sections below; do not modify behaviour owned by later PRDs; keep all existing tests passing (`npm run lint && npm run typecheck && npm run test`) and add the tests listed in this PRD.
- **Delivery milestones:** Milestone 1 "Core platform" = PRD-00 – PRD-05 · Milestone 2 "Teaching & learning" = PRD-06 – PRD-11 · Milestone 3 "Communication" = PRD-12 – PRD-15 · Milestone 4 "Operations & public" = PRD-16 – PRD-18.

## Background

Attendance is a legal record. It must be quick to take (a teacher has under a minute at the start of a class), editable for corrections with an audit trail, and visible to families on the same day. Chronic absence (below 90 % attendance) is an early-warning signal schools must act on.

## Goals

1. A teacher can take attendance for a 30-student class in under 30 seconds on a phone.
2. Parents receive an absence notification within 5 minutes of a student being marked absent.
3. Admins can export attendance for any date range and see all students below 90 % in one view.

## Out of Scope

- Biometric, RFID or QR check-in.
- Absence notes submitted by parents (PRD-15 adds these and the `EXCUSED` workflow).
- Holiday awareness (PRD-14 adds a warning when a date is a holiday).

## User Stories

- As a teacher, I want my current class's register to open in one tap so that I can take attendance at the start of the lesson.
- As a teacher, I want to mark everyone present at once and then change exceptions so that it is fast.
- As a teacher, I want to correct a mark later with a note so that the record stays accurate.
- As a parent, I want to be notified when my child is absent or late so that I can react immediately.
- As a student or parent, I want to see attendance history and percentages so that we can track punctuality.
- As an admin, I want school-wide reports and a chronic-absence list so that I can follow up.

## Functional Requirements

### FR-1 Data model

```prisma
enum AttendanceStatus { PRESENT ABSENT LATE EXCUSED }

model AttendanceSession {
  id           String   @id @default(cuid())
  courseId     String?                    // set for per-period course registers
  course       Course?  @relation(fields: [courseId], references: [id], onDelete: Cascade)
  sectionId    String?                    // set for whole-day homeroom registers
  section      Section? @relation(fields: [sectionId], references: [id], onDelete: Cascade)
  date         DateTime @db.Date
  periodId     String?                    // null for daily registers
  takenById    String
  takenAt      DateTime @default(now())
  updatedAt    DateTime @updatedAt
  records      AttendanceRecord[]
}

model AttendanceRecord {
  id            String           @id @default(cuid())
  sessionId     String
  session       AttendanceSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  studentId     String
  student       User             @relation(fields: [studentId], references: [id])
  status        AttendanceStatus
  minutesLate   Int?                      // required when LATE, 1–240
  note          String?                   // max 500 chars
  recordedById  String
  updatedAt     DateTime         @updatedAt
  createdAt     DateTime         @default(now())
  @@unique([sessionId, studentId])
  @@index([studentId, createdAt])
}
```

Exactly one of `courseId` or `sectionId` must be set — enforce it in the service layer and with a raw SQL `CHECK` constraint added to the migration. Uniqueness uses two partial unique indexes created in the migration SQL: `(courseId, date, periodId)` where `courseId IS NOT NULL`, and `(sectionId, date)` where `sectionId IS NOT NULL`.

### FR-2 Attendance mode setting
1. Add `attendanceMode` to `SchoolSettings`: `PER_PERIOD` (default) or `DAILY_HOMEROOM` or `BOTH`. Admin edits it on the school settings page. Percentages (FR-6) use per-period records when mode is `PER_PERIOD` or `BOTH`, and daily records when mode is `DAILY_HOMEROOM`.

### FR-3 Teacher register (`/attendance/take`)
1. Landing page shows today's schedule for the teacher (from `getScheduleForDate`) with each meeting's status: "Not taken", "Taken 08:03 by Tom Teacher". The current period's meeting is highlighted with a primary "Take attendance" button. Homeroom teachers also see "Daily register – 7A" when the mode includes daily.
2. Teachers may also open a register for any date in the past 14 days (date picker) for their courses; admins for any date. Future dates are refused.
3. Register page (`/attendance/take/[courseId]?date=&periodId=`): list of ACTIVE enrolled students (sorted by last name) showing avatar and name, with an exclusive MUI `ToggleButtonGroup` per student: P / A / L / E (each `ToggleButton` coloured via the theme palette and labelled for screen readers) (EXCUSED available to ADMIN only in this PRD). Default for a new register: nothing selected.
4. "Mark all present" button sets every unselected student to PRESENT.
5. Selecting L reveals a minutes-late input (default 5). Each row has an optional note icon.
6. Header shows live counters: Present N · Absent N · Late N · Unmarked N. "Save" is disabled while any student is unmarked.
7. Save creates or updates the session and records in one transaction. Editing an existing register shows who last changed it and when.
8. Layout must work one-handed on a 360 px wide phone: rows at least 48 px tall, toggle buttons at least 44 × 44 px, sticky save bar at the bottom (MUI `Paper` with `position: sticky`).

### FR-4 Corrections and audit
1. Any change to an existing record's status writes an audit entry `attendance.record.update` with old and new status, actor and the note.
2. Teachers can edit their own course records for 14 days after the date; after that only admins can edit (others see the register read-only with an explanation).

### FR-5 Notifications
1. Register types `attendance.absent` (category ATTENDANCE, default email true, `mandatoryInApp` true, roles PARENT and STUDENT) and `attendance.late` (default email false).
2. After save commits, for each student whose status changed to ABSENT or LATE (compared with the previous saved value), call `notifyStudentAndParents` with title "Sam Student was marked absent" / "…was marked late (10 min)", body "Mathematics – 7A, Period 1, Monday 14 Sep 2026", link `/students/<id>/attendance`.
3. When a status changes from ABSENT to PRESENT within the same day, send `attendance.corrected` (title "Attendance corrected: Sam Student was present") to the same recipients. Do not send more than one absence notification per student per session.

### FR-6 Student attendance tab
1. Register "Attendance" tab in `student-tabs.ts`. Shows: summary cards for the current term and the year (attendance rate %, absent count, late count, excused count); a month attendance calendar built with MUI X `DateCalendar` (read-only) using a custom `day` slot that colours each day (all present = success, any late = warning, any absent = error, no data = default) with a `Tooltip` summary, and month navigation; and a filterable table of records (date, period, course, status, minutes late, note — notes visible to ADMIN and TEACHER only).
2. Attendance rate formula: `(PRESENT + LATE + EXCUSED) / total marked records × 100`, rounded to one decimal place. Records of DROPPED enrollments still count toward the student's history.

### FR-7 Course attendance tab
1. Register "Attendance" tab in `course-tabs.ts` (TEACHER/ADMIN): MUI X `DataGrid` matrix with students as rows and session dates as columns (last 20 sessions, horizontally scrollable), cells showing coloured P/A/L/E letters, plus a per-student rate column. Clicking a column header opens that register.

### FR-8 Admin reports (`/admin/attendance`)
1. Today overview: number of sessions expected today vs taken, school-wide attendance rate today, list of meetings whose register has not been taken 15 minutes after the period start ("Missing registers") with a "Remind teacher" button that sends notification type `attendance.register_missing` to the teacher.
2. Report builder: date range (maximum 366 days), grade level, section, course, status filter → summary per student (records, present, absent, late, excused, rate). Export CSV with the same columns.
3. "Below threshold" view: students whose year-to-date rate is below a configurable threshold (default 90 %, setting `attendanceAlertThreshold` on `SchoolSettings`), sorted ascending, with links to student pages.

### FR-9 Navigation
1. TEACHER: "Attendance". ADMIN: "Attendance" in the main group (reports). Students and parents reach attendance via the student page tab.

## API

| Method & path | Role | Notes |
|---|---|---|
| `GET /api/attendance/today` | TEACHER, ADMIN | Teacher's meetings with taken status |
| `GET /api/attendance/register?courseId=&date=&periodId=` | `assertCanManageCourse` | Students + existing records |
| `GET /api/attendance/register?sectionId=&date=` | homeroom teacher, ADMIN | Daily register |
| `PUT /api/attendance/register` | as above | `{ courseId?, sectionId?, date, periodId?, records: [{ studentId, status, minutesLate?, note? }] }` |
| `GET /api/students/:id/attendance?from=&to=` | `assertCanViewStudent` | Records + summary; notes stripped for STUDENT/PARENT |
| `GET /api/courses/:id/attendance` | `assertCanManageCourse` | Matrix |
| `GET /api/admin/attendance/overview?date=` | ADMIN | |
| `GET /api/admin/attendance/report` | ADMIN | Filters; `?format=csv` |
| `GET /api/admin/attendance/below-threshold` | ADMIN | |
| `POST /api/admin/attendance/remind` | ADMIN | `{ courseId, date, periodId }` |

## Non-Functional Requirements

1. **Performance:** saving a 35-student register completes in under 500 ms; a student's yearly attendance tab loads in under 400 ms with 1,200 records.
2. **Reliability:** if the network drops while saving, the register keeps the unsaved marks in `localStorage` keyed by course/date/period and offers "Restore unsaved attendance" on next open.
3. **Integrity:** records may only be saved for students with an ACTIVE enrollment on that date (or section members for daily registers); others are rejected with `VALIDATION_ERROR`.

## Acceptance Criteria

1. Given Tom opens `/attendance/take` during Period 1, then MATH-7A is highlighted; tapping "Mark all present", changing Sam to A and Sara to L (10) and saving creates 1 session and N records.
2. Given Sam was saved as ABSENT, then Pat and Sam each receive one `attendance.absent` notification within 5 minutes and an email is queued for Pat.
3. Given Tom changes Sam from ABSENT to PRESENT the same day, then an `attendance.corrected` notification is sent and an audit entry records the old and new status.
4. Given a register date 20 days ago, when Tom opens it, then it is read-only with the explanation; when an admin opens it, then it is editable.
5. Given a register with one unmarked student, then Save is disabled.
6. Given Sam has 18 PRESENT, 1 LATE and 1 ABSENT records this term, then the Attendance tab shows a term rate of 95.0 %.
7. Given threshold 90 %, when an admin opens Below threshold, then only students under 90 % are listed in ascending order.
8. Given a parent opens their child's attendance tab, then teacher notes are not visible and not present in the API response.

## Test Requirements

- Unit: rate calculation, edit-window rule, change detection for notifications (no duplicate on re-save).
- Integration: register save transaction, enrollment validation, partial unique indexes.
- Playwright: mobile viewport (375 px) take-attendance flow; parent sees notification and the absence on the attendance calendar.

## Seed Data

- Attendance sessions for 7A and 7B covering the 15 teaching days before the seed run date, with roughly 94 % present, 3 % late, 3 % absent distributed randomly but deterministically (fixed seed), and two Grade 7 students deliberately below 85 %.
