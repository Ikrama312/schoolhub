# System Design: PRD-13 Direct Messaging

Ticket: **SH-13** · Phase: architect (`arch-design-system`) · Timestamp: 2026-11-09T22:30:00Z · Status: **complete**

Inputs read from disk: `artifacts/intake/requirements.json` (32 FR + 11 NFR), `artifacts/intake/handoff-to-architect.json`, `artifacts/intake/tech-stack.json`, `artifacts/architect/tech-stack-decisions.md` (ADR-1..12), `artifacts/architect/requirements-analysis-notes.md` (B1..B20, A1..A14).

> This file replaces a stale SH-12 `system-design.md`. `api-contracts.json` and `handoff-to-dev-planning.json` in this folder are still stale (SH-12). `arch-api-contracts` must rewrite them from this document.

---

## 1. Overview

SchoolHub gets 1:1 and small-group (≤25) messaging between staff, students and parents. It runs inside the existing Next.js 14 App Router monolith, with no new dependencies and no new infrastructure:

- **Storage:** 8 new Prisma models plus `User.isSafeguardingLead`, in one migration (ADR-2).
- **Who may message whom:** one pure rules module, `contact-rules.ts`. Create, send and the contacts list all use it (ADR-3).
- **Delivery:** HTTP polling. The open thread polls every 5 s; the inbox list and the sidebar badge poll every 30 s. There are no websockets (ADR-1, NFR-8, NFR-9).
- **Notifications:** in-app notifications are collapsed to one unread row per conversation. Email is deferred through `PendingMessageEmail`, which the existing maintenance cron drains, and it respects quiet hours (ADR-5, ADR-6).
- **Safeguarding:** the safeguarding area is server-gated on `ADMIN` plus `isSafeguardingLead`, read fresh from the database. Every view is audited. Deleted messages and edit history are retained and visible only to safeguarding leads (ADR-8, NFR-3).
- **UI:** MUI-only and built from the existing shared components (ADR-7, NFR-5).

### Intake blockers and carried risks (Compliance Rule 5)

**Intake blockers:** `handoff-to-architect.json.blockers` is **empty**. Intake confidence was 95%.

**Carried risks and known gaps** (none of them blocks this phase):

1. **PRD-12 is absent.** SH-12 Announcements failed. Messaging has no code dependency on it, so do not build announcements here (NFR-9).
2. **No user-admin form exists.** `isSafeguardingLead` can be set only through `PATCH /api/users/:id` and the seed (ADR-11, FR-2). This is a documented gap. Building a user-admin UI is out of scope.
3. **mui-mcp was unreachable during the architect phase.** The dev phase must connect to it and run `useMuiDocs`/`fetchDocs` before writing any UI (NFR-5).
4. **The rate limiter is per-process.** It only holds on a single instance. This is accepted (ADR-4, NFR-4).
5. **`/students/[id]` has no page or layout today.** The FR-16 actions need a new layout (§3.8).

### Resolved open decisions

| Decision | Resolution | Source |
|---|---|---|
| Do co-teachers manage a course? | Yes: `teacherId = me OR coTeacherIds has me`. | ADR-9, FR-32 |
| `updatedAt` on new models | Added to Conversation, ConversationParticipant, Message, MessageAttachment, MessageReport and MessagingSettings. Not added to MessageRevision or PendingMessageEmail. | ADR-10 |
| Where `isSafeguardingLead` is edited | API and validator only. Setting it to `true` on a non-ADMIN user is rejected with 422/VALIDATION, and the change is audited. | ADR-11 |
| Who gets quiet hours | All roles. | ADR-12 |
| Group send rule after a relationship ends | A non-staff sender may send only if `canMessage(sender, s)` holds for at least one staff participant who has not left. Staff can always send. | A4, FR-7 |
| Homeroom reachability | Current academic year only: `section.academicYear.isCurrent`. Applies to messaging only. `student-access.ts` is not changed. | A5 |
| Access after leaving | A participant with `leftAt` set is treated as a non-participant: 404 on the thread and denied on attachments. | A7 |
| Leaving a 1:1 conversation | Not allowed. Archive covers 1:1. Leaving is possible only when a conversation has more than 2 participants. | A10 |
| Effect of a new message on archive state | It clears `archivedAt` for the recipients. The unread count covers all conversations the user has not left. | A11 |
| Reporting rules | Users can report others' messages only. Only one OPEN report per (message, reporter) is allowed; a repeat returns 409. | A12 |
| Breakpoint | `theme.breakpoints.down(768)`, used locally. The theme is not changed. | A8, NFR-7 |
| How pollers see edits and deletes | `?after=<lastId>&since=<iso>` returns `{ messages, changed }`. | A9, ADR-1 |
| How email is sent without an in-app row | Add an optional `NotifyInput.inApp?: boolean` (default `true`). The worker calls `notify({ inApp:false, email })`, so preference and status filtering stay inside `notify()`. | ADR-5 |
| Quiet-hours input | MUI `TextField type="time"`. Not `TimePicker`. | ADR-6 |
| Nav entry for safeguarding | Add `NavItem.requires?: 'safeguardingLead'`. `(app)/layout.tsx` reads the flag and passes it to the shell. The page still enforces 403 itself. | A13, FR-23 |

---

## 2. Data Model (one migration: `20261112000000_add_direct_messaging`)

The field names in the PRD's Prisma block are authoritative. The sketch below is the **minimum plus architect additions**, which are marked `// +`. All IDs are `cuid()`. All timestamps are stored in UTC.

```prisma
enum ReportStatus { OPEN REVIEWED DISMISSED }

model Conversation {
  id              String   @id @default(cuid())
  subject         String?  // ≤120 (FR-12)
  createdById     String
  involvesStudent Boolean  @default(false)       // FR-30, set at create, never changes
  lastMessageAt   DateTime @default(now())       // FR-31
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt            // + ADR-10
  createdBy       User     @relation("ConversationCreator", fields: [createdById], references: [id], onDelete: Cascade)
  participants    ConversationParticipant[]
  messages        Message[]
  pendingEmails   PendingMessageEmail[]
  @@index([lastMessageAt])
  @@index([involvesStudent, createdAt])          // FR-24
}

model ConversationParticipant {
  id             String    @id @default(cuid())
  conversationId String
  userId         String
  lastReadAt     DateTime?
  mutedAt        DateTime?
  archivedAt     DateTime?
  leftAt         DateTime?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt          // + ADR-10
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([conversationId, userId])
  @@index([userId, archivedAt])
}

model Message {
  id             String    @id @default(cuid())
  conversationId String
  senderId       String
  body           String    // 1..5000 (FR-11)
  editedAt       DateTime?
  deletedAt      DateTime? // soft delete only (NFR-3)
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt          // + ADR-10, gives polling its "changed since" signal
  conversation   Conversation        @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  sender         User                @relation("MessageSender", fields: [senderId], references: [id], onDelete: Cascade)
  attachments    MessageAttachment[]
  revisions      MessageRevision[]
  reports        MessageReport[]
  @@index([conversationId, createdAt])        // NFR-2
}

model MessageAttachment { id, messageId, fileId @unique, createdAt, updatedAt(+)
  // Cascade on Message and on FileObject. Back-relation FileObject.messageAttachments.
}
model MessageRevision   { id, messageId, body, createdAt   @@index([messageId]) }               // FR-3
model MessageReport     { id, messageId, reporterId, reason (≤1000), status ReportStatus @default(OPEN),
                          reviewedById?, reviewedAt?, reviewNote?, createdAt, updatedAt(+)
                          @@index([status, createdAt])  @@index([messageId, reporterId]) }      // FR-22/23
model MessagingSettings { id, userId @unique, quietStart String?, quietEnd String?, createdAt, updatedAt } // FR-21
model PendingMessageEmail { id, userId, conversationId, dueAt, createdAt
                          @@unique([userId, conversationId])  @@index([dueAt]) }                // FR-4/20
// User: + isSafeguardingLead Boolean @default(false)  (FR-2), plus back-relations for every model above.
```

Transactions (all use `prisma.$transaction`):

- **Send.** Insert the Message. Link the attachments (`FileObject.contextId = messageId`). Update `Conversation.lastMessageAt`. Set the sender's `lastReadAt` to now. Clear `archivedAt` for the other participants. (FR-11, FR-27, FR-31, A11)
- **Create.** Insert the Conversation (with `involvesStudent` computed), the participants, and the first message using the same send logic. (FR-6, FR-30)
- **Edit.** Insert a MessageRevision holding the *old* body. Update `body` and `editedAt`. (FR-3, FR-15)

No code path issues `prisma.message.delete*`. Cascades fire only when an admin purges a User or a Conversation.

---

## 3. Component Breakdown

All new server code lives in `src/server/messaging/` (NFR-6). Route handlers are thin: `withHandler`, then auth, then `parseBody`/`parseQuery` with schemas from `src/lib/validators/messaging.ts`, then a service call, then `ok`/`paginated`.

### 3.1 Server modules

| Module | Responsibility | Requirements |
|---|---|---|
| `contact-rules.ts` | `canMessageWith(sender, recipient, rel)` is pure. `loadRelations(senderId, candidateIds)` loads in one batch: ACTIVE enrollments in courses the teacher manages (`teacherId` or `coTeacherIds has`), current-year homeroom `SectionMember`, `ParentStudentLink`, and recipient role and status. `canMessage(sender, recipient)` and `messageableIds(sender, ids)` are thin async wrappers. Non-ACTIVE recipients → false. `validateNewConversation(creator, participants)` checks the 2..25 participant count, `canMessage` for each participant, and that any group with a STUDENT also has a TEACHER or ADMIN. `canSendIn(sender, participants)` implements the A4 rule. | FR-5, FR-6, FR-7, FR-32, NFR-1 |
| `contacts.ts` | `listContacts(user, q)` builds labelled groups forward from the same relation queries: "My teachers", "My child's teachers (<child>)", "Students in <course>", "Parents of students in <course>", "Homeroom <section>", "Staff" (TEACHER) and "School office" (ADMINs). Each group is filtered by `q` (case-insensitive name match) and capped at 50. | FR-8 |
| `access.ts` | `getParticipation(userId, conversationId)` returns the participant row only if `leftAt` is null; otherwise it throws `NOT_FOUND`. `requireSafeguardingLead()` calls `requireUser` and `requireRole('ADMIN')`, then reads `isSafeguardingLead` from the database and throws `FORBIDDEN` if it is false. `requirePageSafeguardingLead()` redirects to `/forbidden`. | NFR-1, FR-23, FR-24 |
| `conversations.ts` | `listConversations(user, {archived, q, page})` returns rows ordered by `lastMessageAt desc` with the participants, a preview (`"<first name>: <body ≤80>"`, or "This message was deleted") and `unreadCount`. Per-row unread counts come from one raw SQL `LATERAL COUNT` over the page, capped at 99. `createConversation`, `getConversation` (returns `canSend`, `canLeave` and the participants), `markRead`, `setMuted`, `setArchived`, `leave`. `leave` is refused with 403 when the conversation has 2 or fewer participants, or when the user is the creator and `involvesStudent` is true. | FR-6, FR-9, FR-12, FR-14, FR-30, FR-31 |
| `messages.ts` | `listMessages(user, id, {before \| after+since, limit=30})` uses a keyset on `(createdAt, id)`. Deleted messages go to normal users as `{deleted:true, body:null, attachments:[]}`. `sendMessage` checks the rate limit, the participation, `canSendIn`, and attachment ownership (owner = sender, unattached, context `'message'`, at most 5), then runs the send transaction and, after commit, `onMessageSent`. `editMessage` and `deleteMessage` require: the caller is the sender, `now − createdAt ≤ 15 min`, and the message is not already deleted. Otherwise they throw 403 with `details.reason = 'EDIT_WINDOW_EXPIRED'`. | FR-7, FR-10, FR-11, FR-13, FR-15, FR-27, FR-31, NFR-2, NFR-3, NFR-4 |
| `notifications.ts` | `onMessageSent(conversationId, message)` handles each other participant who has not muted or left the conversation. It runs `notification.deleteMany({ userId in, type:'message.received', readAt:null, link })`, then `notify({ type:'message.received', link, title, body })` **without email**. It then upserts `PendingMessageEmail` with `create: { dueAt: now+10m }, update: {}`, so the first unread message starts the 10-minute clock. `conversationLink(id)` is the single link builder, shared with `markRead`. `onMessageReported(report)` notifies ACTIVE safeguarding leads with `message.reported` and email, without the message text. | FR-19, FR-20, FR-26 |
| `quiet-hours.ts` | Pure functions `isInQuietHours(hhmm, start, end)` (handles ranges that wrap midnight) and `quietHoursEnd(now, tz, settings)`, which converts the end time to a UTC instant with date-fns-tz. `getSettings` and `putSettings` require start and end to be both set or both null, and reject `start == end`. | FR-20, FR-21 |
| `email.ts` | `processPendingMessageEmails(now)`, run from `POST /api/internal/email/dispatch` in its own try/catch. It processes `dueAt ≤ now`, at most 200 rows per run. For each row: claim it with `deleteMany({id})` and continue only if `count === 1`. If `lastReadAt ≥ row.createdAt`, or the user is muted or has left, drop the row. If the user is in quiet hours, re-insert the row with `dueAt = quietHoursEnd`. Otherwise call `notify({ inApp:false, email:{ template:'generic-notification' } })`. | FR-4, FR-20 |
| `reports.ts` | `reportMessage(user, messageId, reason)` requires a participant who is not the sender. A second OPEN report from the same user on the same message returns 409. After commit it calls `onMessageReported`. | FR-22, FR-26 |
| `safeguarding.ts` | Each function starts with `requireSafeguardingLead()`. `listReports({status})` returns OPEN reports first, then the rest by `createdAt desc`. `getReport(id)` returns the message, 5 messages before and 5 after (including deleted messages and revisions) and the participants, and writes an audit row. `reviewReport(id, {action:'review'\|'dismiss', note?})` sets `status`, `reviewedById`, `reviewedAt` and `reviewNote`, then writes an audit row. `searchConversations({participantId, from, to, page})` filters on `involvesStudent: true`. `getConversationForSafeguarding(id)` returns the full thread, including deleted bodies and `revisions[]`, and calls `audit({action:'safeguarding.conversation.view', entityType:'Conversation', entityId})` on **every** call. | FR-23, FR-24, FR-25, NFR-1, NFR-3, NFR-11 |
| `files/contexts.ts` (edit) | `register('message', resolver)` with `contextId = messageId`. The resolver allows a participant who has not left the message's conversation, or an ADMIN with `isSafeguardingLead` (read from the database). It denies on any error. | FR-27 |
| `notifications/types.ts` (edit) | Add `message.received` {COMMUNICATION, defaultEmail:true, roles: all} and `message.reported` {COMMUNICATION, mandatoryInApp:true, defaultEmail:true, roles:['ADMIN']}. | FR-19, FR-26 |
| `notifications/notify.ts` (edit) | Add an optional `inApp?: boolean`, default `true`. When it is `false`, skip the `Notification` insert. All existing callers keep their current behaviour. | FR-20 |
| `users` validator and service (edit) | Add `isSafeguardingLead: z.boolean().optional()`. Reject `true` unless the target user is ADMIN. Audit the change in the existing `user.update` metadata. | FR-2, NFR-11 |
| `prisma/seed.ts` (edit) | Set Alice as a safeguarding lead. Upsert the Pat↔Sam `ParentStudentLink` if it is missing. Seed four threads: Pat↔Tom about Sam's homework (6 messages); Tom and 4 ACTIVE MATH-7A students (3 messages); Tina↔Tom (4 messages); and one student↔teacher thread with one OPEN report. Each block is idempotent: it looks up the thread by subject and skips if it exists. A block is skipped with a `logger.warn` if its prerequisites are missing. All seeded data must satisfy `canMessage`. | FR-29 |

### 3.2 Validators: `src/lib/validators/messaging.ts`

| Schema | Fields |
|---|---|
| `createConversationSchema` | `{participantIds: cuid[] 1..24, subject?: ≤120, body: trim 1..5000, fileIds?: ≤5}` |
| `sendMessageSchema` | `{body, fileIds?}` |
| `editMessageSchema` | `{body}` |
| `listMessagesQuery` | `{before?}` or `{after, since?}`, which are mutually exclusive, plus `limit ≤ 30` |
| `listConversationsQuery` | `{archived?: bool, q?, page, pageSize}` |
| `archiveSchema` | `{archived: bool}` |
| `muteSchema` | `{muted: bool}` |
| `reportSchema` | `{reason: trim 1..1000}` |
| `reviewReportSchema` | `{action: 'review'\|'dismiss', note?: ≤1000}` |
| `safeguardingConversationsQuery` | `{participantId?, from?, to?, page}` |
| `messagingSettingsSchema` | `{quietStart: HH:mm\|null, quietEnd: HH:mm\|null}` |
| `contactsQuery` | `{q?: ≤100}` |

The client composer imports the same limits from `src/lib/messaging/constants.ts`: `BODY_MAX=5000`, `COUNTER_FROM=4500`, `MAX_FILES=5`, `MAX_PARTICIPANTS=25`, `EDIT_WINDOW_MS=15*60_000`, `THREAD_POLL_MS=5000`, `LIST_POLL_MS=30000`, `PAGE_SIZE=30`. (FR-11, FR-13, FR-15, NFR-6)

### 3.3 API route handlers (surface for `arch-api-contracts`)

| Method and path | Auth | Service | Requirements |
|---|---|---|---|
| GET `/api/conversations` | any user | listConversations | FR-9, FR-28 |
| POST `/api/conversations` | any user + rate limit | createConversation | FR-6, FR-12, FR-30, NFR-4 |
| GET `/api/conversations/:id` | participant | getConversation | FR-7, FR-14, NFR-1 |
| GET `/api/conversations/:id/messages?before=\|after=&since=` | participant | listMessages | FR-10, FR-13, NFR-2 |
| POST `/api/conversations/:id/messages` | participant + rate limit (30/min) | sendMessage | FR-7, FR-11, FR-19, FR-20, FR-31, NFR-4 |
| POST `/api/conversations/:id/read` | participant | markRead | FR-14 |
| POST `/api/conversations/:id/mute` | participant | setMuted | FR-14 |
| POST `/api/conversations/:id/archive` | participant | setArchived | FR-14 |
| POST `/api/conversations/:id/leave` | participant | leave | FR-14 |
| PATCH `/api/messages/:id` | sender, within 15 min | editMessage | FR-3, FR-15 |
| DELETE `/api/messages/:id` | sender, within 15 min (soft delete) | deleteMessage | FR-15, NFR-3 |
| POST `/api/messages/:id/report` | participant, not the sender | reportMessage | FR-22, FR-26 |
| GET `/api/messaging/unread-count` | any user | one `$queryRaw` COUNT of the user's conversations not left with `lastMessageAt > coalesce(lastReadAt, 'epoch')` | FR-18, NFR-2 |
| GET `/api/messaging/contacts?q=` | any user | listContacts | FR-8 |
| GET `/api/me/messaging-settings` | any user | getSettings | FR-21 |
| PUT `/api/me/messaging-settings` | any user | putSettings | FR-21 |
| GET `/api/safeguarding/reports?status=` | safeguarding lead | listReports | FR-23 |
| GET `/api/safeguarding/reports/:id` | safeguarding lead | getReport (audited) | FR-23, FR-25 |
| PATCH `/api/safeguarding/reports/:id` | safeguarding lead | reviewReport (audited) | FR-23, NFR-11 |
| GET `/api/safeguarding/conversations` | safeguarding lead | searchConversations | FR-24 |
| GET `/api/safeguarding/conversations/:id` | safeguarding lead | getConversationForSafeguarding (audited) | FR-24, FR-25 |
| PATCH `/api/users/:id` (existing) | ADMIN | adds `isSafeguardingLead` | FR-2 |
| POST `/api/internal/email/dispatch` (existing) | CRON_SECRET | adds processPendingMessageEmails | FR-20 |

**Error codes:**

| Case | Response |
|---|---|
| Non-participant, or a participant who has left | 404 NOT_FOUND. The cuid is never treated as authorisation (NFR-1). |
| Contact-rule violation on create | 403 FORBIDDEN, and nothing is created (FR-6). |
| Send after the relationship has ended | 403 FORBIDDEN with `details.reason:'RELATIONSHIP_ENDED'` (FR-7). |
| Edit or delete after 15 minutes | 403 FORBIDDEN with `details.reason:'EDIT_WINDOW_EXPIRED'` (FR-15). |
| Duplicate OPEN report | 409 CONFLICT. |
| Rate limit exceeded | 429 RATE_LIMITED with `details.retryAfterMs`. |
| Not a safeguarding lead | 403 FORBIDDEN. |

### 3.4 Pages

| Route | Kind | Contents | Requirements |
|---|---|---|---|
| `src/app/(app)/messages/layout.tsx` + `page.tsx` + `[conversationId]/page.tsx` | Server shell calling `requirePageUser`. The client renders `MessagesLayout`. | Two panes: the list on the left and the thread on the right. Below 768 px only one pane shows: the list on `/messages`, the thread on `/messages/[id]` with a back `IconButton`. | FR-9, FR-10, NFR-7 |
| `src/app/(app)/admin/safeguarding/page.tsx` | Server, calls `requirePageSafeguardingLead()` | MUI `Tabs`: Reports and Conversations. `?report=<id>` opens the report detail drawer. | FR-23, FR-24 |
| `src/app/(app)/admin/safeguarding/conversations/[id]/page.tsx` | Server, calls the service so the audit is written | Read-only thread showing deleted bodies, each marked as deleted, and edit revisions. | FR-24, FR-25 |
| `src/app/(app)/account/notifications/page.tsx` (edit) | Add `QuietHoursSection` | Two `TextField type="time"` inputs, a Save button and a Clear button. | FR-21 |
| `src/app/(app)/students/[id]/layout.tsx` (**new**) | Server layout that keeps the `[id]` segment name | Loads the viewer's role and the student's linked parents. Renders `StudentMessageActions`, a compact right-aligned action row with no duplicated title, above `children`. | FR-16 |
| `src/app/(app)/courses/[courseId]/roster/page.tsx` (edit) | The TEACHER/ADMIN table moves into a client `RosterTable` with `Checkbox` selection | The toolbar button "Message selected students" opens `NewConversationDialog` prefilled with the selection. `RosterEntry.student.id` already exists. | FR-17 |

### 3.5 Client components: `src/components/messaging/`

This follows the lowercase feature-folder precedent of `gradebook/` and `report-cards/`.

| Component | Built from | Requirements |
|---|---|---|
| `usePolling(fn, ms)` | `setInterval`. Pauses while `document.hidden` and fires immediately on `visibilitychange`. The NotificationBell pattern is copied; NotificationBell itself is not refactored. | FR-13, NFR-8 |
| `ConversationList` | `List`, `ListItemButton`, `UserAvatar`, `Badge`, `Tabs` (Inbox/Archived) and a search `TextField`. Polls every 30 s. | FR-9 |
| `MessageThread` | Day dividers come from `formatInSchoolTz`. Uses `FileList`, an "edited" `Typography`, and "This message was deleted". An `IntersectionObserver` sentinel at the top loads `?before=` and keeps the scroll position stable. Polls `?after=&since=` every 5 s. When new messages arrive and the tab is visible, it posts `/read`. A per-message `Menu` offers edit and delete (own messages within 15 minutes) and report (others' messages); reporting shows the toast "Reported — the school will review this.". | FR-10, FR-13, FR-14, FR-15, FR-22 |
| `Composer` | Multiline `TextField`. Enter sends and Shift+Enter inserts a newline. `FileUpload` with context `'message'`, up to 5 files. A character counter appears above 4,500 characters. When `canSend` is false, the composer is disabled and shows "You can no longer send messages in this conversation." | FR-7, FR-11 |
| `NewConversationDialog` | `Dialog` with `Autocomplete multiple` and `groupBy` over `/api/messaging/contacts` (not `UserPicker`, which ignores contact rules), a subject field (≤120) and the first message. Accepts `initialRecipients`. | FR-12, FR-16, FR-17 |
| `ConversationMenu` | `Menu` with Mute, Archive/Unarchive, View participants (`Dialog`) and Leave group (`ConfirmDialog`). Leave is hidden when `canLeave` is false. | FR-14 |
| `StudentMessageActions` | TEACHER/ADMIN get "Message parents", which opens the dialog prefilled with the linked parents. The button is hidden when the student has no linked parents. PARENT gets "Message teacher", which opens the dialog restricted to the "My child's teachers (<child>)" group. | FR-16 |
| `MessagesNavBadge` | Used by the shell for nav items with `badge: 'messages'`. Polls `/api/messaging/unread-count` every 30 s and renders a `Badge`. | FR-18 |
| `QuietHoursSection` | Inputs as described in §3.4. | FR-21 |
| `SafeguardingReports`, `SafeguardingConversations` | `DataTable` (MUI X DataGrid) plus a detail `Drawer` with Mark reviewed (requires a note) and Dismiss. | FR-23, FR-24 |

### 3.6 Config and shell

- `src/config/navigation.ts`:
  - Add `{ label:'Messages', href:'/messages', icon: ChatBubbleOutline, roles: ALL_ROLES, badge:'messages' }`.
  - Add `{ label:'Safeguarding', href:'/admin/safeguarding', roles:['ADMIN'], requires:'safeguardingLead', group:'Admin' }`.
  - Add `badge?` and `requires?` to `NavItem`.
  - `navigationForRole(role, flags?)` filters out items whose `requires` flag is not set. (FR-18, FR-23)
- `src/app/(app)/layout.tsx` reads `isSafeguardingLead` alongside the existing settings query and passes it to `AppShell`.
- `shell.tsx` renders `MessagesNavBadge` for `badge:'messages'`.

---

## 4. Data Flow

### 4.1 Create conversation (FR-6, FR-12, FR-30)

1. The dialog sends `POST /api/conversations` with `{participantIds, subject, body, fileIds}`.
2. The handler checks `rateLimit('msg:'+uid)` and then calls `validateNewConversation`, which runs one `loadRelations` batch.
3. Any violation returns 403 and nothing is written.
4. Otherwise, one transaction creates the Conversation (`involvesStudent` = any participant is a STUDENT), the participants and the first message, which follows the send steps in §4.2.
5. The response returns `{conversation}`, and the client navigates to `/messages/<id>`.

### 4.2 Send (FR-7, FR-11, FR-19, FR-20, FR-27, FR-31, NFR-4)

1. The composer sends `POST /api/conversations/:id/messages`.
2. The handler checks the rate limit, which may return 429.
3. It loads the participation; a missing participation returns 404.
4. It runs `canSendIn`, which may return 403 RELATIONSHIP_ENDED.
5. It verifies the attachments.
6. The send transaction inserts the message, links the attachments, bumps `lastMessageAt`, sets the sender's `lastReadAt`, and unarchives the conversation for the other participants.
7. The handler returns 201 with `{message}`.
8. After commit, `onMessageSent` runs for each recipient who has not muted or left: delete the old unread `message.received` notification, call `notify` in-app only, and upsert `PendingMessageEmail` (create-only).

### 4.3 Poll and read (FR-13, FR-14, FR-18, NFR-2, NFR-8)

- **Thread.** Every 5 s the thread calls `GET …/messages?after=<lastId>&since=<lastPollIso>`.
  1. The handler does a participant lookup on the unique index.
  2. It loads the cursor message's `createdAt`.
  3. It queries `Message where conversationId AND (createdAt,id) > cursor` on `@@index([conversationId, createdAt])`, with `take 100`.
  4. It queries `changed` = messages with `updatedAt > since` and `createdAt ≤ cursor`, with `take 100`.
  5. When nothing has changed it returns `{messages:[],changed:[]}`. Target: under 100 ms.
- **Mark read.** When messages arrive while the thread is visible, and when a thread is opened, the client sends `POST …/read`. This sets `lastReadAt`, marks that conversation's unread `message.received` notification read, and deletes the `PendingMessageEmail` row.
- **List and badge.** Every 30 s the client calls `GET /api/conversations` and `GET /api/messaging/unread-count`.

### 4.4 Deferred email (FR-20, FR-21)

1. Cron calls `POST /api/internal/email/dispatch`, which runs `processPendingMessageEmails(now)`.
2. For each due row, claim it by deleting it.
3. If the user has read the conversation, muted it or left it, stop there.
4. If the user is in quiet hours (school timezone, ranges may wrap midnight), re-insert the row with `dueAt` = the end of quiet hours.
5. Otherwise call `notify({inApp:false, email})`. `notify()` applies the user's email preference and filters out DISABLED and ARCHIVED users.

### 4.5 Report and safeguarding (FR-22..FR-26, NFR-11)

1. A participant sends `POST /api/messages/:id/report` with `{reason}`. A duplicate OPEN report returns 409.
2. After commit, `notify` sends `message.reported` to the ACTIVE safeguarding leads (mandatory in-app, plus email), linking to `/admin/safeguarding?report=<id>`.
3. A lead opens the report. `requireSafeguardingLead` runs (non-leads get 403), the report detail with ±5 messages loads, and `audit('safeguarding.conversation.view')` is written.
4. Review or dismiss calls `PATCH`, which updates the report and writes `audit('safeguarding.report.review'|'…dismiss')`.
5. Conversation search filters on `involvesStudent=true`. Every view of a conversation writes an audit row.

### 4.6 Attachments (FR-11, FR-27)

1. `FileUpload` with context `'message'` uploads the file, unattached.
2. The send transaction sets `contextId` to the messageId. Files left unattached are purged after 24 h by the existing job.
3. Downloads go through `registerFileAccess('message')`, which allows participants who have not left and safeguarding leads.

---

## 5. Key patterns and constraints

- **Server-side authorisation everywhere (NFR-1).** Every service function takes the `SessionUser` and starts with `getParticipation` or `requireSafeguardingLead`. Nothing trusts IDs sent by the client.
- **One source of truth for contact rules (ADR-3).** Create, send, contacts and the student/roster actions all go through `contact-rules.ts`.
- **After-commit side effects.** `notify()` never throws and is called only after the transaction commits, which matches the platform convention.
- **Scope guard (NFR-9).** Do not add reactions, typing indicators, websockets/SSE, broadcast messaging, E2E encryption or announcements. Leave the behaviour of `student-access.ts` and `UserPicker` unchanged.
- **Logging and time (NFR-6).** Use `logger` only. Store everything in UTC and display it in the school timezone through `src/lib/dates.ts`.

### Tests (NFR-10)

| Kind | File | What it covers |
|---|---|---|
| Unit | `tests/unit/messaging/contact-rules.test.ts` | The full role×role matrix, co-teacher, homeroom in the current year and in a previous year, DROPPED enrollment, a group with a student and no staff, 26 participants, and `canSendIn` after a relationship has ended. |
| Unit | `tests/unit/messaging/quiet-hours.test.ts` | Ranges that wrap midnight, edge minutes, and DST. |
| Integration | `tests/integration/messaging/*.test.ts` | Notification collapsing to one unread row; muted participants skipped; quiet-hours deferral and the read short-circuit in `processPendingMessageEmails`; revision capture on edit; the 15-minute window; rate limit 429; non-participant 404; safeguarding 403 for non-leads; the audit row on view; and 409 on a duplicate report. |
| E2E | `tests/e2e/messaging.spec.ts` | Parent→teacher round trip in two browser contexts, with the message appearing in under 6 s. Student→student is absent from the picker and `POST` returns 403. |
| Suite | — | The existing lint, typecheck and test suites must stay green. |

---

## 6. Requirements Traceability

| Req | Design element |
|---|---|
| FR-1 | §2 models Conversation, ConversationParticipant, Message, MessageAttachment, MessageReport + ReportStatus, MessagingSettings; migration `20261112000000_add_direct_messaging` |
| FR-2 | §2 `User.isSafeguardingLead`; §3.1 users validator/service edit; ADR-11 |
| FR-3 | §2 MessageRevision; edit transaction in `messages.ts` |
| FR-4 | §2 PendingMessageEmail; `email.ts` |
| FR-5 | `contact-rules.ts` `canMessageWith` / `canMessage` |
| FR-6 | `validateNewConversation`; §4.1 |
| FR-7 | `canSendIn`; `getConversation.canSend`; Composer disabled state; §4.2 |
| FR-8 | `contacts.ts`; GET `/api/messaging/contacts` |
| FR-9 | `/messages` pages; `ConversationList`; `listConversations` |
| FR-10 | `MessageThread`; `listMessages?before=`; day grouping in the school timezone |
| FR-11 | `Composer`; `sendMessageSchema`; `constants.ts` |
| FR-12 | `NewConversationDialog`; POST `/api/conversations` |
| FR-13 | `usePolling`; `?after=&since=` (5 s); list and badge (30 s); §4.3 |
| FR-14 | read/mute/archive/leave routes; `ConversationMenu`; leave rules in `conversations.ts` |
| FR-15 | `editMessage`/`deleteMessage` with the 15-minute window; PATCH/DELETE `/api/messages/:id` |
| FR-16 | `students/[id]/layout.tsx` + `StudentMessageActions` |
| FR-17 | Roster `RosterTable` selection + "Message selected students" |
| FR-18 | `navigation.ts` Messages item + `MessagesNavBadge`; GET `/api/messaging/unread-count` |
| FR-19 | `message.received` type; `onMessageSent` collapse + in-app `notify` |
| FR-20 | PendingMessageEmail upsert; `processPendingMessageEmails`; `notify({inApp:false})`; §4.4 |
| FR-21 | MessagingSettings; `/api/me/messaging-settings`; `QuietHoursSection`; `quiet-hours.ts` |
| FR-22 | `reports.ts`; POST `/api/messages/:id/report`; toast copy |
| FR-23 | `/admin/safeguarding` Reports tab; `listReports`/`getReport`/`reviewReport`; `requireSafeguardingLead` |
| FR-24 | Conversations tab; `searchConversations`; `getConversationForSafeguarding`; read-only view page |
| FR-25 | `audit('safeguarding.conversation.view')` in `getReport` and `getConversationForSafeguarding` |
| FR-26 | `message.reported` type; `onMessageReported` |
| FR-27 | `files/contexts.ts` `'message'` resolver; attachment linking in the send transaction |
| FR-28 | §3.3 route table; validators; standard response shapes |
| FR-29 | `prisma/seed.ts` edits (§3.1) |
| FR-30 | `involvesStudent` computed in the create transaction |
| FR-31 | `lastMessageAt` bumped in the send transaction |
| FR-32 | `loadRelations`: `teacherId OR coTeacherIds has` |
| NFR-1 | `access.ts` `getParticipation` (404) / `requireSafeguardingLead` (DB flag); file resolver |
| NFR-2 | `@@index([conversationId, createdAt])`; keyset `after` poll; raw COUNT for unread |
| NFR-3 | Soft delete only; MessageRevision; deleted content visible only through `safeguarding.ts` |
| NFR-4 | `rateLimit('msg:'+uid, 30, 60_000)` on send and create → 429 |
| NFR-5 | §3.5 MUI-only components; mui-mcp lookups required in dev |
| NFR-6 | `src/server/messaging/*`, `src/lib/validators/messaging.ts`, logger, UTC, cuid |
| NFR-7 | `MessagesLayout` single pane below 768 px with back button |
| NFR-8 | 5 s thread poll (≤ ~5 s + request latency < 6 s); no websockets |
| NFR-9 | §5 scope guard |
| NFR-10 | §5 Tests |
| NFR-11 | `audit()` on report review/dismiss and on `isSafeguardingLead` changes |
