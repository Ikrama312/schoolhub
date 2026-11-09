# PRD-15: Parent Portal — Child Switcher, Absence Notes & Conference Booking

**Ticket:** SCH-015 · **Depends on:** PRD-00 – PRD-14 · **Run mode:** `--brownfield --tech-stack react`

## Summary

Turn the parent experience into a coherent portal: a global child switcher, a per-child overview page that aggregates attendance, grades, assignments, timetable and announcements, parent-submitted absence notes with a staff approval workflow that sets attendance to EXCUSED, parent–teacher conference slot booking, and digital consent forms for trips and activities.

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

Earlier PRDs gave parents read access to each feature separately. Parents with several children now need one place per child, plus the three tasks they most often phone the office about: reporting an absence, booking a meeting with a teacher, and returning permission slips.

## Goals

1. A parent sees everything important about one child on a single page within 2 clicks of signing in.
2. 90 % of absence reports arrive through the portal instead of phone calls (measured by `AbsenceNote` count vs. manual EXCUSED edits).
3. Parent–teacher conference scheduling needs no office involvement.

## Out of Scope

- Payment of fees (PRD-17 provides invoices; online payment is out of scope there too).
- Pickup authorisation and transport tracking.
- Parent account self-registration (still invite-only).

## User Stories

- As a parent with several children, I want to switch the active child in one place so that every page shows that child's data.
- As a parent, I want a child overview page so that I can see today's classes, recent grades, attendance and what's due.
- As a parent, I want to report an absence in advance or after the fact with a reason and optional document so that it is excused.
- As a teacher or admin, I want to review absence notes and approve or reject them so that attendance is accurate.
- As a teacher, I want to publish conference time slots so that parents can book them.
- As a parent, I want to book, reschedule or cancel a conference slot so that I can meet my child's teachers.
- As an admin, I want to send consent forms and track responses so that trips can be planned.
- As a parent, I want to sign consent forms online so that I don't need to send paper slips.

## Functional Requirements

### FR-1 Data model

```prisma
enum AbsenceNoteStatus { PENDING APPROVED REJECTED }
enum AbsenceReason { ILLNESS MEDICAL_APPOINTMENT FAMILY_EMERGENCY RELIGIOUS_OBSERVANCE BEREAVEMENT OTHER }
enum ConsentResponseValue { GRANTED DECLINED }

model AbsenceNote {
  id           String            @id @default(cuid())
  studentId    String
  submittedById String                         // parent
  fromDate     DateTime          @db.Date
  toDate       DateTime          @db.Date      // >= fromDate, span ≤ 30 days
  partialDay   Boolean           @default(false)
  periodIds    String[]          @default([])  // when partialDay
  reason       AbsenceReason
  details      String?                         // max 1,000
  fileId       String?                         // e.g. doctor's note
  status       AbsenceNoteStatus @default(PENDING)
  reviewedById String?
  reviewNote   String?
  reviewedAt   DateTime?
  createdAt    DateTime          @default(now())
  @@index([studentId, fromDate])
}

model ConferenceEvent {
  id           String   @id @default(cuid())
  title        String                          // "Autumn parent–teacher conferences"
  date         DateTime @db.Date
  bookingOpensAt  DateTime
  bookingClosesAt DateTime
  slotMinutes  Int      @default(10)           // 5–60
  gradeLevelIds String[]                       // eligible students' grade levels
  createdById  String
  createdAt    DateTime @default(now())
  slots        ConferenceSlot[]
}

model ConferenceSlot {
  id            String          @id @default(cuid())
  conferenceId  String
  conference    ConferenceEvent @relation(fields: [conferenceId], references: [id], onDelete: Cascade)
  teacherId     String
  startAt       DateTime
  endAt         DateTime
  location      String?                          // room or video link
  bookedByParentId String?
  studentId     String?
  parentNote    String?                          // max 500
  bookedAt      DateTime?
  @@unique([teacherId, startAt])
  @@index([conferenceId, teacherId])
}

model ConsentForm {
  id           String   @id @default(cuid())
  title        String
  description  String                            // Markdown
  dueAt        DateTime
  requiresPaymentNote String?                    // e.g. "Trip cost $25 — will be invoiced" (informational)
  eventId      String?                           // optional link to a CalendarEvent
  createdById  String
  createdAt    DateTime @default(now())
  audiences    ConsentAudience[]
  responses    ConsentResponse[]
}

model ConsentAudience {
  id       String       @id @default(cuid())
  formId   String
  form     ConsentForm  @relation(fields: [formId], references: [id], onDelete: Cascade)
  type     AudienceType                          // GRADE_LEVEL, SECTION or COURSE only
  refId    String
}

model ConsentResponse {
  formId       String
  form         ConsentForm          @relation(fields: [formId], references: [id], onDelete: Cascade)
  studentId    String
  parentId     String
  response     ConsentResponseValue
  signatureName String                           // typed full name
  comment      String?
  respondedAt  DateTime             @default(now())
  ipAddress    String?
  @@id([formId, studentId])                      // one response per student (any linked parent)
}
```

### FR-2 Child switcher
1. For PARENT users with 2+ children, the top bar shows a child switcher (avatar + first name dropdown). The selection is stored in a cookie `sh_child` (validated against links on every request; invalid → first child).
2. Every parent-facing page that accepts `studentId` (timetable, assignments, grades, calendar filter) defaults to the selected child, replacing per-page child selectors from earlier PRDs with this shared one (keep the `?studentId=` query parameter as an override).
3. Parents with exactly one child see the child's name in the top bar without a dropdown.

### FR-3 Child overview (`/my-children/[studentId]`, default landing for parents)
1. Replace the PRD-03 "My children" list: parents with one child land directly on that child's overview; with several, `/my-children` shows cards with a mini summary (attendance rate this term, number of missing assignments, average grade) linking to each overview.
2. Overview sections (each a card with "View all" link to the full page/tab):
   - Today: the child's schedule or holiday message (PRD-06/14).
   - Attendance: term rate, absences and lates this term, last 5 marks; "Report an absence" button.
   - Assignments: missing (red), due in the next 7 days.
   - Recent grades: last 5 returned/visible grades with course and score; current percent per course.
   - Announcements: last 3 unread for this child.
   - Upcoming events: next 5 calendar items.
   - Teachers: list of the child's teachers with subject and a "Message" button (PRD-13).
   - Action items: pending consent forms, open conference bookings.
3. Each section loads independently (React Suspense streaming) so one slow query does not block the page.

### FR-4 Absence notes
1. Parent form (`/my-children/[studentId]/absence/new`): from/to dates (past 14 days up to 60 days ahead), whole day or specific periods (period checkboxes from the bell schedule), reason, details, optional document upload (context `absence-note`, PDF/JPG/PNG only).
2. On submit: status PENDING; notify the homeroom teacher and admins (`absence_note.submitted`, default email false). Parent sees a list of their notes with status.
3. Review queue `/attendance/absence-notes` (homeroom TEACHER for their section, ADMIN for all): filters by status and date; each note shows student, dates, reason, details, document link, and existing attendance records for those dates. Actions: Approve (optional note) / Reject (note required).
4. Approve effect: for every matching attendance record (dates and, if partial, periods) with status ABSENT or none yet, set status EXCUSED with note "Absence note #<id>" and audit. For future dates, store the approval; when a register is later taken, students with an approved note covering that date/period are pre-filled as EXCUSED (shown with a badge "Absence note") — teachers can still change it.
5. EXCUSED is now selectable by teachers too in the register only when an approved note exists; ADMIN can always set it.
6. Notify the parent of the decision (`absence_note.reviewed`, default email true).
7. Absence notification suppression: if an approved or pending note covers a date/period, PRD-07 `attendance.absent` notifications are not sent for that student.

### FR-5 Conference booking
1. Admin creates a `ConferenceEvent` (`/admin/conferences`): title, date, booking window, slot length, eligible grade levels. Teachers teaching eligible students are invited (`conference.slots_requested`).
2. Teacher availability (`/conferences/[id]/availability`): pick time ranges on the date (for example 15:00–18:00) and a location; the system generates slots of `slotMinutes`. Teachers can remove unbooked slots and block individual slots.
3. Parent booking (`/conferences/[id]`): for each of the selected child's teachers (only those with slots), show available slots as time buttons; booking takes a slot atomically (`UPDATE … WHERE bookedByParentId IS NULL`), with a note. A parent can book at most one slot per teacher per child; overlapping bookings with other teachers are blocked ("You already have a meeting with Ms. Tutor at 15:20").
4. Reschedule = cancel + book; cancellations allowed until `bookingClosesAt`.
5. Confirmation notifications to parent and teacher (`conference.booked`, `conference.cancelled`), with `.ics` attachment link.
6. Teacher's day view lists booked slots in order with student, parent and note; printable.
7. Bookings appear on both parties' calendars (PRD-14 source "My meetings").

### FR-6 Consent forms
1. Admins (any audience) and teachers (courses they manage) create forms (`/consent-forms/new`) with title, description, due date, optional linked event, audience. Notify parents of students in the audience (`consent.requested`, default email true).
2. Parent view: pending forms on the child overview and at `/consent-forms`; responding requires choosing Granted / Declined and typing their full name as signature (must match the parent's name case-insensitively) plus optional comment. One response per student; any linked parent may respond; changes allowed until the due date (audited).
3. Tracking page for creators: per-student status (Granted, Declined, No response) with filters, CSV export, and "Remind non-responders" (once per 24 hours).
4. The maintenance run sends a reminder 48 hours before `dueAt` to parents with no response.

### FR-7 File access
1. Register `absence-note`: the submitting parent, other linked parents, homeroom teacher, admins.

### FR-8 Navigation
1. Parents: "My children" (overview), "Absence notes", "Conferences", "Consent forms". Teachers: "Absence notes" (homeroom only), "Conferences". Admins: "Conferences", "Consent forms", "Absence notes".

## API

| Method & path | Role | Notes |
|---|---|---|
| `GET /api/me/children/summary` | PARENT | Cards data |
| `GET /api/students/:id/overview` | view student | Aggregated sections |
| `POST /api/students/:id/absence-notes` | linked PARENT | |
| `GET /api/absence-notes?status=&sectionId=` | ADMIN, homeroom TEACHER, PARENT (own) | |
| `POST /api/absence-notes/:id/review` | ADMIN, homeroom TEACHER | `{ decision: "APPROVE" \| "REJECT", note? }` |
| `POST /api/conferences` · `PATCH /api/conferences/:id` | ADMIN | |
| `PUT /api/conferences/:id/availability` | TEACHER | `{ ranges: [{ start, end }], location }` → regenerates unbooked slots |
| `GET /api/conferences/:id/slots?studentId=` | PARENT, TEACHER, ADMIN | |
| `POST /api/conference-slots/:id/book` · `/cancel` | PARENT | `{ studentId, note }` |
| `POST /api/consent-forms` · `GET /api/consent-forms` | create ADMIN/TEACHER; list all roles (own scope) | |
| `PUT /api/consent-forms/:id/responses/:studentId` | linked PARENT | `{ response, signatureName, comment }` |
| `GET /api/consent-forms/:id/tracking` | creator, ADMIN | `?format=csv` |
| `POST /api/consent-forms/:id/remind` | creator, ADMIN | 24h throttle |

## Non-Functional Requirements

1. **Concurrency:** two parents booking the same slot simultaneously → exactly one succeeds; the other sees "That slot was just taken" and refreshed slots.
2. **Performance:** child overview first section paints in under 1 second; full page under 2 seconds.
3. **Auditability:** absence approvals, consent responses and changes write audit entries including IP address.

## Acceptance Criteria

1. Given Pat has Sam and Sara, when Pat switches to Sara in the top bar, then timetable, assignments and grades pages show Sara's data without extra selection.
2. Given Pat reports Sam absent tomorrow for a medical appointment and Tom (homeroom) approves, when Tom takes the register tomorrow, then Sam is pre-filled EXCUSED with the "Absence note" badge, and no absence notification is sent.
3. Given Sam was marked ABSENT yesterday and Pat submits a note for yesterday that is approved, then yesterday's records become EXCUSED and Sam's attendance rate is recalculated.
4. Given a rejected note, then Pat is notified with the reviewer's note and records stay ABSENT.
5. Given two parents click the same slot at the same moment, then one booking succeeds and the other gets the "just taken" message.
6. Given Pat has a 15:20 meeting with Tina, when Pat tries to book Tom at 15:20, then the overlap error shows.
7. Given a consent form for Grade 7 and Pat grants for Sam typing "pat parent", then the response is accepted (case-insensitive name match) and the tracking page shows Sam as Granted.
8. Given a parent with one child signs in, then they land on that child's overview.

## Test Requirements

- Unit: absence-note coverage matching (whole day vs periods, multi-day), slot generation, signature name match.
- Integration: approval updates existing records and pre-fills future registers; atomic slot booking under concurrency; notification suppression.
- Playwright: parent submits absence note → teacher approves → register shows EXCUSED; parent books a conference slot; parent signs consent.

## Seed Data

- One pending and one approved absence note for Grade 7 students.
- Conference event "Autumn conferences" 3 weeks from seed date for Grade 7 with slots for Tom and Tina (15:00–17:00, 10-minute slots), two booked.
- Consent form "Science Museum Trip" for Grade 7, due in 10 days, linked to a calendar event, with 40 % responses.
