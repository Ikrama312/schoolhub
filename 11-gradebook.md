# PRD-11: Gradebook, Grading Scales & Report Cards

**Ticket:** SCH-011 · **Depends on:** PRD-00 – PRD-10 · **Run mode:** `--brownfield --tech-stack react`

## Summary

A unified gradebook per course that pulls in assignment and quiz scores automatically, supports manual grade items (for example an in-class presentation), weighted categories, term grades with a school-wide letter grading scale, teacher overrides and comments. At term end, admins generate report cards that combine every course grade with attendance and comments, review them, publish them to students and parents, and print them.

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

Teachers currently keep grades in personal spreadsheets with differing formulas, and the office retypes everything into report cards each term. One gradebook with consistent calculation removes the retyping and lets families see standing during the term rather than only at the end.

## Goals

1. Every graded assignment and quiz appears in the gradebook without manual entry.
2. Term grades are computed identically across the school from category weights and the grading scale.
3. The office generates, reviews and publishes report cards for the whole school in under one hour.

## Out of Scope

- Standards-based grading (mastery per standard).
- GPA and class rank (future work).
- Transcript across multiple years.

## User Stories

- As an admin, I want to define the school's grading scale so that letter grades are consistent.
- As a teacher, I want weighted categories (for example Homework 30 %, Quizzes 30 %, Exams 40 %) so that grades reflect my syllabus.
- As a teacher, I want a spreadsheet-like gradebook with every student and item so that I can see and edit scores quickly.
- As a teacher, I want to add manual grade items for offline work so that all assessment is in one place.
- As a student or parent, I want to see current course grades and individual scores so that we know where the student stands.
- As an admin, I want to generate, review, publish and print report cards each term so that families receive official results.

## Functional Requirements

### FR-1 Data model

```prisma
enum GradeItemSource { ASSIGNMENT QUIZ MANUAL }
enum ReportCardStatus { DRAFT PUBLISHED }

model GradingScale {
  id        String   @id @default(cuid())
  name      String                     // "Standard A–F"
  isDefault Boolean  @default(false)
  bands     Json                       // [{ letter: "A", minPercent: 90, gpa?: 4.0, descriptor: "Excellent" }], sorted desc
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model GradeCategory {
  id            String   @id @default(cuid())
  courseId      String
  course        Course   @relation(fields: [courseId], references: [id], onDelete: Cascade)
  name          String                     // "Homework"
  weightPercent Decimal  @db.Decimal(5, 2) // 0–100; a course's categories total 100
  dropLowest    Int      @default(0)       // drop N lowest scores in this category per student
  order         Int
}

model GradeItem {
  id          String          @id @default(cuid())
  courseId    String
  course      Course          @relation(fields: [courseId], references: [id], onDelete: Cascade)
  categoryId  String?
  category    GradeCategory?  @relation(fields: [categoryId], references: [id], onDelete: SetNull)
  termId      String
  term        Term            @relation(fields: [termId], references: [id])
  title       String
  maxPoints   Decimal         @db.Decimal(6, 2)
  dueAt       DateTime?
  source      GradeItemSource
  sourceId    String?         @unique       // assignmentId or quizId
  isVisible   Boolean         @default(true) // hidden items do not show to students/parents and do not count
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt
  grades      Grade[]
}

model Grade {
  gradeItemId String
  gradeItem   GradeItem @relation(fields: [gradeItemId], references: [id], onDelete: Cascade)
  studentId   String
  score       Decimal?  @db.Decimal(6, 2)  // null = not graded yet
  excused     Boolean   @default(false)    // excluded from calculation
  missing     Boolean   @default(false)    // counts as 0 when the item is past due
  comment     String?
  updatedById String
  updatedAt   DateTime  @updatedAt
  @@id([gradeItemId, studentId])
  @@index([studentId])
}

model TermGradeOverride {
  courseId        String
  termId          String
  studentId       String
  percent         Decimal? @db.Decimal(5, 2)
  letter          String?
  teacherComment  String?                  // max 1,000, appears on the report card
  updatedById     String
  updatedAt       DateTime @updatedAt
  @@id([courseId, termId, studentId])
}

model ReportCard {
  id               String           @id @default(cuid())
  studentId        String
  termId           String
  status           ReportCardStatus @default(DRAFT)
  snapshot         Json                     // frozen data: courses, grades, attendance, comments
  homeroomComment  String?
  principalComment String?
  generatedAt      DateTime         @default(now())
  publishedAt      DateTime?
  publishedById    String?
  @@unique([studentId, termId])
}
```

Also add `gradingScaleId String?` to `Course` (null = school default) and `categoryId String?` to `Assignment` and `Quiz` with a category select added to their editors.

### FR-2 Sync from assignments and quizzes (`src/server/gradebook/gradebook-sync.ts`)
1. When an assignment or non-practice quiz is published, upsert a `GradeItem` (title, maxPoints, dueAt, category, term = term containing `dueAt` / `availableUntil`, falling back to the current term). Unpublishing or archiving sets `isVisible = false`; deleting deletes the item.
2. When a submission is returned, upsert its `Grade` with `score = finalScore`. Saving without returning does not sync (students must not see unreturned scores). Exemptions set `excused = true`.
3. When a quiz attempt reaches GRADED and results are visible, upsert `Grade.score` from `getStudentQuizScore` scaled to the quiz maxScore.
4. A one-time backfill `npm run gradebook:backfill` creates items and grades for data that existed before this PRD; it is idempotent and runs in the seed.
5. Grades written by sync are read-only in the gradebook UI (edit happens at the source) except `comment`; manual items are fully editable.

### FR-3 Calculation (`src/server/gradebook/grade-calc.ts`, pure functions)
For a student, course and term:
1. Consider visible items in the term whose student grade is not `excused`. An item counts when it has a score, or when it is past due and `missing` (counts as 0). Ungraded, not-missing items are ignored.
2. Per category: drop the `dropLowest` lowest percentages (never dropping all), then `categoryPercent = Σ score / Σ maxPoints × 100`.
3. Course percent = weighted mean of category percentages over categories that have at least one counted item, re-normalising weights to the categories present. Items without a category form an implicit "Uncategorised" category; if the course has no categories, course percent = total points earned / total possible × 100.
4. Letter = first band where `percent >= minPercent` in the effective scale. Round percent half-up to 1 decimal place before letter lookup.
5. `TermGradeOverride` percent/letter replace the computed values when set (letter-only overrides keep the computed percent).
6. Example: Homework 40 % (scores 18/20, 9/10) and Exams 60 % (scores 70/100): Homework = 27/30 = 90.0 %, Exams = 70.0 %, course = 0.4 × 90 + 0.6 × 70 = 78.0 % → "C+" in the seed scale.

### FR-4 Grading scales (`/admin/grading-scales`)
1. CRUD for scales; band editor with letter, minimum %, optional GPA points and descriptor. Validation: bands strictly descending, lowest band minimum is 0, letters unique. Exactly one default.

### FR-5 Category setup (course "Gradebook" settings)
1. Teacher manages categories: name, weight, drop lowest, order. Weights must total 100 (live sum indicator) before saving. Course grading scale select (defaults to school default).

### FR-6 Gradebook grid (course tab "Gradebook", TEACHER/ADMIN)
1. Term selector. Grid built on MUI X `DataGrid` (MIT: column groups via `columnGroupingModel`, cell editing via `processRowUpdate`; pinned columns are not in the MIT version, so keep the student column first and use the grid's sticky header): first column students (sorted by last name), then items grouped by category (column header shows title, due date, max points, source icon), then category averages and the term percent + letter (bold). Horizontally scrollable; the DataGrid's built-in virtualisation handles up to 60 students × 120 items.
2. Cell content: score, "EX" (excused), "M" (missing, red), "—" (ungraded). Late submissions show a small clock icon.
3. Manual items: editable DataGrid cells — type a number, `Enter` / arrow keys move between cells, `E` excuse, `M` missing, `Delete` clears. Changes save on blur with optimistic update and per-cell error state.
4. Synced cells: clicking opens the source (submission grading page or quiz attempt).
5. "Add manual item" dialog: title, category, max points, date, term.
6. Student row action: "Override term grade / comment" dialog (percent, letter, comment).
7. Column menu: hide/show item to students, set all ungraded to missing (after due date), view item statistics (average, median, high, low).
8. "Export CSV" exports the grid as displayed.

### FR-7 Student and parent grade views
1. Register student tab "Grades": for the selected term, one card per course with percent, letter and a colour (≥ 80 green, 60–79 amber, < 60 red); expanding shows each visible item (title, category, score/max, percent, comment, missing/excused flags) and category subtotals.
2. `/grades` page for STUDENT and PARENT (child selector) showing the same.
3. Course tab "Grades" for STUDENT/PARENT shows that course's items only.

### FR-8 Report cards (`/admin/report-cards`)
1. Select term → table of students (filter by grade level and section) with report card status (Not generated, Draft, Published) and missing-data warnings (for example "2 courses have ungraded items", "No teacher comment for ENG-7A").
2. "Generate drafts" for the filtered students builds each `snapshot`: school name/logo, student name, admission number, grade level, section, homeroom teacher, term and year; per course: subject, teacher, percent, letter, descriptor, teacher comment (from overrides); attendance summary for the term (rate, absences, lates); grading scale legend. Regenerating a draft refreshes the snapshot; published cards are never changed by regeneration.
3. Review page per card: rendered report card preview with editable homeroom comment (homeroom teacher or admin) and principal comment (admin). Homeroom teachers also get `/report-cards` listing their section's drafts to write comments.
4. "Publish" (per card or bulk for filtered list) sets status PUBLISHED and sends `report_card.published` to student and parents (default email true). "Unpublish" (admin only, requires reason, audited).
5. Print view `/report-cards/[id]/print`: A4 portrait, school letterhead, tables, signature lines for principal and homeroom teacher; uses `@media print`; "Print / Save as PDF" button calls `window.print()`. Bulk "Print all" renders filtered published cards with page breaks.
6. Register student tab "Report cards": list of published cards (students/parents) or all (admin/teacher), each opening the print view.

### FR-9 Notifications
1. `grade.posted` → student + parents when a manual item grade is entered (default email false; batched: one notification per student per item).
2. `report_card.published` as above.

## API

| Method & path | Role | Notes |
|---|---|---|
| `GET/POST /api/grading-scales`, `PATCH/DELETE /api/grading-scales/:id` | GET any, write ADMIN | |
| `GET/PUT /api/courses/:id/grade-categories` | GET view, PUT manage | PUT replaces full list, validates total 100 |
| `GET /api/courses/:id/gradebook?termId=` | manage | Items, students, grades, computed results |
| `POST /api/courses/:id/grade-items` | manage | Manual items |
| `PATCH /api/grade-items/:id` · `DELETE` | manage | Manual only for most fields; `isVisible` for all |
| `PUT /api/grade-items/:id/grades/:studentId` | manage | `{ score?, excused?, missing?, comment? }` |
| `PUT /api/courses/:id/term-overrides/:studentId` | manage | `{ termId, percent?, letter?, teacherComment? }` |
| `GET /api/students/:id/grades?termId=` | view student | Only visible items |
| `GET /api/report-cards?termId=&gradeLevelId=&sectionId=` | ADMIN, homeroom TEACHER | |
| `POST /api/report-cards/generate` | ADMIN | `{ termId, studentIds }` |
| `GET /api/report-cards/:id` | ADMIN, teachers of student, student/parents when published | |
| `PATCH /api/report-cards/:id` | ADMIN, homeroom teacher (homeroom comment only) | |
| `POST /api/report-cards/publish` · `/unpublish` | ADMIN | `{ ids, reason? }` |

## Non-Functional Requirements

1. **Correctness:** calculation lives in pure functions with exhaustive unit tests; all arithmetic in `Decimal`.
2. **Performance:** gradebook for 35 students × 80 items loads in under 800 ms; computing term grades for 600 students × 8 courses for report card generation finishes in under 30 seconds.
3. **Auditability:** every manual grade change and override writes an audit entry with old and new values.
4. **Privacy:** hidden items and unreturned scores never appear in student or parent responses.

## Acceptance Criteria

1. Given the FR-3.6 example, then the gradebook and the student Grades tab both show 78.0 % C+.
2. Given Homework has `dropLowest = 1` and scores 50 %, 90 %, 100 %, then the Homework category percent excludes the 50 %.
3. Given a returned assignment, then its score appears in the gradebook without manual entry; given a graded-but-not-returned submission, then it does not appear to the student.
4. Given category weights totalling 90, when the teacher saves, then the save is refused with the live sum showing 90 / 100.
5. Given an item past due marked missing, then it counts as 0; given it is excused, then it does not count.
6. Given a letter-only override of "B" for Sam, then Sam's card shows the computed percent and letter B.
7. Given an admin generates drafts for 7A and publishes them, then Sam and Pat receive a `report_card.published` notification and can open the print view; a student in 7B cannot open Sam's card.
8. Given a published report card, when a teacher changes a grade, then the published card's snapshot does not change.
9. Given the print view, when printed, then each student's card fits on A4 pages without the app sidebar.

## Test Requirements

- Unit: full calculation matrix (no categories, empty categories, drop lowest, missing vs ungraded, overrides, rounding at band edges like 89.95 → 90.0 → A).
- Integration: sync hooks from assignment return and quiz grading; backfill idempotency; snapshot immutability.
- Playwright: teacher edits manual grades with keyboard; admin generates and publishes report cards; parent views a report card.

## Seed Data

- Default scale "Standard A–F": A 93, A− 90, B+ 87, B 83, B− 80, C+ 77, C 73, C− 70, D+ 67, D 63, D− 60, F 0, with descriptors.
- Categories for all 7A courses: Homework 30 %, Quizzes 30 %, Exams 40 % (drop lowest 1 homework).
- One manual item "Oral presentation" in ENG-7A, graded for all students.
- Draft report cards for 7A for Semester 1, with teacher comments for MATH and ENG.
