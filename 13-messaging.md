# PRD-13: Direct Messaging

**Ticket:** SCH-013 · **Depends on:** PRD-00 – PRD-12 · **Run mode:** `--brownfield --tech-stack react`

## Summary

Safe, school-governed messaging between staff, students and parents: one-to-one and small-group conversations, attachments, unread tracking, near-real-time updates by polling, contact rules that protect students (no student-to-student messaging, students only reach their own teachers), quiet hours, message reporting and admin safeguarding review.

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

Parents and teachers currently use personal phone numbers and consumer chat apps, which raises safeguarding and privacy concerns and leaves no school record. A school-controlled channel with clear rules and an auditable record is required.

## Goals

1. A parent can message their child's teacher in under 30 seconds from the child's page.
2. Contact rules are enforced on the server for every message, with no way to bypass them.
3. Every conversation involving a student is reviewable by safeguarding admins.

## Out of Scope

- Voice/video calls, typing indicators, message reactions, end-to-end encryption.
- Websockets — polling only.
- Broadcast messaging (use announcements, PRD-12).

## User Stories

- As a parent, I want to message my child's teachers so that I can raise concerns privately.
- As a teacher, I want to message a student or a group of students in my course so that I can follow up on work.
- As a teacher, I want to message a student's parents together so that both guardians receive the same information.
- As a user, I want to see unread conversations and get notified of new messages so that I respond promptly.
- As a teacher, I want quiet hours so that I am not emailed about messages in the evening.
- As a user, I want to report an inappropriate message so that the school can act.
- As a safeguarding admin, I want to review reported messages and any conversation involving a student so that students are protected.

## Functional Requirements

### FR-1 Data model

```prisma
model Conversation {
  id            String    @id @default(cuid())
  subject       String?                     // max 120
  createdById   String
  isGroup       Boolean   @default(false)
  involvesStudent Boolean @default(false)   // computed on create, used for safeguarding
  lastMessageAt DateTime  @default(now())
  createdAt     DateTime  @default(now())
  participants  ConversationParticipant[]
  messages      Message[]
  @@index([lastMessageAt])
}

model ConversationParticipant {
  conversationId String
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  userId         String
  user           User         @relation(fields: [userId], references: [id])
  lastReadAt     DateTime?
  mutedAt        DateTime?
  archivedAt     DateTime?                 // per-user archive
  joinedAt       DateTime     @default(now())
  @@id([conversationId, userId])
  @@index([userId])
}

model Message {
  id             String       @id @default(cuid())
  conversationId String
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  senderId       String
  sender         User         @relation(fields: [senderId], references: [id])
  body           String                    // plain text, 1–5,000 chars
  createdAt      DateTime     @default(now())
  editedAt       DateTime?
  deletedAt      DateTime?                 // soft delete; content retained for safeguarding
  attachments    MessageAttachment[]
  @@index([conversationId, createdAt])
}

model MessageAttachment {
  id        String     @id @default(cuid())
  messageId String
  message   Message    @relation(fields: [messageId], references: [id], onDelete: Cascade)
  fileId    String
  file      FileObject @relation(fields: [fileId], references: [id])
}

enum ReportStatus { OPEN REVIEWED DISMISSED }

model MessageReport {
  id          String       @id @default(cuid())
  messageId   String
  reporterId  String
  reason      String                       // max 1,000
  status      ReportStatus @default(OPEN)
  reviewedById String?
  reviewNote  String?
  createdAt   DateTime     @default(now())
  reviewedAt  DateTime?
}

model MessagingSettings {
  userId          String  @id
  quietHoursStart String?                  // "18:00"
  quietHoursEnd   String?                  // "07:00"
}
```

Add `isSafeguardingLead Boolean @default(false)` to `User` (only meaningful for ADMIN; editable on the admin user form).

### FR-2 Contact rules (`src/server/messaging/contact-rules.ts`)
`canMessage(sender, recipient)` returns true only when:

| Sender → Recipient | Allowed when |
|---|---|
| ADMIN → anyone | always |
| TEACHER → ADMIN/TEACHER | always |
| TEACHER → STUDENT | student is ACTIVE in a course the teacher manages, or in the section they homeroom |
| TEACHER → PARENT | parent is linked to such a student |
| STUDENT → TEACHER | teacher manages a course the student is ACTIVE in, or is their homeroom teacher |
| STUDENT → ADMIN | always |
| STUDENT → STUDENT / PARENT | never |
| PARENT → TEACHER | teacher teaches or homerooms a linked child |
| PARENT → ADMIN | always |
| PARENT → PARENT / STUDENT | never |

1. Creating a conversation requires `canMessage(creator, each other participant)`. Groups are limited to 25 participants. A group containing a STUDENT must include at least one TEACHER or ADMIN, and every non-staff participant pair must not violate the rules (students in a teacher-created group may reply to the group — the group context permits it — but cannot start new conversations with each other).
2. Rules are re-checked when a message is sent: if a relationship ended (enrollment dropped, link removed), the non-staff party can no longer send; the composer shows "You can no longer send messages in this conversation."
3. `GET /api/messaging/contacts?q=` returns only users the current user may message, grouped: "My teachers", "My child's teachers (Sam)", "Students in MATH-7A", "Parents of students in MATH-7A", "School office".

### FR-3 Inbox (`/messages`)
1. Two-pane layout (single pane with back navigation below 768 px). Left: conversation list sorted by `lastMessageAt`, showing participants' names (or subject), last message preview (sender: text), time, unread badge; search by participant name or subject; tabs Inbox / Archived.
2. Right: message thread with sender avatar and name, timestamps grouped by day, attachments (via `FileList`), "edited" marker, deleted messages shown as "This message was deleted". Infinite scroll upward, 30 messages per page.
3. Composer: textarea (Enter sends, Shift+Enter newline), attach up to 5 files (context `message`), character counter after 4,500.
4. New conversation dialog: recipient picker from the contacts endpoint (multi-select), optional subject, first message.
5. Polling: active thread polls `GET /api/conversations/:id/messages?after=<lastId>` every 5 seconds while visible; the list and sidebar unread badge poll every 30 seconds.
6. Opening a thread updates `lastReadAt`. Per-conversation menu: mute, archive/unarchive, view participants, leave group (not for the creator of a group with students).
7. Senders can edit or delete their own message within 15 minutes.

### FR-4 Entry points
1. Student page header: "Message parents" (TEACHER/ADMIN; starts a group with the student's linked parents) and "Message teacher" (PARENT; picker of the child's teachers).
2. Course roster: "Message selected students" (TEACHER).
3. Sidebar: "Messages" with unread count, all roles.

### FR-5 Notifications and quiet hours
1. Register `message.received` (COMMUNICATION, default email true). After a message is sent, notify other non-muted participants: in-app immediately (one per conversation, replacing older unread `message.received` rows for that conversation to avoid pile-up); email only if the recipient has not read the conversation within 10 minutes, and not during the recipient's quiet hours (deferred until quiet hours end), sent by the maintenance run via a `PendingMessageEmail` table `{ userId, conversationId, dueAt }`.
2. Account page `/account/notifications` gains a "Quiet hours" section (start/end times, school timezone).

### FR-6 Reporting & safeguarding
1. Any participant can "Report" a message with a reason; reporter sees "Reported — the school will review this."
2. `/admin/safeguarding` (ADMIN with `isSafeguardingLead`): Reports queue (open first) with message, context (5 messages before and after), participants, actions Mark reviewed (note) / Dismiss. A Conversations search lists conversations where `involvesStudent = true`, filterable by participant and date, read-only view including deleted and edited content (original body kept in `MessageRevision { messageId, body, createdAt }` on edit).
3. Every safeguarding view of a conversation writes an audit entry `safeguarding.conversation.view`.
4. Notify safeguarding leads on each new report (`message.reported`, mandatory in-app, email true).

### FR-7 File access
1. Register `message` context: conversation participants and safeguarding leads.

## API

| Method & path | Role | Notes |
|---|---|---|
| `GET /api/conversations?tab=&q=&page=` | any | Own conversations |
| `POST /api/conversations` | any | `{ participantIds, subject?, body, fileIds? }`; contact rules |
| `GET /api/conversations/:id` | participant | Participants + meta |
| `GET /api/conversations/:id/messages?before=&after=` | participant | |
| `POST /api/conversations/:id/messages` | participant | Rules re-check; rate limit 30 messages/min/user |
| `PATCH /api/messages/:id` · `DELETE /api/messages/:id` | sender, ≤ 15 min | |
| `POST /api/conversations/:id/read` · `/mute` · `/archive` · `/leave` | participant | |
| `GET /api/messaging/unread-count` | any | |
| `GET /api/messaging/contacts?q=` | any | |
| `POST /api/messages/:id/report` | participant | |
| `GET /api/safeguarding/reports` · `PATCH /api/safeguarding/reports/:id` | safeguarding lead | |
| `GET /api/safeguarding/conversations` · `/:id` | safeguarding lead | Audited |
| `GET/PUT /api/me/messaging-settings` | any | Quiet hours |

## Non-Functional Requirements

1. **Security:** every endpoint verifies participation server-side; conversation ids are unguessable cuids but never treated as authorisation.
2. **Performance:** polling endpoints respond in under 100 ms (indexed on `conversationId, createdAt`) and return `304`-equivalent empty arrays when nothing changed.
3. **Retention:** messages are never hard-deleted by users; soft-deleted content remains for safeguarding.

## Acceptance Criteria

1. Given Pat is Sam's parent and Tom teaches Sam, when Pat starts a conversation with Tom, then it is created and Tom gets an in-app notification.
2. Given Sam tries to message Sara via the API, then the response is `403` and no conversation is created.
3. Given Sam's enrollment in Robotics Club is dropped, when Sam replies in a conversation with that course's teacher who is not otherwise Sam's teacher, then sending is refused with the explanation; the teacher can still send.
4. Given Tina sets quiet hours 18:00–07:00 and a parent messages her at 19:00, then Tina gets the in-app notification immediately and an email after 07:00 only if still unread.
5. Given Tom edits a message within 15 minutes, then participants see "edited" and the safeguarding view shows the original text.
6. Given Sara reports a message, then safeguarding leads are notified and the report appears in the queue with surrounding context.
7. Given an admin without `isSafeguardingLead` opens `/admin/safeguarding`, then they get `403`.
8. Given a thread is open in two browsers, when one sends a message, then the other shows it within 6 seconds.

## Test Requirements

- Unit: the full contact-rule matrix including group rules and ended relationships.
- Integration: notification collapsing per conversation, quiet hours deferral, edit revision capture.
- Playwright: parent → teacher conversation round trip in two browser contexts; student blocked from messaging a student.

## Seed Data

- Alice Admin is a safeguarding lead.
- Conversations: Pat ↔ Tom about Sam's homework (6 messages), Tom → MATH-7A group of 4 students (3 messages), Tina ↔ Tom staff chat (4 messages), one reported message in a seeded student ↔ teacher conversation.
