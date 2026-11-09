# PRD-02: School Settings & Academic Structure

**Ticket:** SCH-002 · **Depends on:** PRD-00, PRD-01 · **Run mode:** `--brownfield --tech-stack react`

## Summary

Give admins the screens to configure the school itself and its academic skeleton: school profile settings, academic years, terms, grade levels, subjects and rooms. Every later feature (classes, timetables, attendance, grades, report cards) hangs off these records.

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
- `src/server/services/<feature>.ts` business logic and Prisma access. Server components may call services directly; client components call the REST API.
- `src/server/auth/permissions.ts` exposes `requireUser()`, `requireRole(...roles)` and per-entity access checks. Every handler and every server page enforces access server-side; hiding a button is never the only protection.
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

Schools organise the year into an academic year (for example "2026–2027") split into terms. Students belong to a grade level ("Grade 7"). Subjects ("Mathematics") are taught in rooms. These records change rarely but must be correct, because grades and attendance are reported per term.

## Goals

1. An admin can configure a full academic year, its terms, grade levels, subjects and rooms in under 15 minutes.
2. Exactly one academic year is marked current at any time; the rest of the app reads "current" from one helper.
3. Records that are referenced elsewhere cannot be deleted, only archived.

## Out of Scope

- Sections/homerooms and courses (PRD-05). Bell schedule periods (PRD-06). Grading scales (PRD-11). Holidays (PRD-14).

## User Stories

- As an admin, I want to edit the school name, logo URL, address, contact details and timezone so that every page and email shows correct information.
- As an admin, I want to create an academic year with terms so that grades and attendance can be grouped by term.
- As an admin, I want to mark a year as current so that the whole app uses it by default.
- As an admin, I want to manage grade levels, subjects and rooms so that classes can be created.

## Functional Requirements

### FR-1 Data model

```prisma
model AcademicYear {
  id         String   @id @default(cuid())
  name       String   @unique          // "2026–2027"
  startDate  DateTime @db.Date
  endDate    DateTime @db.Date
  isCurrent  Boolean  @default(false)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  terms      Term[]
}

model Term {
  id              String       @id @default(cuid())
  academicYearId  String
  academicYear    AcademicYear @relation(fields: [academicYearId], references: [id], onDelete: Restrict)
  name            String                     // "Term 1", "Fall Semester"
  startDate       DateTime     @db.Date
  endDate         DateTime     @db.Date
  order           Int
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt
  @@unique([academicYearId, name])
  @@unique([academicYearId, order])
}

model GradeLevel {
  id          String    @id @default(cuid())
  name        String    @unique         // "Grade 7"
  shortName   String    @unique         // "G7"
  order       Int       @unique         // sort order, lower = younger
  archivedAt  DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
}

model Subject {
  id           String    @id @default(cuid())
  name         String                    // "Mathematics"
  code         String    @unique         // "MATH", uppercase A–Z0–9, 2–10 chars
  description  String?
  color        String    @default("#4F46E5")  // hex, used in timetable/calendar
  archivedAt   DateTime?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
}

model Room {
  id          String    @id @default(cuid())
  name        String    @unique          // "Room 101", "Science Lab"
  building    String?
  capacity    Int?                        // 1–500
  archivedAt  DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
}
```

### FR-2 School settings (`/admin/settings/school`)
1. Form for every editable `SchoolSettings` field. Timezone is a searchable select of IANA zone names (`Intl.supportedValuesOf('timeZone')`).
2. Logo is a URL field in this PRD (file upload arrives with PRD-08 storage; PRD-08 must replace the URL field with an upload control).
3. Saving writes an audit entry `settings.school.update` with changed field names in metadata.
4. `getSchoolSettings()` in `src/server/services/settings.ts` is cached per request (React `cache()`), and the top bar and public footer use it.

### FR-3 Academic years (`/admin/academic-years`)
1. Table columns: name, start date, end date, number of terms, current badge, actions.
2. Create/edit dialog: name, start date, end date. Validation: end date must be after start date; the date range must not overlap any other academic year (error "Dates overlap with 2025–2026.").
3. Action "Set as current" (confirm dialog) sets `isCurrent = true` on this year and `false` on all others inside one transaction.
4. Delete is allowed only when the year has no terms and is not referenced by any other record (later PRDs reference it); otherwise the delete action is disabled with a tooltip "In use — cannot delete".
5. `getCurrentAcademicYear()` returns the current year with terms ordered by `order`, or `null`. `getCurrentTerm(date = today)` returns the term whose range contains the date in the school timezone, or `null`.
6. When no current year exists, admins see a dismissible banner on every admin page: "No current academic year is set. Set one in Academic Years."

### FR-4 Terms (`/admin/academic-years/[id]`)
1. Detail page lists the year's terms in order with inline create, edit and delete.
2. Validation: term dates must fall inside the academic year's dates; terms in the same year must not overlap; `order` is assigned automatically as max+1 and can be changed by drag handle or up/down buttons.
3. Dates use MUI X `DatePicker`. Shortcut button "Generate terms" with options "2 semesters", "3 trimesters" or "4 quarters" splits the year range into equal consecutive terms named "Semester 1"… / "Trimester 1"… / "Quarter 1"…; available only when the year has no terms.

### FR-5 Grade levels (`/admin/grade-levels`)
1. Table with name, short name, order, active student count (column added once PRD-03 exists; show "—" until then), status.
2. Create/edit dialog; reorder with up/down buttons. Archive/unarchive instead of delete when referenced.

### FR-6 Subjects (`/admin/subjects`)
1. Table with colour swatch, name, code, description, status. Search by name or code.
2. Create/edit dialog with a colour choice built from an MUI `ToggleButtonGroup` of 12 swatch `ToggleButton`s (accessible preset colours, each with at least 4.5:1 contrast against white text, each with an `aria-label` naming the colour).
3. Code is stored upper-case; duplicate code → field error "Code already used by Science."

### FR-7 Rooms (`/admin/rooms`)
1. Table with name, building, capacity, status. Create/edit/archive.

### FR-8 Navigation
1. Add an "Administration" sidebar group visible to `ADMIN` only, containing: School settings, Academic years, Grade levels, Subjects, Rooms.

## API

| Method & path | Role | Body / query | Notes |
|---|---|---|---|
| `GET /api/settings/school` | any signed-in | — | Returns settings |
| `PATCH /api/settings/school` | ADMIN | partial settings | Audit |
| `GET /api/academic-years` | any signed-in | — | Includes terms |
| `POST /api/academic-years` | ADMIN | `{ name, startDate, endDate }` | |
| `PATCH /api/academic-years/:id` | ADMIN | partial | |
| `POST /api/academic-years/:id/set-current` | ADMIN | — | Transaction |
| `DELETE /api/academic-years/:id` | ADMIN | — | `CONFLICT` if in use |
| `POST /api/academic-years/:id/terms` | ADMIN | `{ name, startDate, endDate }` | |
| `POST /api/academic-years/:id/terms/generate` | ADMIN | `{ pattern: "SEMESTERS" \| "TRIMESTERS" \| "QUARTERS" }` | |
| `PATCH /api/terms/:id` · `DELETE /api/terms/:id` | ADMIN | | |
| `POST /api/terms/reorder` | ADMIN | `{ academicYearId, termIds: string[] }` | |
| `GET/POST /api/grade-levels`, `PATCH /api/grade-levels/:id` | GET any, write ADMIN | | `?includeArchived=true` |
| `GET/POST /api/subjects`, `PATCH /api/subjects/:id` | GET any, write ADMIN | | |
| `GET/POST /api/rooms`, `PATCH /api/rooms/:id` | GET any, write ADMIN | | |

Archive and unarchive are `PATCH` with `{ archived: true|false }`. All write endpoints audit with action `<entity>.create|update|archive|delete`.

## Non-Functional Requirements

1. **Integrity:** overlap and range checks must run in the service layer inside a transaction so that two simultaneous requests cannot both succeed.
2. **Performance:** each admin list page must render in under 500 ms with 50 records.
3. **Usability:** every table has an empty state with a "Create …" call to action.

## Acceptance Criteria

1. Given no academic years, when an admin creates "2026–2027" from 2026-09-01 to 2027-06-30 and generates "2 semesters", then two terms exist: Semester 1 (2026-09-01 → 2027-01-30, 152 days) and Semester 2 (2027-01-31 → 2027-06-30, 151 days). The 303-day range is split by day count with earlier terms receiving the extra day when it does not divide evenly; terms are contiguous with no gap or overlap.
2. Given "2026–2027" is current, when the admin sets "2027–2028" as current, then only "2027–2028" has `isCurrent = true`.
3. Given an academic year 2026-09-01 → 2027-06-30, when the admin adds a term ending 2027-07-15, then validation fails with "Term must end on or before 2027-06-30."
4. Given a subject with code "MATH", when another subject is created with code "math", then a `CONFLICT` error shows on the code field.
5. Given a teacher session, when they call `POST /api/subjects`, then the response is `403`.
6. Given the school timezone is changed to "Asia/Kolkata", when any date is shown via `DateDisplay`, then it renders in that timezone.
7. Given no current academic year, then an admin sees the warning banner on admin pages.

## Test Requirements

- Unit: overlap detection, term generation splitting (including odd day counts), code normalisation.
- Integration: set-current transaction, delete-in-use conflict.
- Playwright: admin creates a year, generates terms, sets current; creates a subject and a room.

## Seed Data

- Academic year "2026–2027" (2026-09-01 → 2027-06-30, current) with Semester 1 (2026-09-01 → 2027-01-22) and Semester 2 (2027-01-25 → 2027-06-30).
- Grade levels: Grade 6 (G6, 6), Grade 7 (G7, 7), Grade 8 (G8, 8).
- Subjects: Mathematics (MATH), English Language (ENG), Science (SCI), History (HIST), Physical Education (PE), Art (ART).
- Rooms: Room 101 (30), Room 102 (30), Science Lab (24), Gym (100), Art Studio (20).
