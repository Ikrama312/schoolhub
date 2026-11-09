# PRD-08: File Storage & Course Content (Modules and Lessons)

**Ticket:** SCH-008 · **Depends on:** PRD-00 – PRD-07 · **Run mode:** `--brownfield --tech-stack react`

## Summary

Add secure file storage (upload, access-checked download) used by every later feature, then build course content: teachers organise lessons into modules with Markdown text, embedded videos, links and file attachments; students work through lessons, mark them complete and see their progress per course. Replace the school-logo URL field from PRD-02 with an upload.

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

Teachers currently share handouts by email and USB stick. Students lose track of materials and parents cannot see what was taught. A structured place for lesson content, with progress tracking, is the core of the learning side of SchoolHub.

## Goals

1. A teacher can publish a lesson with text, a video and two PDFs in under 3 minutes.
2. Students always know what is next: each course shows module progress and a "Continue" button.
3. Files are only downloadable by users allowed to see the content they belong to.

## Out of Scope

- SCORM packages, interactive H5P content, live video classes.
- Cloud object storage (S3) — local disk only; the storage module has a single implementation.
- Copying content between courses (future work).

## User Stories

- As a teacher, I want to create modules and order lessons inside them so that content follows my teaching plan.
- As a teacher, I want to write lessons in Markdown with images, attach files and embed a YouTube or Vimeo video so that materials are rich.
- As a teacher, I want to schedule a lesson to publish at a future date so that I can prepare ahead.
- As a student, I want to read lessons, download materials and mark lessons complete so that I can track my progress.
- As a teacher, I want to see which students have completed each lesson so that I can follow up.
- As a parent, I want to see what my child's courses are covering so that I can support learning at home.

## Functional Requirements

### FR-1 File storage

```prisma
model FileObject {
  id            String   @id @default(cuid())
  ownerId       String                     // uploader
  owner         User     @relation(fields: [ownerId], references: [id])
  originalName  String                     // sanitised
  mimeType      String
  sizeBytes     Int
  storageKey    String   @unique           // "<yyyy>/<mm>/<cuid>.<ext>"
  sha256        String
  context       String                     // "lesson", "assignment", "submission", "message", "logo", "admission"…
  contextId     String?                    // id of the owning record once attached
  createdAt     DateTime @default(now())
  @@index([context, contextId])
}
```

1. `src/server/storage.ts`: `saveFile(stream, meta)`, `readFile(storageKey)`, `deleteFile(storageKey)`. Files are written to `UPLOAD_DIR` (new env var, default `./uploads`, git-ignored), never inside `public/`.
2. `POST /api/files` (multipart, any signed-in user) accepts one file plus `context`. Limits: 25 MB per file (`MAX_UPLOAD_MB` env, default 25); allowed types by extension **and** magic-number sniffing (`file-type` package): pdf, doc, docx, xls, xlsx, ppt, pptx, txt, csv, png, jpg, jpeg, gif, webp, mp3, mp4, zip. Rejections return `VALIDATION_ERROR` "File type .exe is not allowed." or "File exceeds 25 MB."
3. Filenames are sanitised (strip path separators and control characters, max 150 characters).
4. `GET /api/files/:id` streams the file with `Content-Disposition: attachment` (inline for images and PDFs when `?inline=1`), `X-Content-Type-Options: nosniff` and the stored MIME type. Access is decided by a resolver registry `src/server/files/access.ts`: `registerFileAccess(context, (user, file) => boolean | Promise<boolean>)`. This PRD registers `lesson` (can view the lesson), `logo` (public). Unknown context → only the owner and admins. Later PRDs register their contexts.
5. Unattached files (`contextId` null) older than 24 hours are deleted by `purgeOrphanFiles()`, called from the daily maintenance run started in PRD-04's dispatcher.
6. A reusable `FileUpload` component built from MUI (`Paper` drop zone with dashed border, `Button component="label"` with a visually hidden file input as shown in the MUI MCP "Button" file-upload demo, `LinearProgress` per file, `List` of files): drag-and-drop zone + button, multiple files, per-file progress bar (XHR upload progress), remove button, displays name, size and type icon. A `FileList` component shows attached files with download links.

### FR-2 Content data model

```prisma
enum ContentStatus { DRAFT SCHEDULED PUBLISHED }

model Module {
  id          String        @id @default(cuid())
  courseId    String
  course      Course        @relation(fields: [courseId], references: [id], onDelete: Cascade)
  title       String                       // max 120
  description String?
  order       Int
  status      ContentStatus @default(DRAFT)
  publishAt   DateTime?
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt
  lessons     Lesson[]
}

model Lesson {
  id              String        @id @default(cuid())
  moduleId        String
  module          Module        @relation(fields: [moduleId], references: [id], onDelete: Cascade)
  title           String                    // max 150
  contentMarkdown String        @default("") // max 100,000 chars
  videoUrl        String?                   // YouTube or Vimeo only
  estimatedMinutes Int?                     // 1–600
  order           Int
  status          ContentStatus @default(DRAFT)
  publishAt       DateTime?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  attachments     LessonAttachment[]
  links           LessonLink[]
  progress        LessonProgress[]
}

model LessonAttachment {
  id        String     @id @default(cuid())
  lessonId  String
  lesson    Lesson     @relation(fields: [lessonId], references: [id], onDelete: Cascade)
  fileId    String
  file      FileObject @relation(fields: [fileId], references: [id])
  order     Int
}

model LessonLink {
  id        String @id @default(cuid())
  lessonId  String
  lesson    Lesson @relation(fields: [lessonId], references: [id], onDelete: Cascade)
  title     String
  url       String                          // http(s) only
  order     Int
}

model LessonProgress {
  lessonId     String
  lesson       Lesson   @relation(fields: [lessonId], references: [id], onDelete: Cascade)
  studentId    String
  firstViewedAt DateTime @default(now())
  completedAt  DateTime?
  @@id([lessonId, studentId])
}
```

### FR-3 Visibility rules
1. A lesson is visible to students and parents when the lesson **and** its module are `PUBLISHED`, or `SCHEDULED` with `publishAt <= now` (evaluated at read time — no job needed).
2. Teachers and admins see everything, with a status badge (Draft grey, Scheduled blue with date, Published green).

### FR-4 Content tab (course page)
1. Register course tab "Content" (all roles that can view the course). Shows modules as collapsible MUI `Accordion` sections in order, each listing lessons with title, estimated minutes, attachment count and (for students) a completion check.
2. Students see a per-module progress bar ("3 of 5 complete") and a course-level progress bar plus a "Continue" button that opens the first incomplete visible lesson.
3. Teacher controls: "Add module", per-module menu (edit, publish now, schedule, unpublish, delete, move up/down), "Add lesson" in each module, drag handles to reorder lessons within and across modules (`@dnd-kit/sortable` for behaviour, MUI `Accordion`/`List` items for display, with up/down `IconButton`s as keyboard alternative).
4. Deleting a module with lessons requires typing the module title to confirm.

### FR-5 Lesson editor (`/courses/[courseId]/lessons/[lessonId]/edit`)
1. Fields: title, estimated minutes, video URL, and a Markdown editor built from MUI (`Tabs` Write/Preview, a multiline `TextField`, and a `ToggleButtonGroup`/`IconButton` toolbar) (bold, italic, headings, lists, link, code, quote, table, image) and a live preview tab. Images inserted via the toolbar upload through `POST /api/files` (context `lesson`) and insert `![alt](/api/files/<id>?inline=1)`.
2. Attachments section using `FileUpload` with reorder; links section (title + URL rows).
3. Status controls: Save draft, Publish now, Schedule (date-time picker in the school timezone; must be in the future).
4. Autosave the draft every 10 seconds while there are unsaved changes, with a "Saved 12:03" indicator; warn on navigation with unsaved changes.
5. Video URL validation: accept `youtube.com/watch?v=`, `youtu.be/`, `vimeo.com/<id>`; store as entered; render via privacy-enhanced embed (`youtube-nocookie.com/embed/<id>`, `player.vimeo.com/video/<id>`) in a 16:9 responsive iframe with `title` attribute.

### FR-6 Lesson viewer (`/courses/[courseId]/lessons/[lessonId]`)
1. Renders Markdown with `react-markdown` + `remark-gfm` + `rehype-sanitize` (default schema plus `img` from same origin only), mapping every element to MUI through the `components` prop (`Typography` variants for headings/paragraphs, `Link`, `Table*`, `Divider`, `List`/`ListItem`, `Box component="pre"` for code), in a shared `MarkdownView` component reused by later PRDs; external links open in a new tab with `rel="noopener noreferrer"`.
2. Shows video embed, attachment list, links, estimated time, and Previous / Next lesson navigation across modules.
3. Students: first view upserts `LessonProgress.firstViewedAt`; a "Mark as complete" button toggles `completedAt`.
4. Teachers: a "Progress" side panel listing enrolled students with Viewed / Completed status and dates.

### FR-7 Student and parent visibility
1. Register student tab "Learning" showing per-course content progress (course, lessons completed / visible, percentage, last activity).
2. Parents can open course content read-only (no "Mark as complete").

### FR-8 Notifications
1. Register `content.lesson_published` (ACADEMIC, default email false). When a lesson becomes visible through "Publish now", notify ACTIVE enrolled students.
2. Scheduled lessons do not send a notification when their `publishAt` passes (this avoids a background job). The schedule control shows the tooltip "Scheduled lessons appear automatically without a notification."

### FR-9 Logo upload
1. Replace the logo URL field on `/admin/settings/school` with `FileUpload` (single image, PNG/JPG/WebP/SVG, maximum 2 MB, context `logo`). SVG uploads are allowed for logos only and served with `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'` to neutralise scripts.

## API

| Method & path | Role | Notes |
|---|---|---|
| `POST /api/files` | any | Multipart `file`, `context` |
| `GET /api/files/:id` | access registry | `?inline=1` |
| `DELETE /api/files/:id` | owner, ADMIN | Only while unattached |
| `GET /api/courses/:id/modules` | `assertCanViewCourse` | Visibility filtered by role; includes lessons and the caller's progress |
| `POST /api/courses/:id/modules` | `assertCanManageCourse` | |
| `PATCH /api/modules/:id` · `DELETE /api/modules/:id` | manage | |
| `POST /api/courses/:id/content/reorder` | manage | `{ modules: [{ id, lessonIds: [] }] }` full ordering |
| `POST /api/modules/:id/lessons` | manage | |
| `GET /api/lessons/:id` | view (visibility rules) | |
| `PATCH /api/lessons/:id` · `DELETE /api/lessons/:id` | manage | Includes attachments and links arrays |
| `POST /api/lessons/:id/progress` | STUDENT (enrolled) | `{ completed: boolean }` |
| `GET /api/lessons/:id/progress` | manage | Per-student list |
| `GET /api/students/:id/learning` | `assertCanViewStudent` | |

## Non-Functional Requirements

1. **Security:** stored files are never served from a static path; every download is access-checked. Markdown output is sanitised; `javascript:` URLs are stripped. Upload endpoint is rate limited to 60 uploads per user per hour.
2. **Performance:** the Content tab for a course with 20 modules × 10 lessons renders in under 600 ms; uploads stream to disk without buffering whole files in memory.
3. **Accessibility:** embedded videos have titles; images require alt text in the editor (warning when missing).

## Acceptance Criteria

1. Given Tom creates module "Fractions" with lesson "Adding fractions" containing Markdown, a YouTube URL and a PDF, and publishes both, then Sam sees the lesson, the video plays in a privacy-enhanced embed and the PDF downloads.
2. Given a lesson scheduled for tomorrow 08:00, when Sam opens the course today, then the lesson is not listed; at 08:01 tomorrow it is listed.
3. Given Sam is not enrolled in ART-7B, when Sam requests a file attached to an ART-7B lesson, then the response is `404`/`403` and no bytes are streamed.
4. Given a user uploads `malware.pdf` that is actually a Windows executable, then the upload is rejected by magic-number sniffing.
5. Given Sam marks 3 of 5 visible lessons complete, then the module progress bar shows "3 of 5" and Continue opens lesson 4.
6. Given Markdown containing `<script>alert(1)</script>` and `[x](javascript:alert(1))`, when rendered, then no script executes and the link has no `javascript:` href.
7. Given Tom drags a lesson from module 1 to module 2, then the new order persists after reload.
8. Given Pat opens Sam's course content, then lessons are readable and no "Mark as complete" button is shown.

## Test Requirements

- Unit: filename sanitiser, video URL parser, visibility rule, file access registry dispatch.
- Integration: upload → attach → download with access checks; orphan purge.
- Playwright: teacher creates and publishes a lesson with an attachment; student completes it.

## Seed Data

- For MATH-7A: 3 modules ("Number Sense", "Fractions", "Geometry Basics"), each with 3 published lessons containing realistic Markdown, one with a YouTube video, one with a small seeded PDF from `prisma/seed-assets/`; one draft lesson and one scheduled lesson 7 days in the future.
- For ENG-7A: 2 modules with 2 lessons each.
- Sam has completed 4 MATH-7A lessons.
