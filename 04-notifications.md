# PRD-04: Notifications & Email Infrastructure

**Ticket:** SCH-004 · **Depends on:** PRD-00 – PRD-03 · **Run mode:** `--brownfield --tech-stack react`

## Summary

Build the shared notification system every later feature uses: an in-app notification centre (bell + list page), a durable email outbox with a dispatcher, branded HTML email templates, per-user notification preferences, and a single `notify()` service call. Switch the PRD-01 auth emails (invite, password reset) onto the outbox.

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

Teachers publish assignments, grades get released, students are marked absent, announcements go out — each of these must reach students and parents promptly. Building notification delivery once avoids every feature sending email its own way, and the outbox prevents a slow SMTP server from blocking user requests.

## Goals

1. A feature notifies users with one call: `notify({ type, userIds, title, body, link })`.
2. No user request waits on SMTP; emails are queued and dispatched within 60 seconds.
3. Users control which notification types reach them by email; in-app notifications for safety-critical types cannot be turned off.

## Out of Scope

- SMS and mobile push notifications.
- Real-time websockets — the bell polls.
- Digest emails (daily summary) — listed as future work.

## User Stories

- As a user, I want a bell with an unread count so that I notice new activity.
- As a user, I want to click a notification and go straight to the related page so that I can act on it.
- As a user, I want to mark one or all notifications as read so that the list stays manageable.
- As a parent, I want to choose which events email me so that my inbox is not flooded.
- As an admin, I want failed emails to retry and be visible so that important messages are not silently lost.

## Functional Requirements

### FR-1 Data model

```prisma
enum EmailStatus { PENDING SENDING SENT FAILED }

model Notification {
  id         String    @id @default(cuid())
  userId     String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  type       String                       // key from notification type registry
  title      String                       // max 140 chars
  body       String?                      // max 500 chars, plain text
  link       String?                      // relative app path, e.g. "/courses/abc/assignments/xyz"
  readAt     DateTime?
  createdAt  DateTime  @default(now())
  @@index([userId, readAt, createdAt])
}

model NotificationPreference {
  userId     String
  type       String
  inApp      Boolean  @default(true)
  email      Boolean  @default(true)
  updatedAt  DateTime @updatedAt
  @@id([userId, type])
}

model EmailOutbox {
  id            String      @id @default(cuid())
  toEmail       String
  toName        String?
  subject       String
  html          String
  text          String
  status        EmailStatus @default(PENDING)
  attempts      Int         @default(0)
  lastError     String?
  nextAttemptAt DateTime    @default(now())
  sentAt        DateTime?
  createdAt     DateTime    @default(now())
  @@index([status, nextAttemptAt])
}
```

### FR-2 Notification type registry (`src/server/notifications/types.ts`)
1. Export `NOTIFICATION_TYPES` as a typed record: key → `{ label, description, category, defaultEmail, mandatoryInApp, roles }`. Categories: `ACCOUNT`, `ACADEMIC`, `ATTENDANCE`, `COMMUNICATION`, `FINANCE`, `SYSTEM`.
2. Register in this PRD: `account.invite` and `account.password_reset` (email only, not shown in preferences), `system.test` (admin test message).
3. Later PRDs add their own keys (for example `assignment.published`, `attendance.absent`). TypeScript must reject unknown keys in `notify()`.

### FR-3 `notify()` service (`src/server/notifications/notify.ts`)
1. Signature: `notify({ type, userIds, title, body?, link?, email?: { subject?, template, data } })`.
2. For each recipient: skip archived or disabled users; read preference rows (falling back to registry defaults); create a `Notification` row when in-app is enabled or `mandatoryInApp` is true; enqueue an `EmailOutbox` row when email is enabled and the user has an email.
3. Uses `createMany` so notifying 1,000 users performs at most 3 database round-trips for notifications and 3 for emails.
4. Must never throw to the caller: failures are logged and the calling feature's transaction is unaffected. Callers invoke `notify()` after their own transaction commits.
5. Helper `notifyStudentAndParents({ studentIds, ...rest })` expands each student to the student plus all linked parents (deduplicated) — used by attendance, grades and assignments later.

### FR-4 Email templates (`src/server/email/templates/`)
1. Built with `@react-email/components`, rendered to both HTML and plain text.
2. A base layout: school logo and name header, content area, footer with school address, "Manage email preferences" link to `/account/notifications` and the sentence "You are receiving this because you have a SchoolHub account."
3. Templates in this PRD: `invite` (name, school name, accept link, expiry date), `password-reset` (link, 60-minute expiry notice), `generic-notification` (title, body, call-to-action button to `APP_URL + link`).
4. `sendAuthEmail()` from PRD-01 now enqueues `invite` / `password-reset` templates via the outbox.

### FR-5 Dispatcher
1. `dispatchEmails({ batchSize = 50 })` selects `PENDING` rows with `nextAttemptAt <= now` using `FOR UPDATE SKIP LOCKED`, marks them `SENDING`, sends via Nodemailer, and marks `SENT` or schedules a retry.
2. Retry schedule: attempts 1–5 back off at 1, 5, 15, 60 and 240 minutes; after the 5th failure set `FAILED`.
3. Trigger options: `POST /api/internal/email/dispatch` protected by header `Authorization: Bearer ${CRON_SECRET}` (for an external scheduler, every minute), and `npm run worker:email` — `package.json` already points this script at `scripts/worker-email.ts` (the file does not exist yet); create it as a Node script that loops `dispatchEmails` every 15 seconds for local development and simple deployments.
4. New env vars: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `EMAIL_FROM` (for example `"SchoolHub <no-reply@schoolhub.test>"`), `CRON_SECRET`, `EMAIL_TRANSPORT` (`smtp` | `console`, default `console` in development). The console transport logs subject, recipient and text body.

### FR-6 Notification bell (top bar)
1. Replace the PRD-00 placeholder bell. Shows unread count badge (displays "9+" above 9). Polls `GET /api/notifications/unread-count` every 30 seconds while the tab is visible (pause on `visibilitychange` hidden).
2. The bell is an MUI `IconButton` + `Badge`. Clicking opens an MUI `Popover` containing a `List` with the 10 most recent notifications (unread ones bold with a dot), each showing title, body (2-line clamp) and relative time ("5 min ago"). Clicking an item marks it read and navigates to `link`. Footer: "Mark all as read" and "View all".

### FR-7 Notifications page (`/notifications`)
1. Paginated list (20 per page), filter tabs All / Unread, category filter. Bulk "Mark all as read". Each row has a mark read / unread toggle.
2. Notifications older than 180 days are deleted by `purgeOldNotifications()`, called by the dispatcher endpoint once per day (track last run in memory; acceptable to run more than once per day after restarts).

### FR-8 Preferences (`/account/notifications`)
1. MUI `Table` grouped by category (`ListSubheader`-style group rows): each type visible to the user's role shows label, description, an "In app" switch and an "Email" switch. Mandatory in-app types show a disabled MUI `Switch` with tooltip "Required by the school".
2. Changes save immediately (optimistic UI with rollback on error) via `PUT /api/me/notification-preferences`.

### FR-9 Admin email log (`/admin/email-log`)
1. Table: created, recipient, subject, status, attempts, last error. Filter by status. Row action "Retry now" for `FAILED` rows resets `attempts = 0`, `status = PENDING`, `nextAttemptAt = now`.
2. Button "Send test notification to me" calls `notify({ type: 'system.test', … })` for the current admin.

## API

| Method & path | Role | Notes |
|---|---|---|
| `GET /api/notifications` | any | `?unread=true&category=&page=` — own notifications only |
| `GET /api/notifications/unread-count` | any | `{ data: { count } }` |
| `POST /api/notifications/:id/read` · `/unread` | owner | |
| `POST /api/notifications/read-all` | any | |
| `GET /api/me/notification-preferences` | any | Merged with registry defaults |
| `PUT /api/me/notification-preferences` | any | `{ type, inApp, email }`; `inApp=false` refused for mandatory types |
| `POST /api/internal/email/dispatch` | `CRON_SECRET` | Returns `{ sent, failed, retried }` |
| `GET /api/admin/email-log` | ADMIN | |
| `POST /api/admin/email-log/:id/retry` | ADMIN | |
| `POST /api/admin/notifications/test` | ADMIN | |

## Non-Functional Requirements

1. **Performance:** `notify()` for 1,000 recipients must finish in under 2 seconds. Unread-count endpoint must respond in under 50 ms (indexed).
2. **Reliability:** an email is never sent twice by concurrent dispatchers (row locking). A crash mid-send leaves rows in `SENDING`; rows stuck in `SENDING` for more than 10 minutes return to `PENDING`.
3. **Security:** notification `link` values must be relative paths starting with `/` (validated) to prevent open redirects. Email HTML escapes all user-provided text.
4. **Deliverability:** every email has both HTML and plain-text parts and a `List-Unsubscribe` header pointing at the preferences page.

## Acceptance Criteria

1. Given a user with default preferences, when `notify()` is called for type `system.test`, then one `Notification` row and one `EmailOutbox` row are created and the bell count increases by 1 within 30 seconds.
2. Given a parent turned off email for a type, when that type is notified, then only the in-app row is created.
3. Given an SMTP failure, when the dispatcher runs, then the row has `attempts = 1`, `status = PENDING` and `nextAttemptAt` about 1 minute later; after 5 failures the status is `FAILED` and it appears in the admin email log.
4. Given two dispatcher invocations run at the same moment over 10 pending emails, then each email is sent exactly once.
5. Given a user clicks a notification in the bell, then it is marked read and the browser navigates to its link.
6. Given a request to dispatch without the correct bearer token, then the response is `401`.
7. Given the invite flow from PRD-01, when an admin resends an invite, then an `EmailOutbox` row with the invite template is created instead of only a log line.

## Test Requirements

- Unit: preference resolution, retry backoff calculation, link validation, `notifyStudentAndParents` expansion and dedupe.
- Integration: dispatcher locking with two concurrent calls (test database), stuck-`SENDING` recovery.
- Playwright: bell count updates after the test notification, mark all as read, preference toggle persists.

## Seed Data

- 3 sample notifications for `student@schoolhub.test` and `parent@schoolhub.test` (one read, two unread) of type `system.test` linking to `/dashboard`.
