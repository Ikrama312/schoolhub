# Tech Stack Decisions: PRD-13 Direct Messaging

Ticket: SH-13 · Phase: architect (arch-research-stack) · Timestamp: 2026-11-09T21:45:00Z · Status: complete

> This file replaces a stale SH-12 version. The other files in `artifacts/architect/` are still from SH-12 until their own sub-tasks rewrite them.

**Base stack (checked against `package.json`).** `artifacts/intake/tech-stack.json` reports `react` at 100% confidence, and the workspace matches it:

- Next.js 14.2.18 App Router, React 18.3.1, TypeScript strict
- Prisma 5.20.0 on PostgreSQL 16, Zod 3.23.8
- MUI 9.5.0: material, icons-material, material-nextjs, x-data-grid, x-date-pickers
- date-fns 3.6.0, date-fns-tz 3.2.0, next-auth 5 beta, nodemailer with `@react-email/*`
- Vitest, Testing Library, Playwright 1.47 and `@axe-core/playwright`

Intake reported no blockers (`blockers: []`, 95% confidence). Intake left four decisions to the architect (`clarificationLog[0].unresolved`). ADR-9 through ADR-12 settle them.

**No new runtime dependencies.** Every requirement can be met with the stack above and the existing helpers.

---

## ADR-1: Near-real-time delivery uses HTTP polling, not websockets or SSE

**Context.** NFR-8 requires a message to appear in another open thread within 6 s. NFR-9 and the PRD's Out of Scope list rule out websockets. FR-13 fixes the intervals: 5 s for the active thread, and 30 s for the conversation list and the sidebar badge. NFR-2 requires polls to finish in under 100 ms. The app runs on Next.js route handlers, which have no long-lived connection infrastructure.

**Decision.**
- The client polls with plain `fetch` inside `setInterval`. It copies the pattern from `src/components/NotificationBell/NotificationBell.tsx`: polling pauses on `visibilitychange` when the tab is hidden and refreshes immediately when the tab becomes visible again.
- Thread polling uses `GET /api/conversations/:id/messages?after=<lastId>`. The server finds the cursor message's `createdAt` and returns rows with `createdAt > cursor`, ordered `(createdAt, id)`. The query uses the `@@index([conversationId, createdAt])` from FR-1. When nothing has changed, it returns `[]`.
- To pick up edits and deletes, a poll response also returns messages with `updatedAt > since`. The client sends `since` as the time of its last poll. The 5 s poll needs no second endpoint.
- The interval constants live in one place, `src/lib/messaging/constants.ts`: `THREAD_POLL_MS = 5000` and `LIST_POLL_MS = 30000`.
- Do not add SWR, React Query or any other data-fetching library.

**Consequences.** The worst-case delay is about 5 s plus request time, which meets the 6 s target. Load grows linearly with the number of open threads, which is acceptable for a single school. Any later move to SSE would only change the client hook. Drives: FR-13, NFR-2, NFR-8, NFR-9.

## ADR-2: Persistence is Prisma and PostgreSQL in one new migration

**Context.** FR-1 through FR-4 add Conversation, ConversationParticipant, Message, MessageAttachment, MessageReport with the ReportStatus enum, MessagingSettings, MessageRevision, PendingMessageEmail and `User.isSafeguardingLead`. FR-30 and FR-31 add the denormalised fields `involvesStudent` and `lastMessageAt`. NFR-3 forbids hard deletes by users.

**Decision.**
- Add one migration, `prisma/migrations/20261112000000_add_direct_messaging`. Its timestamp sorts after the latest migration, `20261111000000_add_gradebook`.
- Ordering, unread state and polling all depend on these indexes:
  - `Message @@index([conversationId, createdAt])` (NFR-2)
  - `ConversationParticipant @@unique([conversationId, userId])` plus `@@index([userId, archivedAt])` for the inbox
  - `Conversation @@index([lastMessageAt])`
  - `Conversation @@index([involvesStudent, createdAt])` for safeguarding search (FR-24)
  - `MessageReport @@index([status, createdAt])` (FR-23)
  - `PendingMessageEmail @@unique([userId, conversationId])` plus `@@index([dueAt])` (FR-20)
- Soft delete uses `Message.deletedAt`. The API never issues a `delete` on Message. Cascades only fire when an admin purges a User or Conversation, which matches the existing conventions.
- Write the message insert, the `Conversation.lastMessageAt` update and the sender's `lastReadAt` update in one `prisma.$transaction`. Write the edit and its `MessageRevision` insert in one transaction as well.
- Do not add a search engine. FR-9 and FR-24 search with Prisma `contains` and `mode: 'insensitive'` on participant names and subject. At single-school scale, a bounded ILIKE is enough.

**Consequences.** One reversible migration, and the existing `db:migrate` and `db:seed` flows keep working. Postgres needs no extensions. Drives: FR-1, FR-2, FR-3, FR-4, FR-9, FR-24, FR-30, FR-31, NFR-2, NFR-3.

## ADR-3: Contact rules are a pure function with an injected relationship loader

**Context.** FR-5 defines the sender-to-recipient matrix. FR-6 adds the group rules: at most 25 participants, and a group with a student must include staff. FR-7 re-checks the rules on every send. FR-32 counts co-teachers as managing a course. FR-8 lists contacts from the same rules. NFR-10 requires unit tests over the full matrix.

**Decision.**
- `src/server/messaging/contact-rules.ts` exports:
  - a pure `canMessageWith(sender, recipient, rel)`, where `rel` is a pre-loaded relationship snapshot;
  - a thin async `canMessage(sender, recipient)`, which loads the snapshot through Prisma and then calls the pure function.
- The snapshot covers:
  - ACTIVE `Enrollment` rows in courses where the teacher is `teacherId` or is listed in `coTeacherIds` (Prisma `has`);
  - `Section.homeroomTeacherId`;
  - `ParentStudentLink`.
- Vitest covers the pure function with a table-driven matrix and needs no database. A small number of integration tests cover the loader.
- `GET /api/messaging/contacts` reuses the same snapshot logic, building lists forward from the sender, so the contacts list and the send check cannot drift apart.

**Consequences.** One source of truth for who may message whom. The tests are fast and complete. Every send does one extra indexed query per recipient pair, which is affordable at 25 or fewer participants. Drives: FR-5, FR-6, FR-7, FR-8, FR-32, NFR-1, NFR-10.

## ADR-4: Reuse the existing platform services rather than adding new infrastructure

**Context.** NFR-6 sets the code conventions. Intake confirmed which helpers already exist.

**Decision.**

| Need | Reuse | Requirement |
|---|---|---|
| Auth and role checks | `requireUser` and `requireRole` from `src/server/auth/requireRole.ts`, plus a new `assertParticipant(userId, conversationId)` in `src/server/messaging/access.ts` | NFR-1 |
| Handlers and errors | `withHandler`, `ok` and `AppError` from `src/server/http.ts`, with the standard success, list and error shapes | FR-28, NFR-6 |
| Validation | Zod in a new `src/lib/validators/messaging.ts` | NFR-6 |
| Rate limit | `rateLimit('msg:'+userId, 30, 60_000)` from `src/server/rate-limit.ts`; on failure throw `AppError('RATE_LIMITED')` (HTTP 429) | NFR-4 |
| Attachments | `registerFileAccess('message', resolver)` with the resolver added in `src/server/files/contexts.ts`. Access is allowed for participants of the message's conversation, and for ADMIN users with `isSafeguardingLead`. The resolver denies on error. Uploads reuse `FileUpload` and `FileList`. | FR-11, FR-27 |
| Audit | `audit()` from `src/server/audit.ts` for `safeguarding.conversation.view` and for report review and dismissal | FR-25, NFR-11 |
| Timezone | `formatInSchoolTz` and `schoolNow` from `src/lib/dates.ts`, using `SchoolSettings.timezone` | FR-10, FR-21 |
| Logging | `logger` from `src/lib/logger.ts`, never `console.log` | NFR-6 |

**Consequences.** No new dependencies. The rate limiter keeps counts in each process (it already carries a `ponytail:` note). That is fine for one instance, and NFR-4 does not ask for more. Drives: FR-11, FR-25, FR-27, FR-28, NFR-1, NFR-4, NFR-6, NFR-11.

## ADR-5: Notification collapsing and deferred email build on `notify()`

**Context.** FR-19 requires one unread in-app `message.received` per conversation, replacing older ones, with email on by default. FR-20 sends the email only if the recipient has not read the conversation within 10 minutes and it is outside their quiet hours. FR-26 adds `message.reported`, which is mandatory in-app and sends email. In `src/server/notifications/notify.ts`, `notify()` enqueues email only when `input.email` is set, and it already resolves per-user preferences. The `Notification` model has no `conversationId` column.

**Decision.**
- Register both types in `src/server/notifications/types.ts` under `COMMUNICATION`:
  - `message.received`: `defaultEmail: true`
  - `message.reported`: `mandatoryInApp: true`, `defaultEmail: true`
- **Collapsing.** Unread rows are keyed by the link `/messages/<conversationId>`. On send, the service runs `notification.deleteMany({ userId in recipients, type: 'message.received', link, readAt: null })` and then calls `notify()` without `email`. That writes the in-app rows only. Muted participants are skipped.
- **Deferral.** In the same send path, the service upserts `PendingMessageEmail` with `dueAt = now + 10 min`, using the unique key `(userId, conversationId)`. A repeat send does not reset `dueAt`, so the first unread message starts the clock.
- **Dispatch.** Add `processPendingMessageEmails(now)` in `src/server/messaging/email.ts`. It runs in its own try/catch in `POST /api/internal/email/dispatch`, next to the quiz jobs. For each due row:
  - If `lastReadAt` is at or after the row's `createdAt`, delete the row.
  - Else, if the recipient is in quiet hours, move `dueAt` to the end of their quiet hours.
  - Otherwise, enqueue the email and delete the row.
- **Email-only path.** Extend `NotifyInput` with an optional `inApp?: boolean` flag, defaulting to `true`. The worker reuses `notify()` with `inApp: false`, so preference resolution and email rendering stay in one place.
- Do not add a job queue or a separate cron. The existing cron is the maintenance run.

**Consequences.** The change is additive: the default flag keeps the behaviour of every current `notify()` caller. Email latency is bounded by the cron interval. That is acceptable because the PRD's threshold is 10 minutes. Drives: FR-19, FR-20, FR-26, NFR-10.

## ADR-6: Quiet hours are wall-clock strings evaluated in the school timezone

**Context.** FR-21 stores a start and end time as `HH:mm` in the school timezone, and the range may wrap midnight.

**Decision.**
- `MessagingSettings.quietStart` and `MessagingSettings.quietEnd` are nullable `String` fields in `HH:mm`, validated by a Zod regex.
- A pure helper `isInQuietHours(hhmm, start, end)` handles the wrap with `start > end ? (t >= start || t < end) : (t >= start && t < end)`.
- A second helper, `quietHoursEnd(now, tz, settings)`, uses `fromZonedTime` to turn the end time into a UTC instant.
- The UI is an MUI `TextField type="time"`. Do not add `TimePicker` from `@mui/x-date-pickers`, so no date adapter needs wiring for this page.

**Consequences.** Daylight-saving changes are handled by date-fns-tz. The helpers are pure and easy to unit test. Drives: FR-20, FR-21, NFR-6, NFR-10.

## ADR-7: The UI uses MUI only, built from existing components

**Context.** NFR-5 allows only MUI v9 and MUI X, looked up through mui-mcp, and bans Tailwind, shadcn, Radix, notistack and similar libraries. NFR-7 requires a single pane below 768 px. FR-9 through FR-12 describe the inbox, thread, composer and new-conversation dialog.

**Decision.**
- **Layout.** Use MUI `Box`, `Stack`, `List`, `ListItemButton`, `Badge`, `Tabs`, `Divider` and `Paper`.
- **Responsive switch.** Use `useMediaQuery(theme.breakpoints.down(768))` or a custom theme breakpoint. When the screen is narrow, `/messages/[id]` renders the thread with a back `IconButton`.
- **Composer.** Use a multiline MUI `TextField`. `onKeyDown` sends on Enter and inserts a newline on Shift+Enter. A `Typography` counter shows after 4,500 characters.
- **Upward infinite scroll.** Use an `IntersectionObserver` sentinel at the top of the thread, which needs no library. When older messages load, the hook keeps the scroll position stable.
- **Recipient picker.** Use MUI `Autocomplete` with `multiple` and `groupBy` set to the contact group label from FR-8. `UserPicker` is not used here because it calls `/api/users/search`, which ignores contact rules.
- **Reuse.** Reuse `UserAvatar`, `ConfirmDialog`, `Toast`/`useToast`, `EmptyState`, `PageHeader`, `FileUpload` and `FileList` from `src/components/<Name>/`.
- **Safeguarding queue.** Use `@mui/x-data-grid` for the reports queue and the conversations search, matching the other admin pages.
- **Styling.** Use the theme, `sx` and `styled()` only.
- **Doc lookups.** Look up every MUI component through mui-mcp (`useMuiDocs`/`fetchDocs`) before using it. Note: mui-mcp did not connect during this sub-task (connection timeout). The dev phase must confirm it is reachable.

**Consequences.** No banned imports, and the UI looks like the rest of the app. Drives: FR-9, FR-10, FR-11, FR-12, FR-23, FR-24, NFR-5, NFR-7.

## ADR-8: Safeguarding access is checked on the server only

**Context.** FR-23 and FR-24 limit safeguarding views to ADMIN users with `isSafeguardingLead`. NFR-1 says conversation IDs are never proof of access. FR-25 requires every safeguarding view to be audited.

**Decision.**
- Add `requireSafeguardingLead()` in `src/server/messaging/access.ts`. It calls `requireRole('ADMIN')`, then re-reads `isSafeguardingLead` from the database, not from the session token, so revoking the flag takes effect immediately. If the flag is false, it throws `FORBIDDEN` (HTTP 403).
- Pages under `src/app/(app)/admin/safeguarding` call it server-side, using the existing `requirePageRole` pattern.
- The read-only conversation view includes `deletedAt` content and `MessageRevision` rows. It calls `audit({ action: 'safeguarding.conversation.view' })` once per request.

**Consequences.** A database lookup on each safeguarding request. These requests are rare, so the cost is negligible. Drives: FR-23, FR-24, FR-25, NFR-1, NFR-3.

---

## Settled open questions from intake

| # | Question | Decision | Basis |
|---|---|---|---|
| ADR-9 | Do co-teachers count as managing a course? | **Yes.** `teacherId = me OR coTeacherIds has me`, the same rule `contexts.ts` already uses for file access. | FR-32, FR-5 |
| ADR-10 | Should the new models get `updatedAt`? | **Yes**, on Conversation, ConversationParticipant, Message, MessageReport, MessageAttachment and MessagingSettings, following the platform convention (28 of the 51 existing models have it). `Message.updatedAt` also gives polling its "changed since" signal (ADR-1). MessageRevision and PendingMessageEmail keep only `createdAt`: revisions never change, and pending emails are only upserted and deleted. | FR-1, NFR-6 |
| ADR-11 | Where is `isSafeguardingLead` edited? | **There is no admin user edit form.** Nothing under `src/app/(app)/admin` edits users, and no `.tsx` file calls `PATCH /api/users/:id`. Add `isSafeguardingLead: z.boolean().optional()` to `updateUserSchema` (`src/lib/validators/users.ts`) and to `updateUser()` (`src/server/services/users.ts`). Reject `true` unless the target user is ADMIN, and record the change with `audit()`. Building a user-admin UI is out of scope, so this is recorded as a known gap. The seed (FR-29) sets the flag on Alice Admin. | FR-2, NFR-9, NFR-11 |
| ADR-12 | Do quiet hours apply only to teachers or to every role? | **Every role.** `/api/me/messaging-settings` is open to any authenticated user. | FR-21 |

## Known gaps and risks for downstream sub-tasks

- **Rate limiter.** The in-process rate limiter only holds on a single instance (ADR-4).
- **No user-admin page.** `isSafeguardingLead` can be changed through the API and the seed only (ADR-11).
- **mui-mcp unreachable.** mui-mcp could not be reached during this sub-task. The dev phase must use it for component lookups (NFR-5).
- **PRD-12 not present.** PRD-12 (Announcements) is absent. Messaging has no code dependency on it, so do not build announcements (NFR-9).
