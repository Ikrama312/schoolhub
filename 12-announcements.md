# PRD-12: Announcements & News

**Ticket:** SCH-012 · **Depends on:** PRD-00 – PRD-11 · **Run mode:** `--brownfield --tech-stack react`

## Summary

Admins and teachers publish announcements to targeted audiences (whole school, staff, a role, a grade level, a section or a course), with rich text, attachments, pinning, scheduling, expiry, read tracking and optional acknowledgement ("I have read this"). Announcements flagged public also feed the news section of the public website (PRD-18).

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

School-wide news currently goes out as paper letters that do not reach parents, and class news is posted on separate tools per teacher. A single announcement feed with precise targeting replaces both, and read receipts tell the office who has not seen important notices.

## Goals

1. An admin can send a notice to all Grade 7 parents in under 1 minute.
2. Every user sees the announcements meant for them — and only those — in one feed.
3. For notices requiring acknowledgement, the office can see who has not acknowledged and remind them.

## Out of Scope

- Comments or reactions on announcements.
- Translation into other languages.
- SMS broadcast.

## User Stories

- As an admin, I want to post an announcement to a chosen audience so that the right people are informed.
- As a teacher, I want to post announcements to my courses so that my students and their parents know about class news.
- As an admin, I want to schedule an announcement and set an expiry so that it appears and disappears at the right time.
- As an admin, I want to require acknowledgement for important notices and see who acknowledged so that I can follow up.
- As a parent, I want one feed of everything relevant to my children so that I don't miss anything.

## Functional Requirements

### FR-1 Data model

```prisma
enum AnnouncementStatus { DRAFT SCHEDULED PUBLISHED ARCHIVED }
enum AudienceType { SCHOOL STAFF ROLE GRADE_LEVEL SECTION COURSE }

model Announcement {
  id                 String             @id @default(cuid())
  title              String                         // max 150
  body               String                         // Markdown, max 20,000
  authorId           String
  author             User               @relation(fields: [authorId], references: [id])
  status             AnnouncementStatus @default(DRAFT)
  publishAt          DateTime?
  expiresAt          DateTime?                      // hidden from feeds after this
  pinned             Boolean            @default(false)
  requiresAck        Boolean            @default(false)
  isPublic           Boolean            @default(false) // shown on public website news (ADMIN only)
  coverFileId        String?                         // optional cover image
  notifiedAt         DateTime?
  createdAt          DateTime           @default(now())
  updatedAt          DateTime           @updatedAt
  audiences          AnnouncementAudience[]
  attachments        AnnouncementAttachment[]
  reads              AnnouncementRead[]
}

model AnnouncementAudience {
  id              String       @id @default(cuid())
  announcementId  String
  announcement    Announcement @relation(fields: [announcementId], references: [id], onDelete: Cascade)
  type            AudienceType
  refId           String?                          // gradeLevelId / sectionId / courseId; role name for ROLE
  includeStudents Boolean      @default(true)      // for GRADE_LEVEL / SECTION / COURSE
  includeParents  Boolean      @default(true)
  includeTeachers Boolean      @default(true)
}

model AnnouncementAttachment {
  id              String       @id @default(cuid())
  announcementId  String
  announcement    Announcement @relation(fields: [announcementId], references: [id], onDelete: Cascade)
  fileId          String
  file            FileObject   @relation(fields: [fileId], references: [id])
}

model AnnouncementRead {
  announcementId  String
  announcement    Announcement @relation(fields: [announcementId], references: [id], onDelete: Cascade)
  userId          String
  readAt          DateTime     @default(now())
  acknowledgedAt  DateTime?
  @@id([announcementId, userId])
}
```

### FR-2 Audience resolution (`src/server/announcements/audience.ts`)
1. `resolveAudienceUserIds(audiences)` returns the deduplicated set of ACTIVE, non-archived user ids:
   - `SCHOOL`: everyone. `STAFF`: ADMIN + TEACHER. `ROLE`: users with role `refId`.
   - `GRADE_LEVEL`: students whose profile grade level is `refId` (if `includeStudents`), their linked parents (if `includeParents`), teachers of current-year courses in sections of that grade level (if `includeTeachers`).
   - `SECTION`: section members, their parents, homeroom teacher and teachers of the section's courses (same flags).
   - `COURSE`: ACTIVE enrolled students, their parents, teacher and co-teachers (same flags).
2. `isUserInAudience(user, audiences)` answers the same question for one user without loading everyone (used by feeds).
3. This service is generic and is reused by PRD-14 (calendar events).

### FR-3 Permissions
1. ADMIN may target any audience and set `isPublic`.
2. TEACHER may target only COURSE audiences for courses they manage and SECTION audiences for the section they homeroom. `isPublic` is not available.
3. STUDENT and PARENT cannot create announcements.
4. Authors may edit their own announcements; admins may edit or archive any.

### FR-4 Composer (`/announcements/new`, `/announcements/[id]/edit`)
1. Fields: title, body (Markdown editor from PRD-08), cover image (optional), attachments, audience builder (add one or more audience rows: type → entity picker → include students / parents / teachers checkboxes), pinned, requires acknowledgement, public (admins), publish now / schedule (`publishAt`) / save draft, expiry date.
2. Live recipient count beside the audience builder ("Will reach 412 people: 180 students, 214 parents, 18 teachers"), computed by `POST /api/announcements/preview-audience`.
3. Publishing a body with zero recipients is refused.

### FR-5 Feed (`/announcements`)
1. All roles: list of published, non-expired announcements whose audience includes the user (scheduled ones appear once `publishAt <= now`, evaluated at read time). Pinned first (maximum 3 pinned shown at top), then newest. Unread items show a dot; filter tabs All / Unread / Requires acknowledgement.
2. Card: cover image thumbnail, title, author and role, date, audience chips (for example "Grade 7 · Parents"), excerpt (200 chars), attachment count.
3. Detail (`/announcements/[id]`): full body, attachments, "I acknowledge" button when required (stores `acknowledgedAt`; button becomes "Acknowledged on 14 Sep"). Opening records `readAt`.
4. Course tab "Announcements" shows announcements whose audience includes that course.
5. Parent feed labels which child each item relates to when audience is grade/section/course-scoped ("For Sam").

### FR-6 Author tools
1. "Manage" view (`/announcements/manage`): authored (teachers) or all (admins) announcements with status, audience summary, reach, read %, acknowledged % (when required).
2. Per-announcement stats page: counts and a recipient table (name, role, read at, acknowledged at) with filters Unread / Not acknowledged, CSV export, and "Send reminder" which notifies only those who have not acknowledged (type `announcement.reminder`, maximum one reminder per 24 hours).

### FR-7 Notifications
1. `announcement.published` (COMMUNICATION, default email true; `mandatoryInApp` true when `requiresAck`). Sent once when the announcement first becomes visible: immediately on publish-now; for scheduled ones by the maintenance run (`publishDueAnnouncements()` sets `notifiedAt`).
2. Email uses the `generic-notification` template with title, the first 300 characters of body as plain text and a "Read announcement" button.

### FR-8 File access & public flag
1. Register file access `announcement`: users in the audience, the author, admins; plus everyone (public) when the announcement `isPublic` and published.
2. `getPublicNews({ page })` returns public, published, non-expired announcements for PRD-18.

### FR-9 Navigation
1. "Announcements" for all roles (with unread count badge in the sidebar). TEACHER and ADMIN: "New announcement" button on the feed.

## API

| Method & path | Role | Notes |
|---|---|---|
| `GET /api/announcements?tab=&courseId=&page=` | any | Feed for current user |
| `GET /api/announcements/unread-count` | any | |
| `GET /api/announcements/:id` | in audience, author, ADMIN | Marks read |
| `POST /api/announcements` | ADMIN, TEACHER | Audience permission checks |
| `PATCH /api/announcements/:id` | author, ADMIN | Audience edits after publish do not re-notify |
| `POST /api/announcements/:id/archive` | author, ADMIN | |
| `POST /api/announcements/:id/ack` | in audience | |
| `POST /api/announcements/preview-audience` | ADMIN, TEACHER | `{ audiences }` → counts by role |
| `GET /api/announcements/manage` | ADMIN, TEACHER | |
| `GET /api/announcements/:id/stats` | author, ADMIN | `?format=csv` |
| `POST /api/announcements/:id/remind` | author, ADMIN | 24h throttle |
| `GET /api/public/news` | public | Add to `public-routes.ts` |

## Non-Functional Requirements

1. **Performance:** the feed query for a parent with 3 children returns in under 200 ms with 2,000 announcements in the table (resolve membership via SQL joins on audience rows, not by loading all recipients).
2. **Security:** a teacher crafting a request with a SCHOOL audience receives `403`. Markdown is sanitised as in PRD-08.
3. **Accessibility:** unread dots have screen-reader text "Unread".

## Acceptance Criteria

1. Given an admin targets GRADE_LEVEL Grade 7 with parents only, then the preview shows only Grade 7 parents and after publishing only they see it in their feed.
2. Given Tom targets COURSE MATH-7A, then MATH-7A students, their parents and Tom see it; a 7B student does not.
3. Given Tom tries to target SCHOOL via the API, then `403`.
4. Given an announcement scheduled for 07:00 tomorrow, then it is invisible until 07:00 and the notification is sent once by the next maintenance run after 07:00.
5. Given `requiresAck` and 50 recipients of whom 30 acknowledged, then stats show 60 % acknowledged and "Send reminder" notifies exactly 20 users; a second reminder within 24 hours is refused.
6. Given an expired announcement, then it is absent from feeds but visible in the author's manage view.
7. Given a public announcement, then `GET /api/public/news` returns it without authentication; a non-public one is not returned.
8. Given Pat has Sam (7A) and a child in 6A, when a 6A section announcement is posted, then Pat's feed labels it "For <6A child's name>".

## Test Requirements

- Unit: audience resolution per type and flag combination, teacher audience permission rules.
- Integration: `isUserInAudience` matches `resolveAudienceUserIds` for every seed user (property-style loop), scheduled publish notification idempotency.
- Playwright: admin composes targeted announcement with ack; parent reads and acknowledges; admin sees stats.

## Seed Data

- 6 announcements: school-wide welcome (pinned, public), Grade 7 parents field-trip consent (requires ack), MATH-7A homework club (Tom), staff meeting (STAFF), scheduled sports day notice (publishes in 2 days, public), expired exam timetable notice.
