# PRD-14: School Calendar, Events & Holidays

**Ticket:** SCH-014 · **Depends on:** PRD-00 – PRD-13 · **Run mode:** `--brownfield --tech-stack react`

## Summary

A shared school calendar with targeted events (holidays, exams, parent evenings, trips, deadlines), automatic overlay of each user's assignment due dates and quiz windows, month/week/agenda views, RSVP for events that need it, and a private iCal subscription feed per user. Holidays become first-class: timetable and attendance stop expecting classes on holiday dates.

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

Families ask the office the same questions every week: when is the next holiday, when are exams, when is the parent evening. Teachers need to avoid setting deadlines on trip days. One calendar, filtered to each person and syncable to phone calendars, answers these questions without the office.

## Goals

1. Every user sees, in one calendar, school events meant for them plus their own deadlines.
2. Users can subscribe from Google Calendar, Apple Calendar or Outlook with one copied link.
3. Attendance and timetable views treat holidays as non-teaching days automatically.

## Out of Scope

- Room booking for events (event location is free text plus an optional room).
- Recurring events with complex patterns — supports none, weekly or monthly-by-date until an end date.
- Two-way sync with external calendars.

## User Stories

- As an admin, I want to add holidays and term breaks so that everyone knows when school is closed.
- As an admin or teacher, I want to create events for a chosen audience so that the right people see them.
- As a student, I want my assignment due dates and quizzes on the calendar so that I can plan.
- As a parent, I want to subscribe to my children's calendar from my phone so that I don't miss anything.
- As a parent, I want to RSVP to events like parent evenings so that the school can plan.
- As a teacher, I want to see a warning when I set a deadline on a holiday so that I avoid mistakes.

## Functional Requirements

### FR-0 Dependency

1. `@mui/x-scheduler` is in the Fixed Technology Decisions table but is not yet in `package.json` (only `@mui/x-charts`, `@mui/x-data-grid` and `@mui/x-date-pickers` are installed) — no earlier PRD needed it. Before any other FR in this PRD, install `@mui/x-scheduler`, pinning the exact version found via the MUI MCP server (per the UI component rule's lookup-before-use requirement, since the package is in beta).

### FR-1 Data model

```prisma
enum EventCategory { HOLIDAY TERM_BREAK EXAM EVENT MEETING TRIP SPORTS DEADLINE OTHER }
enum Recurrence { NONE WEEKLY MONTHLY }
enum RsvpResponse { YES NO MAYBE }

model CalendarEvent {
  id            String        @id @default(cuid())
  title         String                        // max 150
  description   String?                       // Markdown, max 5,000
  category      EventCategory
  startAt       DateTime
  endAt         DateTime                      // >= startAt
  allDay        Boolean       @default(false) // all-day: startAt/endAt are midnight school tz, endAt exclusive
  location      String?
  roomId        String?
  recurrence    Recurrence    @default(NONE)
  recurrenceUntil DateTime?   @db.Date
  isNoSchool    Boolean       @default(false) // HOLIDAY / TERM_BREAK default true
  rsvpEnabled   Boolean       @default(false)
  rsvpDeadline  DateTime?
  isPublic      Boolean       @default(false) // shown on public website calendar (PRD-18)
  createdById   String
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
  audiences     EventAudience[]
  rsvps         EventRsvp[]
  @@index([startAt, endAt])
}

model EventAudience {
  id              String        @id @default(cuid())
  eventId         String
  event           CalendarEvent @relation(fields: [eventId], references: [id], onDelete: Cascade)
  type            AudienceType                 // reuse enum from PRD-12
  refId           String?
  includeStudents Boolean       @default(true)
  includeParents  Boolean       @default(true)
  includeTeachers Boolean       @default(true)
}

model EventRsvp {
  eventId     String
  event       CalendarEvent @relation(fields: [eventId], references: [id], onDelete: Cascade)
  userId      String
  response    RsvpResponse
  guests      Int           @default(0)      // 0–5
  note        String?
  respondedAt DateTime      @updatedAt
  @@id([eventId, userId])
}

model CalendarFeedToken {
  userId     String   @id
  tokenHash  String   @unique
  createdAt  DateTime @default(now())
}
```

### FR-2 Permissions
1. ADMIN: create any event with any audience; `isNoSchool`, `isPublic` and categories HOLIDAY / TERM_BREAK are admin-only.
2. TEACHER: create events for COURSE audiences they manage or their homeroom SECTION (same rule as PRD-12, reusing `audience.ts`).
3. Creators edit their own events; admins edit all.

### FR-3 Calendar page (`/calendar`)
1. Views: Month (default on ≥ 768 px), Week (time grid 07:00–19:00, all-day row on top) and Agenda (default on < 768 px; chronological list grouped by day, 30 days ahead, infinite scroll). Navigation: Today, previous, next, date picker. Use the MIT MUI X Scheduler `EventCalendar` (`@mui/x-scheduler`, views `month`, `week`, `agenda`; `viewConfig` `startTime: 7`, `endTime: 19`); read its Quickstart, Views, Events, Timezones and Localization pages through the MUI MCP first. Recurrence is a Premium feature, so the API returns already-expanded occurrences (FR-4) and the calendar receives plain events. If a required behaviour is missing from the Community version, build it from `@mui/material` and `@mui/x-date-pickers` (`DateCalendar` + `List`) instead of adding another calendar library.
2. Sources (toggleable MUI `Chip`s, preference saved in `localStorage`): School events (colour by category), My assignments (due dates, colour from subject), My quizzes (availability window end), My timetable (Week view only, light background blocks), Holidays.
3. Parents: child filter (All children or one); deadline sources show items for the selected children labelled with the child's name.
4. Clicking an event opens a right-anchored MUI `Drawer`: title, category badge, time in school timezone, location, description, audience chips, RSVP controls (if enabled), "Add to my calendar" (`.ics` download of that event), edit/delete for permitted users. Clicking a deadline navigates to the assignment or quiz.
5. "New event" button for ADMIN/TEACHER opens the editor (dialog): all fields from the model with the audience builder from PRD-12, recurrence options, RSVP toggle and deadline.

### FR-4 Recurrence
1. Recurring events are stored once and expanded at read time for the requested range (`expandOccurrences(event, from, to)`), up to `recurrenceUntil` (required for recurring events, at most 1 year after start). Editing applies to the whole series (single-occurrence exceptions are out of scope).

### FR-5 Holidays integration
1. `isSchoolDay(date)` in `src/server/calendar/calendar-service.ts`: false when the weekday is not a teaching day (PRD-06) or any `isNoSchool` event with SCHOOL audience covers the date.
2. Update PRD-06 `getScheduleForDate` to return an empty list with `reason: "Holiday: Thanksgiving"` on non-school days; Today views show the holiday name instead of classes.
3. Update PRD-07 teacher register landing: non-school days show "No classes today — Thanksgiving"; opening a register for such a date shows a warning banner and requires an extra confirmation "Record attendance on a holiday anyway".
4. Update PRD-09 assignment editor and PRD-10 quiz settings: when the due date / close date falls on a non-school day, show a non-blocking warning "This date is a holiday (Thanksgiving)."
5. Admin shortcut on `/admin/academic-years/[id]`: "Add term breaks" creates TERM_BREAK no-school events for gaps between consecutive terms.

### FR-6 RSVP
1. When enabled, audience members choose Yes / No / Maybe with guest count (parents) and optional note until `rsvpDeadline`. The event drawer shows the user's response and totals (for creator/admin: full list with CSV export).
2. Register `event.rsvp_reminder`: 48 hours before the deadline, the maintenance run notifies audience members who have not responded (once per event).

### FR-7 iCal feed
1. `/account/calendar` page: "Subscribe" section with a private URL `APP_URL/api/calendar/feed/<token>.ics`, copy button, instructions for Google, Apple and Outlook, and "Reset link" (invalidates old token).
2. The feed (RFC 5545, `text/calendar`) contains the user's school events (for parents: events for all children's audiences) from 30 days in the past to 365 days ahead, plus assignment due dates and quiz close times as all-day or timed events with `URL` back to SchoolHub. Recurring events emit `RRULE`. `VTIMEZONE` for the school timezone. Use the `ics` package or hand-written builder with escaping per RFC (commas, semicolons, newlines).
3. The feed endpoint is public (token-authenticated), rate limited to 60 requests per token per hour, and sets `Cache-Control: private, max-age=900`.

### FR-8 Notifications
1. `event.created` → audience members when an event is created with a start date within the next 30 days (default email false; HOLIDAY/TERM_BREAK default email true).
2. `event.updated` → audience members when time or location changes for an upcoming event (once per edit).

### FR-9 Public & dashboard hooks
1. `getPublicEvents(from, to)` returns public events for PRD-18.
2. `getUpcomingEventsForUser(user, limit)` for PRD-16 dashboards.

## API

| Method & path | Role | Notes |
|---|---|---|
| `GET /api/calendar?from=&to=&sources=&studentId=` | any | Merged, expanded, audience-filtered items; range ≤ 100 days |
| `POST /api/events` | ADMIN, TEACHER | Audience permission check |
| `GET /api/events/:id` · `PATCH` · `DELETE` | audience / creator / ADMIN | |
| `GET /api/events/:id/ics` | audience | Single-event download |
| `PUT /api/events/:id/rsvp` | audience | `{ response, guests, note }`, before deadline |
| `GET /api/events/:id/rsvps` | creator, ADMIN | `?format=csv` |
| `GET /api/me/calendar-feed` · `POST /api/me/calendar-feed/reset` | any | Returns URL (raw token shown only at creation/reset; stored hashed) |
| `GET /api/calendar/feed/:token.ics` | token | Public route |
| `GET /api/public/events?from=&to=` | public | |
| `GET /api/school-day?date=` | any | `{ isSchoolDay, reason }` |

## Non-Functional Requirements

1. **Correctness:** all-day events and DST transitions in the school timezone render on the correct dates in both the UI and the iCal feed (tests cover a DST-change week).
2. **Performance:** a month view for a parent with 3 children loads in under 500 ms.
3. **Security:** feed tokens are 32 random bytes stored hashed; the feed exposes no data beyond what the user can see in the app.
4. **Validation:** the generated feed passes an RFC 5545 validator test (parse with `node-ical` in tests).

## Acceptance Criteria

1. Given an admin creates "Thanksgiving" (HOLIDAY, all day, 26–27 Nov 2026, SCHOOL), then everyone sees it, `isSchoolDay('2026-11-26')` is false, and Sam's Today view on that date shows "Holiday: Thanksgiving".
2. Given Tom opens the register for MATH-7A on 26 Nov, then a holiday warning appears and saving requires the extra confirmation.
3. Given Sam has an assignment due 14 Oct, then it appears on Sam's calendar on 14 Oct in the subject colour and links to the assignment; Pat sees it labelled "Sam".
4. Given a weekly "Chess club" event every Tuesday until 15 Dec, then the month view shows each Tuesday occurrence and the iCal feed contains one event with an `RRULE`.
5. Given Pat subscribes using the feed URL, then a calendar client import shows school events and Sam's deadlines; after "Reset link", the old URL returns `404`.
6. Given a parent evening with RSVP until Friday, then Pat can answer Yes with 1 guest before Friday; after the deadline the RSVP controls are disabled.
7. Given Tom creates an event for SCHOOL via the API, then `403`.
8. Given an assignment due date on a holiday, then the editor shows the holiday warning but allows saving.

## Test Requirements

- Unit: occurrence expansion, `isSchoolDay`, iCal escaping and RRULE generation, all-day exclusive end handling.
- Integration: calendar merge endpoint per role, feed token reset, RSVP deadline enforcement.
- Playwright: admin adds holiday → student Today view; parent RSVPs; feed URL returns valid ICS.

## Seed Data

- Events for 2026–2027: Thanksgiving break (26–27 Nov), Winter break (21 Dec – 1 Jan, TERM_BREAK), Semester 1 exams week (11–15 Jan, EXAM, Grade 6–8), Parent–teacher evening (RSVP, 2 weeks from seed date, Grade 7 parents), Science fair (public), weekly Chess club (Tuesdays, Robotics Club course audience), Sports day (public, ties to the PRD-12 announcement).
