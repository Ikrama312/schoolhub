# PRD-05: Sections, Courses & Enrollment

**Ticket:** SCH-005 · **Depends on:** PRD-00 – PRD-04 · **Run mode:** `--brownfield --tech-stack react`

## Summary

Introduce the two grouping concepts the rest of SchoolHub depends on: **sections** (homeroom groups such as "7A", one per student per academic year) and **courses** (a subject taught to a section by a teacher, such as "Mathematics – 7A"). Add enrollment management, class rosters, "My courses" pages for teachers and students, and the course home page with its tab framework.

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

In most schools a student belongs to one homeroom section for the year and takes most subjects with that section. Some subjects (electives, sets) mix students across sections. Attendance, assignments, quizzes, grades and the timetable are all organised per course.

## Goals

1. An admin can set up all sections and courses for a grade in under 10 minutes using the "create courses for section" shortcut.
2. Adding a student to a section automatically enrolls them in all that section's core courses.
3. Teachers and students land on their own course list with one click.

## Out of Scope

- Timetable slots (PRD-06). Course content (PRD-08).
- Prerequisites and course-request workflows.
- Promoting students to the next year (listed as future work; a manual "Copy sections to next year" shortcut is included below).

## User Stories

- As an admin, I want to create sections for the current year with a homeroom teacher so that students have a home group.
- As an admin, I want to assign students to a section so that they are enrolled in that section's courses.
- As an admin, I want to create a course for a subject, section and teacher so that teaching can be organised.
- As an admin, I want to enroll individual students in elective courses so that mixed groups are supported.
- As a teacher, I want to see my courses and their rosters so that I know who I teach.
- As a student, I want to see my courses and teachers so that I know my classes.

## Functional Requirements

### FR-1 Data model

```prisma
enum CourseKind { CORE ELECTIVE }
enum EnrollmentStatus { ACTIVE DROPPED }

model Section {
  id                String       @id @default(cuid())
  academicYearId    String
  academicYear      AcademicYear @relation(fields: [academicYearId], references: [id])
  gradeLevelId      String
  gradeLevel        GradeLevel   @relation(fields: [gradeLevelId], references: [id])
  name              String                         // "7A"
  homeroomTeacherId String?
  homeroomTeacher   User?        @relation("HomeroomTeacher", fields: [homeroomTeacherId], references: [id])
  roomId            String?
  room              Room?        @relation(fields: [roomId], references: [id])
  capacity          Int          @default(30)      // 1–60
  createdAt         DateTime     @default(now())
  updatedAt         DateTime     @updatedAt
  members           SectionMember[]
  courses           Course[]
  @@unique([academicYearId, name])
}

model SectionMember {
  id         String   @id @default(cuid())
  sectionId  String
  section    Section  @relation(fields: [sectionId], references: [id], onDelete: Cascade)
  studentId  String
  student    User     @relation(fields: [studentId], references: [id])
  joinedAt   DateTime @default(now())
  academicYearId String                             // denormalised for the uniqueness rule
  @@unique([studentId, academicYearId])            // one section per student per year
}

model Course {
  id              String       @id @default(cuid())
  academicYearId  String
  academicYear    AcademicYear @relation(fields: [academicYearId], references: [id])
  subjectId       String
  subject         Subject      @relation(fields: [subjectId], references: [id])
  sectionId       String?                          // null for cross-section electives
  section         Section?     @relation(fields: [sectionId], references: [id])
  teacherId       String
  teacher         User         @relation("CourseTeacher", fields: [teacherId], references: [id])
  coTeacherIds    String[]     @default([])        // additional teachers with full course access
  name            String                           // default "<Subject> – <Section>"
  code            String                           // default "<SUBJECTCODE>-<SECTION>", e.g. "MATH-7A"
  kind            CourseKind   @default(CORE)
  description     String?
  capacity        Int?
  archivedAt      DateTime?
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt
  enrollments     Enrollment[]
  @@unique([academicYearId, code])
}

model Enrollment {
  id          String           @id @default(cuid())
  courseId    String
  course      Course           @relation(fields: [courseId], references: [id], onDelete: Cascade)
  studentId   String
  student     User             @relation(fields: [studentId], references: [id])
  status      EnrollmentStatus @default(ACTIVE)
  enrolledAt  DateTime         @default(now())
  droppedAt   DateTime?
  @@unique([courseId, studentId])
  @@index([studentId, status])
}
```

### FR-2 Sections (`/admin/sections`)
1. Filtered by academic year (defaults to current). Table: name, grade level, homeroom teacher, room, members/capacity (with a warning colour at 90 % or more), course count.
2. Create/edit dialog: grade level, name, homeroom teacher (UserPicker, TEACHER only), room, capacity. A teacher may be homeroom teacher of at most one section per year.
3. Section detail (`/admin/sections/[id]`): members table with add (multi-select student picker filtered to the section's grade level and to students without a section this year) and remove; course list for the section; button "Create core courses".
4. "Create core courses" dialog lists all active subjects with a checkbox and teacher picker per subject; submitting creates one CORE course per checked subject with default name and code, and enrolls all current members.
5. "Copy sections to next year" action on the sections page (enabled when a non-current, future academic year exists): copies section names, grade level (advanced to the next `order` grade level), room and capacity, without members or teachers.

### FR-3 Auto-enrollment rules (service layer, `src/server/services/enrollment.ts`)
1. Adding a student to a section enrolls them (`ACTIVE`) in every non-archived CORE course of that section; a previously `DROPPED` enrollment is reactivated.
2. Removing a student from a section sets every ACTIVE enrollment in that section's CORE courses to `DROPPED` with `droppedAt = now`. Elective enrollments are untouched.
3. Moving a student between sections (single action "Move to section…") performs both steps in one transaction.
4. Creating a new CORE course on a section enrolls all its current members.
5. Capacity: adding beyond section or course capacity is refused with `CONFLICT` "Section 7A is full (30/30)." unless the admin ticks "Override capacity".
6. Dropped enrollments keep all historical data (attendance, grades) visible to admins and teachers; dropped students disappear from active rosters and pickers.

### FR-4 Courses (`/admin/courses`)
1. Filters: academic year, grade level, subject, teacher, kind, search by name or code. Table: code, name, subject colour chip, section, teacher, enrolled count, kind.
2. Create/edit dialog: subject, section (optional — required for CORE), teacher, co-teachers (up to 3), name, code (auto-filled, editable, uppercase), kind, capacity, description.
3. Course enrollment management (`/admin/courses/[id]/enrollment`): enrolled students table with drop / reactivate actions; "Add students" picker; for CORE courses an info note says members are managed via the section.

### FR-5 Course home (`/courses/[courseId]`)
1. Header: subject colour band, course name, code, teacher(s), section, room.
2. MUI `Tabs` (scrollable on small screens) registered in a new `src/config/course-tabs.ts` (same shape as student tabs, with `roles`). This PRD registers: "Overview" (description, teachers, counts) and "Roster" (TEACHER/ADMIN: student list with avatar, name, admission number, links to student page, enrollment status; STUDENT: classmates' names only; PARENT: not visible).
3. Access helper `assertCanViewCourse(user, courseId)` in `src/server/auth/course-access.ts`: ADMIN all; TEACHER if teacher or co-teacher; STUDENT if ACTIVE enrollment; PARENT if any linked child has an ACTIVE enrollment. Also export `assertCanManageCourse` (ADMIN, teacher, co-teacher) for later write operations.

### FR-6 My courses
1. `/my-courses` for TEACHER: MUI `Card`s in a responsive `Grid` for each non-archived course in the current year (name, section, enrolled count). For STUDENT: cards for ACTIVE enrollments (name, teacher). For PARENT: grouped by child.
2. Sidebar: "My courses" for TEACHER, STUDENT, PARENT; "Sections" and "Courses" in the Administration group.

### FR-7 Student page integration
1. Register student tab "Courses" (all roles that can view the student): table of the student's courses this year with teacher and enrollment status, plus their section and homeroom teacher.

### FR-8 Extend teacher access
1. Extend `getAccessibleStudentIds(user)` from PRD-03 so a TEACHER gets students with ACTIVE enrollments in their courses (as teacher or co-teacher) plus members of the section they homeroom.

## API

| Method & path | Role | Notes |
|---|---|---|
| `GET /api/sections?academicYearId=` | ADMIN, TEACHER | |
| `POST /api/sections` · `PATCH /api/sections/:id` · `DELETE /api/sections/:id` | ADMIN | Delete only when no members and no courses |
| `POST /api/sections/:id/members` | ADMIN | `{ studentIds: string[], overrideCapacity? }` |
| `DELETE /api/sections/:id/members/:studentId` | ADMIN | |
| `POST /api/students/:id/move-section` | ADMIN | `{ toSectionId }` |
| `POST /api/sections/:id/core-courses` | ADMIN | `{ items: [{ subjectId, teacherId }] }` |
| `POST /api/sections/copy-to-year` | ADMIN | `{ fromYearId, toYearId }` |
| `GET /api/courses` | ADMIN (all), others (own) | Filters + pagination |
| `POST /api/courses` · `PATCH /api/courses/:id` | ADMIN | Archive via `{ archived: true }` |
| `GET /api/courses/:id` | `assertCanViewCourse` | |
| `GET /api/courses/:id/roster` | `assertCanViewCourse` | Shape depends on role |
| `POST /api/courses/:id/enrollments` | ADMIN | `{ studentIds, overrideCapacity? }` |
| `PATCH /api/enrollments/:id` | ADMIN | `{ status }` |
| `GET /api/me/courses` | any | |

All writes audit (`section.*`, `course.*`, `enrollment.*`).

## Non-Functional Requirements

1. **Integrity:** the one-section-per-year rule is enforced by the database unique constraint, not only in code.
2. **Performance:** adding 30 students to a section with 8 core courses (240 enrollments) completes in under 1 second.
3. **Privacy:** students see classmates' names only — no emails, admission numbers or profile links.

## Acceptance Criteria

1. Given section 7A with 6 core courses, when an admin adds Sam to 7A, then Sam has 6 ACTIVE enrollments.
2. Given Sam is in 7A, when the admin moves Sam to 7B, then the 7A core enrollments are DROPPED, 7B's are ACTIVE, and Sam's elective enrollments are unchanged.
3. Given Sam is already in 7A this year, when an admin tries to add Sam to 7B directly, then the request fails with `CONFLICT` "Sam Student is already in section 7A for 2026–2027."
4. Given a section at capacity, when an admin adds another student without override, then the request fails with the full message.
5. Given Tom teaches Mathematics – 7A, when Tom opens `/my-courses`, then that course appears; when Tom opens a course he does not teach, then he gets the 403 page.
6. Given Pat is Sam's parent, when Pat opens `/my-courses`, then Sam's courses are listed under Sam's name, and the Roster tab is not shown on the course page.
7. Given a student opens the Roster tab, then only classmate names are displayed and the API response contains no emails.

## Test Requirements

- Unit: course code/name defaults, capacity check.
- Integration: auto-enroll on section add, move-section transaction, reactivation of DROPPED enrollment, `getAccessibleStudentIds` for teachers.
- Playwright: admin creates section 7B, adds students, creates core courses; teacher sees course in My courses.

## Seed Data

- Sections for 2026–2027: 6A, 7A (homeroom Tom Teacher, Room 101), 7B (homeroom Tina Tutor, Room 102).
- Sam, Sara and 6 of the Grade 7 seed students in 7A; the other 6 Grade 7 students in 7B; Grade 6 students in 6A.
- Core courses for 7A and 7B in all 6 subjects (Tom teaches MATH, Tina teaches ENG, the other seed teachers take SCI, HIST, PE, ART); same for 6A.
- One elective "Robotics Club" (subject SCI, no section, ELECTIVE, teacher Tom) with Sam and 3 students from 7B.
