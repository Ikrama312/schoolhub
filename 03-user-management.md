# PRD-03: User Management, Profiles, Family Links & Audit Viewer

**Ticket:** SCH-003 · **Depends on:** PRD-00, PRD-01, PRD-02 · **Run mode:** `--brownfield --tech-stack react`

## Summary

Admin screens to create, invite, edit, disable and archive users of every role; role-specific profiles for students, teachers and parents; parent–student links; bulk CSV import; the student detail page with its tab framework; a "My children" page for parents; self-service profile editing; and an audit log viewer.

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

The school office onboards hundreds of students and parents at the start of each year, usually from a spreadsheet exported by their old system. Parents often have more than one child at the school, and some children have more than one guardian. Every student-facing feature later depends on knowing who a student's parents are.

## Goals

1. An admin can import 500 students with their parents from one CSV file in under 2 minutes, with a row-level error report.
2. Parent ↔ student links drive all parent data access through one helper.
3. Every user-management change is visible in the audit log viewer.

## Out of Scope

- Avatar image upload (initials avatars only).
- Staff HR data (salary, contracts).
- Class and section membership (PRD-05).

## User Stories

- As an admin, I want to create a user of any role and send an invitation so that they can sign in.
- As an admin, I want to import students and parents from CSV so that I can onboard a whole year quickly.
- As an admin, I want to link parents to students so that parents see their children's information.
- As an admin, I want to disable or archive accounts so that leavers lose access while records are kept.
- As an admin, I want to search and filter users by role, status and grade level so that I can find people fast.
- As a parent, I want a "My children" page so that I can open each child's information.
- As any user, I want to edit my phone number and see my profile so that the school can contact me.
- As an admin, I want to browse the audit log so that I can see who changed what.

## Functional Requirements

### FR-1 Data model

```prisma
enum Gender { FEMALE MALE OTHER UNDISCLOSED }
enum GuardianRelationship { MOTHER FATHER GUARDIAN GRANDPARENT OTHER }

model StudentProfile {
  userId            String     @id
  user              User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  admissionNumber   String     @unique        // "S2026-0001"
  dateOfBirth       DateTime   @db.Date
  gender            Gender     @default(UNDISCLOSED)
  gradeLevelId      String
  gradeLevel        GradeLevel @relation(fields: [gradeLevelId], references: [id])
  enrollmentDate    DateTime   @db.Date
  addressLine1      String?
  city              String?
  medicalNotes      String?                   // visible to ADMIN and the student's teachers only
  emergencyContact  String?
  emergencyPhone    String?
}

model TeacherProfile {
  userId          String    @id
  user            User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  employeeNumber  String    @unique           // "T-0001"
  title           String?                     // "Ms.", "Mr.", "Dr."
  qualifications  String?
  hireDate        DateTime? @db.Date
}

model ParentProfile {
  userId      String  @id
  user        User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  occupation  String?
  address     String?
}

model ParentStudentLink {
  id            String               @id @default(cuid())
  parentId      String
  studentId     String
  relationship  GuardianRelationship
  isPrimary     Boolean              @default(false)   // primary contact for emails
  createdAt     DateTime             @default(now())
  @@unique([parentId, studentId])
  @@index([studentId])
}
```

Relations from `User` to each profile and to `ParentStudentLink` (as parent and as student) must be added.

### FR-2 User list (`/admin/users`)
1. `DataTable` columns: avatar + full name, email, role `Chip`, status `Chip` (Invited = warning, Active = success, Disabled = default, Archived = outlined), grade level (students), last sign-in, actions menu.
2. Filters: role (multi-select), status, grade level (shown when role filter includes Student), search by name, email, admission number or employee number. Archived users are hidden unless "Show archived" is checked.
3. Row actions: View, Edit, Resend invitation (status Invited), Unlock (when `lockedUntil > now`), Disable / Enable, Archive / Restore.
4. Bulk actions on selected rows: Resend invitations, Disable, Export CSV.

### FR-3 Create / edit user (`/admin/users/new`, `/admin/users/[id]/edit`)
1. The form is an MUI `Stepper`. Step 1 selects role. Step 2 shows common fields (first name, last name, email, phone) plus role-specific fields:
   - Student: admission number (auto-suggested as `S<year>-<4-digit sequence>`), date of birth, gender, grade level, enrollment date (defaults to today), address, emergency contact and phone, medical notes, and a "Parents/guardians" section to link existing parents or create new parent users inline.
   - Teacher: employee number (auto-suggested `T-<4-digit sequence>`), title, qualifications, hire date.
   - Parent: occupation, address, and a "Children" section to link existing students.
2. Checkbox "Send invitation email now" (default checked) calls `sendInvite`.
3. Email changes on an existing user require a confirmation dialog and invalidate pending invite tokens.
4. Role cannot be changed after creation (show read-only).
5. Validation: date of birth must make the student between 3 and 21 years old; phone must match E.164-ish pattern `^\+?[0-9 ()-]{7,20}$`.

### FR-4 User detail (`/admin/users/[id]`)
1. Shows profile data, status, last sign-in, linked family members (with links), and the 20 most recent audit entries where the user is actor or entity.

### FR-5 Status changes
1. Disable sets `status = DISABLED`; the user's sessions stop working within 5 minutes (extend the PRD-01 session check to also reject disabled/archived users).
2. Archive sets `archivedAt = now` and `status = DISABLED`; archived users are excluded from all pickers app-wide but their historical records remain visible.
3. An admin cannot disable or archive their own account, and the last active admin cannot be disabled (error "At least one active admin is required.").

### FR-6 Parent–student links
1. Managed from either the student or the parent form, and from a "Family" card on the student detail page.
2. A student can have at most 4 linked parents; exactly one link per student may be `isPrimary` (setting one clears the others).
3. `src/server/auth/student-access.ts` exports:
   - `getAccessibleStudentIds(user)` → ADMIN: `"ALL"`; STUDENT: `[user.id]`; PARENT: linked student ids; TEACHER: student ids in sections they homeroom or courses they teach (returns `[]` until PRD-05 adds those relations; PRD-05 must extend this function).
   - `assertCanViewStudent(user, studentId)` → throws `FORBIDDEN` (or `NOT_FOUND` for parents/students, to avoid revealing existence).

### FR-7 CSV import (`/admin/users/import`)
1. Download template button provides `students-template.csv` with columns: `first_name,last_name,email,admission_number,date_of_birth,gender,grade_level,enrollment_date,parent1_first_name,parent1_last_name,parent1_email,parent1_phone,parent1_relationship,parent2_first_name,parent2_last_name,parent2_email,parent2_phone,parent2_relationship`. A second template `teachers-template.csv` has `first_name,last_name,email,employee_number,title,phone`.
2. Upload (maximum 2 MB, maximum 2,000 rows) → parsed in the browser with `papaparse` → preview `DataGrid` showing each row as Valid, Warning (for example parent email already exists — will link to the existing parent) or Error (with reason per cell).
3. "Import N valid rows" sends the rows to `POST /api/users/import` in batches of 200. The server re-validates every row (never trusts the client), creates users and links in one transaction per batch, and returns per-row results.
4. Option "Send invitations after import" (default off). Grade levels are matched by `name` or `shortName`, case-insensitive. Dates accept `YYYY-MM-DD` only.
5. After import, show a summary (created students, created parents, linked existing parents, failed rows) and a "Download error report" CSV listing failed rows with reasons.
6. Re-importing the same file creates no duplicates: rows whose email already exists are reported as "Skipped — already exists".

### FR-8 Student detail page (`/students/[studentId]`)
1. Header: avatar, name, admission number, grade level, status. Tabs from `src/config/student-tabs.ts` filtered by role; this PRD registers the "Overview" tab (profile, family, emergency contact; medical notes only for ADMIN and TEACHER).
2. Access via `assertCanViewStudent`.

### FR-9 Parent "My children" (`/my-children`)
1. Visible to PARENT only. Lists linked children as cards (name, grade level, admission number) linking to `/students/[id]`. If none are linked: empty state "No children are linked to your account yet. Contact the school office."

### FR-10 Profile (`/account/profile`)
1. Any user sees their own profile (read-only name, email, role) and can edit phone and, for parents, occupation and address. Add "Profile" to the user menu.

### FR-11 Directory pickers
1. `GET /api/users/search?role=TEACHER&q=to` returns at most 20 `{ id, name, email, role }` matches for combobox pickers (ADMIN and TEACHER only), excluding archived users. Build a reusable `UserPicker` component on MUI `Autocomplete` (async options, `multiple` support, avatar + name + role in `renderOption`).

### FR-12 Audit log viewer (`/admin/audit-log`)
1. Table: time, actor (name), action, entity type, entity id (linked when it is a user), IP. Filters: actor, action prefix (for example `auth.`), date range. Clicking a row opens a right-anchored MUI `Drawer` with pretty-printed metadata JSON. Read-only; no edits or deletes.

### FR-13 Navigation
1. Administration group gains: Users, Import users, Audit log. Parents get "My children". All users get "Profile" in the user menu.

## API

| Method & path | Role | Notes |
|---|---|---|
| `GET /api/users` | ADMIN | Filters: `role`, `status`, `gradeLevelId`, `q`, `includeArchived`, pagination |
| `POST /api/users` | ADMIN | Body: common fields + `role` + `profile` object + `links[]` + `sendInvite` |
| `GET /api/users/:id` | ADMIN | Full user + profile + links |
| `PATCH /api/users/:id` | ADMIN | Common + profile fields |
| `POST /api/users/:id/invite` | ADMIN | Resend invite |
| `POST /api/users/:id/unlock` | ADMIN | |
| `POST /api/users/:id/status` | ADMIN | `{ status: "ACTIVE" \| "DISABLED" }` |
| `POST /api/users/:id/archive` · `/restore` | ADMIN | |
| `POST /api/users/import` | ADMIN | `{ type: "STUDENTS" \| "TEACHERS", rows: [...], sendInvites }` |
| `GET /api/users/export` | ADMIN | Same filters as list, returns `text/csv` |
| `GET /api/users/search` | ADMIN, TEACHER | Picker search |
| `POST /api/students/:id/parents` | ADMIN | `{ parentId, relationship, isPrimary }` |
| `DELETE /api/students/:id/parents/:parentId` | ADMIN | |
| `GET /api/students/:id` | per `assertCanViewStudent` | Medical notes stripped for STUDENT/PARENT |
| `GET /api/me/children` | PARENT | |
| `PATCH /api/me/profile` | any | Phone (+ parent fields) |
| `GET /api/audit-logs` | ADMIN | Filters + pagination |

## Non-Functional Requirements

1. **Privacy:** `medicalNotes` must never be returned to STUDENT or PARENT roles, enforced in the service layer. Exported CSVs exclude medical notes.
2. **Performance:** user list with 5,000 users must return a page in under 300 ms (index on `lastName`, `firstName`, `email`).
3. **Reliability:** an import batch either fully succeeds or fully rolls back; partial batches never persist.
4. **Security:** CSV export must neutralise formula injection (prefix cells starting with `=`, `+`, `-`, `@` with `'`).

## Acceptance Criteria

1. Given an admin creates a student with two new parents and "send invitation" checked, then three users exist with status `INVITED`, two `ParentStudentLink` rows exist, one marked primary, and three invite emails are logged.
2. Given a CSV of 10 rows where row 4 has an unknown grade level and row 7 reuses an existing parent email, when previewed, then row 4 is Error "Unknown grade level 'Grade 13'" and row 7 is Warning "Will link to existing parent"; importing creates 9 students and links row 7 to the existing parent.
3. Given the same CSV is imported twice, then the second import creates 0 users and reports 9 skipped.
4. Given a parent linked to Sam only, when they open `/students/<Sara's id>`, then they get a 404 page.
5. Given a teacher opens a student's Overview tab, then medical notes are visible; given the student's parent opens it, then medical notes are absent from the page and the API response.
6. Given an admin disables a teacher, when the teacher's next request occurs more than 5 minutes later, then they are signed out.
7. Given only one active admin, when that admin tries to disable themself, then the action is refused with the required-admin message.
8. Given an admin filters the audit log by action prefix `user.`, then only user-management entries show, newest first.

## Test Requirements

- Unit: CSV row validator, admission-number generator, formula-injection escaping, `getAccessibleStudentIds` per role.
- Integration: import batch rollback on a forced failure, last-admin guard, primary-link uniqueness.
- Playwright: create student with parent, CSV import happy path with one error row, parent My children → student page.

## Seed Data

- Profiles for all PRD-01 users: Sam Student (S2026-0001, Grade 7, DOB 2013-04-12), Sara Scholar (S2026-0002, Grade 7, DOB 2013-09-30), Tom Teacher (T-0001, Mr., Mathematics), Tina Tutor (T-0002, Ms., English), Pat Parent linked to Sam (MOTHER, primary) and Sara (GUARDIAN, primary).
- 24 additional students (12 in Grade 7, 12 in Grade 6) with generated names and one parent each, all `ACTIVE`, password `SchoolHub123!`.
- 4 additional teachers: Science, History, PE, Art.
