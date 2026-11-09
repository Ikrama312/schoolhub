# PRD-06: Bell Schedule & Timetable

**Ticket:** SCH-006 · **Depends on:** PRD-00 – PRD-05 · **Run mode:** `--brownfield --tech-stack react`

## Summary

Define the school's daily bell schedule (periods) and a weekly timetable that places courses into day + period slots with rooms. A drag-and-drop timetable editor prevents teacher, room and section double-booking. Teachers, students and parents get a personal weekly timetable and a "Today" view; admins can view by section, teacher or room and print timetables.

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

A school day is divided into fixed periods (Period 1 08:00–08:45, Break, Period 2…). Each course meets a number of times per week. Building a clash-free timetable by hand in a spreadsheet takes days and errors are common; the system must make clashes impossible to save.

## Goals

1. An admin can build a clash-free week for one section in under 15 minutes.
2. Every user can see "what do I have now and next" within one click from the dashboard.
3. Attendance (PRD-07) can look up which course is scheduled for a section at a given day and period.

## Out of Scope

- Automatic timetable generation (solver).
- Rotating multi-week cycles (A/B weeks) — single repeating week only.
- Substitute teacher management.

## User Stories

- As an admin, I want to define the periods of the school day so that the timetable has a consistent grid.
- As an admin, I want to drag courses onto a section's weekly grid so that I can build the timetable visually.
- As an admin, I want clashes blocked with a clear explanation so that no teacher, room or section is double-booked.
- As a teacher, I want my weekly timetable with rooms so that I know where to be.
- As a student or parent, I want the student's timetable so that we can plan the week.

## Functional Requirements

### FR-1 Data model

```prisma
enum PeriodKind { CLASS BREAK LUNCH ASSEMBLY }

model Period {
  id          String     @id @default(cuid())
  name        String                     // "Period 1", "Lunch"
  startTime   String                     // "08:00" (24h, school timezone)
  endTime     String                     // "08:45"
  kind        PeriodKind @default(CLASS)
  order       Int        @unique
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
}

model SchoolDay {
  dayOfWeek   Int        @id             // 1 = Monday … 7 = Sunday (ISO)
  isTeaching  Boolean    @default(true)  // seed: Mon–Fri true, Sat–Sun false
}

model TimetableSlot {
  id              String       @id @default(cuid())
  academicYearId  String
  courseId        String
  course          Course       @relation(fields: [courseId], references: [id], onDelete: Cascade)
  dayOfWeek       Int                      // 1–7, must be a teaching day
  periodId        String
  period          Period       @relation(fields: [periodId], references: [id])
  roomId          String?
  room            Room?        @relation(fields: [roomId], references: [id])
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt
  @@unique([courseId, dayOfWeek, periodId])
  @@index([academicYearId, dayOfWeek, periodId])
}
```

### FR-2 Bell schedule (`/admin/timetable/periods`)
1. Ordered list of periods (MUI `Table`, times edited with MUI X `TimeField`) with name, start, end, kind; add / edit / delete / reorder.
2. Validation: `endTime` after `startTime`; periods must not overlap; times in `HH:MM` 24-hour format.
3. Teaching days: seven MUI `ToggleButton`s (Mon–Sun). Turning off a day that has slots requires confirmation and deletes those slots.
4. Deleting a period that has slots is refused with `CONFLICT` listing the count of affected slots.

### FR-3 Clash rules (service `src/server/timetable/timetable-service.ts`)
A slot (course C, day D, period P, room R) is rejected when any other slot in the same academic year at (D, P) has:
1. the same teacher — C's teacher or any co-teacher equals the other course's teacher or co-teacher: "Clash: Tom Teacher already teaches Science – 7B on Monday, Period 2.";
2. the same room (when R is set): "Clash: Room 101 is used by English – 7B on Monday, Period 2.";
3. the same section — both courses have the same `sectionId`: "Clash: 7A already has History on Monday, Period 2.";
4. an overlapping student — any student with ACTIVE enrollment in both courses (covers electives): "Clash: 3 students in Robotics Club also take Art – 7A at this time.";
5. a non-CLASS period or a non-teaching day: "Period 'Lunch' is not a class period."
`validateSlot(input)` returns all clashes (not just the first) so the editor can display them together.

### FR-4 Timetable editor (`/admin/timetable`)
1. View selector: by Section (default), Teacher or Room, plus an entity picker and academic year.
2. Grid: columns = teaching days, rows = periods (BREAK/LUNCH rows shown greyed and non-droppable). Each filled cell shows subject colour, course code, teacher surname and room.
3. Section view sidebar lists the section's courses with a counter "placed N" per course. Dragging a course onto a cell calls `POST /api/timetable/slots`; dropping uses the section's homeroom room by default. Dragging an existing slot to another cell moves it (`PATCH`). Dragging out of the grid or pressing Delete on a focused slot removes it after confirmation.
4. Before a drop is committed, cells that would clash are tinted red while dragging (computed from a preloaded clash map for the dragged course: `GET /api/timetable/availability?courseId=`).
5. If the server rejects the slot, the card snaps back and an error toast (`useToast`) lists every clash.
6. Clicking a slot opens an MUI `Popover` with an `Autocomplete` to change the room (room picker shows free rooms only for that day/period).
7. Keyboard alternative (accessibility): every cell is focusable; Enter on an empty cell opens a "Place course" dialog listing the section's courses.
8. Use `@dnd-kit/core` for drag behaviour only; the grid is an MUI `Table` (or CSS-grid `Box`) and every course card and cell is an MUI `Paper`/`Card` with `Chip`s and `Tooltip`s.

### FR-5 Personal timetables
1. `/timetable` for TEACHER (own courses incl. co-teaching), STUDENT (ACTIVE enrollments) and PARENT (child selector when more than one child). Same grid style, read-only, current period highlighted when today is a teaching day.
2. Toggle "Week" / "Today". Today view: vertical list of today's periods with course, teacher, room, and badges "Now" (current) and "Next".
3. Student tab "Timetable" registered in `student-tabs.ts` (reuses the read-only grid).
4. Course tab "Schedule" lists the course's weekly meeting times.
5. Print: a "Print" button opens a print-friendly layout (CSS `@media print`, A4 landscape, no sidebar) for any grid view.

### FR-6 Lookup helpers for later PRDs
1. `getScheduleForDate(userOrSection, date)` → ordered list of `{ period, course, room }` for that date, honouring teaching days (holidays are added by PRD-14).
2. `getCurrentSlot(user, now)` → the slot in progress or `null`.

### FR-7 Navigation
1. "Timetable" for TEACHER, STUDENT, PARENT. Administration group: "Timetable editor", "Bell schedule".

## API

| Method & path | Role | Notes |
|---|---|---|
| `GET /api/periods` | any | Ordered |
| `POST /api/periods` · `PATCH /api/periods/:id` · `DELETE /api/periods/:id` | ADMIN | |
| `POST /api/periods/reorder` | ADMIN | `{ periodIds }` |
| `GET /api/school-days` · `PUT /api/school-days` | GET any, PUT ADMIN | |
| `GET /api/timetable?view=section&id=&academicYearId=` | ADMIN (any view); TEACHER own teacher view and own sections | Returns slots with course, teacher, room |
| `GET /api/timetable/availability?courseId=` | ADMIN | `{ "<day>-<periodId>": [clash messages] }` |
| `POST /api/timetable/slots` | ADMIN | `{ courseId, dayOfWeek, periodId, roomId? }`; `409` with `details.clashes[]` |
| `PATCH /api/timetable/slots/:id` · `DELETE /api/timetable/slots/:id` | ADMIN | |
| `GET /api/me/timetable?studentId=` | any | `studentId` required for PARENT with multiple children |

## Non-Functional Requirements

1. **Integrity:** clash validation and insert run in a single serializable transaction so two admins cannot create a clash simultaneously.
2. **Performance:** the editor loads a section week (up to 7 days × 12 periods) in under 400 ms; availability map for one course returns in under 300 ms.
3. **Accessibility:** drag-and-drop has the keyboard alternative from FR-4.7; colour is never the only signal (clashing cells also show an icon and tooltip).

## Acceptance Criteria

1. Given Tom teaches MATH-7A on Monday Period 1, when an admin places MATH-7B (also Tom) on Monday Period 1, then the request returns `409` with the teacher-clash message and nothing is saved.
2. Given Robotics Club shares Sam with ART-7A, when the admin places Robotics Club at the same time as ART-7A, then the student-overlap clash is reported with the count.
3. Given a slot on the Lunch period is attempted, then it is rejected with the non-class-period message.
4. Given Sam's courses are scheduled, when Sam opens `/timetable` on a Monday at 08:20 and Period 1 runs 08:00–08:45, then the Today view marks MATH-7A "Now" and the following class "Next".
5. Given Pat has two children, when Pat opens `/timetable`, then a child selector is shown and switching it changes the grid.
6. Given an admin turns off Wednesday as a teaching day with slots present, then a confirmation shows the number of slots to be removed and confirming deletes them.
7. Given any grid, when Print is used, then the printed page contains only the grid, the entity name and the academic year.

## Test Requirements

- Unit: every clash rule including co-teacher and student overlap; period overlap validation; current/next slot calculation across timezones.
- Integration: concurrent conflicting inserts — only one succeeds.
- Playwright: drag a course into a cell, see a clash error snackbar on a conflicting drop, student Today view.

## Seed Data

- Periods: Period 1 08:00–08:45, Period 2 08:50–09:35, Break 09:35–09:55 (BREAK), Period 3 09:55–10:40, Period 4 10:45–11:30, Lunch 11:30–12:15 (LUNCH), Period 5 12:15–13:00, Period 6 13:05–13:50.
- Teaching days Monday–Friday.
- A complete clash-free week for 7A and 7B: MATH and ENG 5 periods each, SCI 4, HIST 3, PE 2, ART 2 (21 of 30 slots), plus Robotics Club on Wednesday Period 6 (with 7A and 7B having no class then).
