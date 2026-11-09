# PRD-09: Assignments & Submissions

**Ticket:** SCH-009 · **Depends on:** PRD-00 – PRD-08 · **Run mode:** `--brownfield --tech-stack react`

## Summary

Teachers create assignments with instructions, attachments, due dates, points and late policies; students submit text and/or files (with resubmission before the deadline); teachers grade with points, rubric scores and written feedback, then return work to students. Includes a grading queue, per-student assignment lists, due-date reminders and parent visibility.

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

Homework is set daily across every subject. Teachers need one place to collect work, see who has not submitted, and return feedback. Students and parents need a reliable list of what is due and when. Late work policies vary by teacher and must be applied consistently.

## Goals

1. A teacher can create and publish an assignment in under 2 minutes.
2. Students see every upcoming deadline across all courses on one page.
3. Teachers can grade a class of 30 submissions with keyboard navigation without leaving the grading screen.

## Out of Scope

- Plagiarism detection, peer review, group assignments.
- Inline annotation of uploaded documents (feedback is text + rubric).
- Gradebook weighting and term grades (PRD-11 consumes these scores).

## User Stories

- As a teacher, I want to create an assignment with instructions, files, a due date and maximum points so that students know what to do.
- As a teacher, I want to choose whether late work is accepted and with what penalty so that my policy is applied automatically.
- As a teacher, I want an optional rubric so that grading is consistent and transparent.
- As a student, I want to submit text or files and resubmit before the deadline so that I can hand in my best work.
- As a teacher, I want to see submitted / missing / late counts and grade submissions one after another so that grading is fast.
- As a student, I want to see my grade and feedback once the teacher returns my work so that I can improve.
- As a parent, I want to see my child's upcoming and missing assignments so that I can help them stay on track.

## Functional Requirements

### FR-1 Data model

```prisma
enum SubmissionType { ONLINE_TEXT FILE_UPLOAD TEXT_AND_FILE NO_SUBMISSION }
enum AssignmentStatus { DRAFT SCHEDULED PUBLISHED }
enum SubmissionStatus { SUBMITTED RETURNED }

model Assignment {
  id                  String           @id @default(cuid())
  courseId            String
  course              Course           @relation(fields: [courseId], references: [id], onDelete: Cascade)
  title               String                          // max 150
  instructions        String           @default("")   // Markdown, max 50,000
  submissionType      SubmissionType   @default(TEXT_AND_FILE)
  maxPoints           Decimal          @db.Decimal(6, 2) // 0–1000
  dueAt               DateTime
  availableFrom       DateTime?                         // hidden before this when status SCHEDULED
  allowLate           Boolean          @default(true)
  lateCutoffAt        DateTime?                         // no submissions after this, must be > dueAt
  latePenaltyPercentPerDay Decimal?    @db.Decimal(5, 2) // 0–100, applied per started 24h late
  maxLatePenaltyPercent    Decimal?    @db.Decimal(5, 2) // cap, 0–100
  maxFileCount        Int              @default(5)      // 1–10
  status              AssignmentStatus @default(DRAFT)
  rubricId            String?          @unique
  createdById         String
  createdAt           DateTime         @default(now())
  updatedAt           DateTime         @updatedAt
  attachments         AssignmentAttachment[]
  submissions         Submission[]
  @@index([courseId, dueAt])
}

model AssignmentAttachment {
  id            String     @id @default(cuid())
  assignmentId  String
  assignment    Assignment @relation(fields: [assignmentId], references: [id], onDelete: Cascade)
  fileId        String
  file          FileObject @relation(fields: [fileId], references: [id])
}

model Rubric {
  id        String            @id @default(cuid())
  criteria  RubricCriterion[]
}

model RubricCriterion {
  id          String  @id @default(cuid())
  rubricId    String
  rubric      Rubric  @relation(fields: [rubricId], references: [id], onDelete: Cascade)
  title       String                       // "Clarity of argument"
  description String?
  maxPoints   Decimal @db.Decimal(6, 2)
  order       Int
  levels      Json                         // [{ label: "Excellent", points: 10, description }]
}

model Submission {
  id             String           @id @default(cuid())
  assignmentId   String
  assignment     Assignment       @relation(fields: [assignmentId], references: [id], onDelete: Cascade)
  studentId      String
  student        User             @relation(fields: [studentId], references: [id])
  text           String?                      // max 50,000
  attemptNumber  Int              @default(1)
  submittedAt    DateTime
  isLate         Boolean          @default(false)
  lateDays       Int              @default(0)
  status         SubmissionStatus @default(SUBMITTED)
  rawScore       Decimal?         @db.Decimal(6, 2)   // teacher-entered
  penaltyPercent Decimal?         @db.Decimal(5, 2)   // computed at grading time, overridable
  finalScore     Decimal?         @db.Decimal(6, 2)   // rawScore × (1 − penalty/100), 2 dp
  feedback       String?                      // Markdown, max 10,000
  rubricScores   Json?                        // [{ criterionId, points, comment }]
  gradedById     String?
  gradedAt       DateTime?
  returnedAt     DateTime?
  files          SubmissionFile[]
  createdAt      DateTime         @default(now())
  updatedAt      DateTime         @updatedAt
  @@unique([assignmentId, studentId])          // one current submission; history below
}

model SubmissionFile {
  id            String     @id @default(cuid())
  submissionId  String
  submission    Submission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
  fileId        String
  file          FileObject @relation(fields: [fileId], references: [id])
}

model SubmissionHistory {
  id            String   @id @default(cuid())
  submissionId  String
  attemptNumber Int
  text          String?
  fileIds       String[]
  submittedAt   DateTime
}

model GradeExemption {
  assignmentId String
  studentId    String
  reason       String?
  createdAt    DateTime @default(now())
  @@id([assignmentId, studentId])
}
```

Teachers may also record a grade for a student who did not submit (for example offline or `NO_SUBMISSION` work): the service creates a `Submission` with `text = null`, no files and `submittedAt = gradedAt`, flagged by `attemptNumber = 0`.

### FR-2 Create / edit assignment (`/courses/[courseId]/assignments/new`)
1. Fields: title, instructions (Markdown editor from PRD-08), attachments (`FileUpload`, context `assignment`), submission type, max points, due date-time (school timezone; default next teaching day 23:59), available from (optional), late policy (allow late toggle → cutoff, penalty per day, maximum penalty), maximum file count, optional rubric builder.
2. Rubric builder: add criteria (title, description, levels with label + points + description); sum of criterion maximums must equal max points, otherwise inline error "Rubric totals 18 points but the assignment is worth 20."
3. "Save draft", "Publish" and "Schedule" (requires available-from in the future; becomes visible then).
4. Editing a published assignment's due date or points after submissions exist shows a warning; changing max points recalculates nothing automatically — existing scores are kept and a banner prompts the teacher to review grades.
5. "Duplicate to other courses" action: copies the assignment (as DRAFT) to selected courses the teacher manages, with the same relative due date.

### FR-3 Course assignments tab
1. Register course tab "Assignments". Teacher view: table of assignments with title, due date, status, submitted/total, graded/submitted, and "Grade" button. Student view: list grouped as Upcoming, Past due (missing), Submitted, Returned. Parent view: same as student, read-only.

### FR-4 Student submission (`/courses/[courseId]/assignments/[assignmentId]`)
1. Shows instructions, attachments, due date with countdown when under 48 hours ("Due in 5 h 12 min"), late policy summary, rubric (if any), and the submission panel.
2. Text editor (Markdown) and/or file upload depending on submission type, respecting `maxFileCount`. Draft text autosaves to `localStorage` only.
3. Submit → confirmation dialog. Server rules: assignment visible; student ACTIVE enrolled; not exempt; if `now > dueAt` then `allowLate` must be true and `now <= lateCutoffAt` (when set); otherwise `VALIDATION_ERROR` "The deadline has passed and late submissions are closed."
4. `isLate = submittedAt > dueAt`; `lateDays = ceil((submittedAt − dueAt) / 24h)`.
5. Resubmission: allowed until the due date (or cutoff when late is allowed) and only while `status = SUBMITTED` (not after return). The previous attempt is copied into `SubmissionHistory`, `attemptNumber` increments, and existing grading fields are cleared.
6. After submission the student sees a receipt: "Submitted Mon 14 Sep 2026, 21:04 (attempt 2)" plus the files and text submitted.
7. After return the student sees final score, rubric breakdown, feedback and late penalty applied.

### FR-5 Grading (`/courses/[courseId]/assignments/[assignmentId]/grade`)
1. Left panel: MUI `List` of students with status `Chip`s (Not submitted, Submitted, Late, Graded, Returned, Exempt), filter by status, sort by name or submission time.
2. Main panel: the selected student's submission (text rendered as sanitised Markdown; files listed with inline preview for images and PDFs via `<iframe>`/`<img>` to `/api/files/:id?inline=1`); previous attempts accessible in a dropdown.
3. Grading form: rubric (an exclusive `ToggleButtonGroup` per criterion — click a level → points auto-sum into raw score) or raw score input; late penalty shown pre-filled from the policy `min(lateDays × perDay, maxPenalty)` and overridable; computed final score shown live; feedback editor.
4. Buttons: "Save" (graded, not yet visible to student), "Save & return" (returns this one), and bulk "Return all graded". Keyboard: `J`/`K` next/previous student, `Ctrl+Enter` save and next.
5. "Grade without submission" for students who did not submit, and "Exempt" toggle (removes the student from missing counts and from future gradebook calculation).
6. Scores must be between 0 and max points (extra credit up to 120 % of max points allowed only when a "Allow extra credit" checkbox on the assignment is ticked — add `allowExtraCredit Boolean @default(false)` to `Assignment`).

### FR-6 Student "My assignments" (`/assignments`)
1. For STUDENT: all assignments across ACTIVE enrollments, tabs Upcoming (sorted by due date), Missing (past due, not submitted, not exempt), Submitted, Returned. Filters by course. PARENT: child selector, same content read-only. TEACHER: "To grade" list of submitted-but-ungraded submissions across their courses, oldest first.
2. Register student tab "Assignments" with the same data for teachers/admins viewing a student.

### FR-7 Notifications
Register and send:
1. `assignment.published` → enrolled students (in-app, email default false) when published or when scheduled becomes visible on first student list load (send once; track `notifiedAt DateTime?` on `Assignment`).
2. `assignment.due_soon` → students without a submission, 24 hours before `dueAt`, sent by the daily/minutely maintenance run from PRD-04 (`sendDueReminders()` runs on every dispatcher call, idempotent via a `AssignmentReminder` table `{ assignmentId, studentId, kind }` with a unique key).
3. `assignment.returned` → student + parents (`notifyStudentAndParents`) when work is returned. Body includes the score, for example "Mathematics: Fractions worksheet — 18/20".
4. `assignment.missing` → parents only, once, 24 hours after `dueAt` if still missing (default email true).

### FR-8 File access
1. Register file access contexts: `assignment` (anyone who can view the assignment) and `submission` (the submitting student, their parents, course managers, admins).

## API

| Method & path | Role | Notes |
|---|---|---|
| `GET /api/courses/:id/assignments` | view course | Role-shaped list |
| `POST /api/courses/:id/assignments` | manage | |
| `GET /api/assignments/:id` | view | Student/parent: includes own submission |
| `PATCH /api/assignments/:id` · `DELETE /api/assignments/:id` | manage | Delete only when no submissions; otherwise archive (add `archivedAt`) |
| `POST /api/assignments/:id/duplicate` | manage | `{ courseIds }` |
| `POST /api/assignments/:id/submissions` | STUDENT | `{ text?, fileIds[] }` |
| `GET /api/assignments/:id/submissions` | manage | All students incl. not submitted |
| `GET /api/submissions/:id` | student, parents, manage | History included for manage |
| `PUT /api/submissions/:id/grade` | manage | `{ rawScore, penaltyPercent, feedback, rubricScores }` |
| `POST /api/assignments/:id/grade-offline` | manage | `{ studentId, rawScore, feedback }` |
| `POST /api/assignments/:id/return` | manage | `{ submissionIds? }` (all graded when omitted) |
| `PUT /api/assignments/:id/exemptions/:studentId` · `DELETE` | manage | |
| `GET /api/me/assignments?studentId=&tab=` | any | |
| `GET /api/students/:id/assignments` | view student | |

## Non-Functional Requirements

1. **Correctness:** score arithmetic uses `Decimal` end to end (Prisma Decimal / `decimal.js`), never floating point; final scores round half-up to 2 decimal places.
2. **Integrity:** submission and deadline checks use server time only; the client clock is never trusted.
3. **Performance:** the grading screen switches between students in under 300 ms (prefetch next and previous).
4. **Privacy:** students never see other students' submissions or scores.

## Acceptance Criteria

1. Given an assignment due Monday 23:59 with 10 % per day penalty capped at 30 %, when Sam submits Wednesday 10:00, then `isLate = true`, `lateDays = 2`, and the grading form pre-fills a 20 % penalty; a raw score of 18/20 yields a final score of 14.40.
2. Given late submissions are not allowed, when Sam submits after the due time, then the request fails with the deadline message.
3. Given Sam submitted attempt 1, when Sam resubmits before the due date, then attempt 1 is in history and the current submission shows attempt 2.
4. Given Tom returned Sam's work, when Sam tries to resubmit, then the request is refused.
5. Given a rubric whose criteria total 18 for a 20-point assignment, when Tom saves, then the totals error appears.
6. Given Tom clicks rubric levels worth 8 + 9, then the raw score field shows 17.
7. Given Tom saves a grade without returning, then Sam sees "Submitted — awaiting grading" and no score.
8. Given an assignment due in 24 hours and Sara has not submitted, when the maintenance run executes twice, then Sara receives exactly one `assignment.due_soon` notification.
9. Given Sara is still missing 24 hours after the due date, then her parent receives `assignment.missing` once.
10. Given Sam requests another student's submission file URL, then access is denied.

## Test Requirements

- Unit: late days calculation (exact 24 h boundary, DST change in school timezone), penalty cap, final score rounding, rubric sum validation.
- Integration: resubmission history, return flow, reminder idempotency, exemption effect on missing list.
- Playwright: teacher creates assignment → student submits file → teacher grades with rubric and returns → student sees feedback; parent sees missing list.

## Seed Data

- MATH-7A: 4 assignments — one returned (all students graded, scores 55–100 %), one submitted awaiting grading (60 % submitted, 2 late), one due in 2 days, one draft. ENG-7A: 2 assignments (one with a 3-criterion rubric, returned). SCI-7A: 1 assignment with `NO_SUBMISSION` type graded offline.
