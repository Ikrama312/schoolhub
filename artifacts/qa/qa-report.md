# QA Report — SH-13 (PRD-13 Direct Messaging)

## QA Summary

- ticketId: SH-13
- timestamp: 2026-11-09T18:05:00Z
- overallStatus: PARTIAL
- requirementsChecked: 43
- requirementsPassed: 42
- requirementsFailed: 1

> This file replaces the stale SH-11 QA report.
>
> **All 32 functional requirements pass, and 10 of 11 non-functional requirements pass. All 92 SH-13 tests pass:** 71 by Dev, re-run by QA, plus 21 new QA tests. That covers unit tests, integration tests on real Postgres, and the Playwright E2E, which QA re-ran on a fresh dev server.
>
> **One failure: NFR-10, "the existing test suite stays green."** The full `vitest run` is **505/510**: 5 tests fail and 1 file does not load. **All six were already failing before SH-13.** They are the same items recorded in the SH-11 QA report, and none of those test files import messaging code. **SH-13 did not cause any regression.** The suite was already red before this ticket.

## Requirement Results

| Requirement | Status | Evidence |
|---|---|---|
| FR-1 | PASS | `prisma/schema.prisma` (Conversation, ConversationParticipant, Message with `@@index([conversationId, createdAt])`, MessageAttachment, MessageReport, MessagingSettings, enum ReportStatus; cascades). Migration `20261112000000_add_direct_messaging` is applied. All integration suites run on it. |
| FR-2 | PASS | `src/lib/validators/users.ts` and `src/server/services/users.ts`. `safeguarding.test.ts` "FR-2: isSafeguardingLead can only be set on an ADMIN, and the change is audited". The flag can be edited through `PATCH /api/users/:id` only. No admin user form exists (ADR-11, accepted at intake). |
| FR-3 | PASS | `messages.ts` `editMessage` (revision written in a transaction). `messaging.test.ts` "FR-3/FR-15: edit stores a revision…" |
| FR-4 | PASS | `PendingMessageEmail` with `@@unique([userId, conversationId])`. `messaging.test.ts` FR-19/FR-20 (one pending row). `email.test.ts` (4 tests). |
| FR-5 | PASS | `contact-rules.ts` `canMessageWith`/`canMessage`. `contact-rules.test.ts`: 43-case role×role matrix. `qa-sh13.test.ts` "FR-6: parent→parent and student→parent are refused". |
| FR-6 | PASS | `validateNewConversation`. `messaging.test.ts` "student↔student is 403". `qa-sh13.test.ts` "nothing is created", ">25 participants rejected", "students in a staff-created group can reply". E2E "student → student… returns 403". |
| FR-7 | PASS | `canSendIn` and `sendMessage` (`RELATIONSHIP_ENDED`). `messaging.test.ts` "a dropped student cannot send but the teacher still can". `composer-qa.test.tsx` checks that the exact message "You can no longer send messages in this conversation." is shown. |
| FR-8 | PASS | `contacts.ts`. `qa-sh13.test.ts` "FR-8: contacts are grouped, labelled…": My teachers, My child's teachers (child), Students in X, Parents of students in X, School office, `?q=`, DROPPED excluded. |
| FR-9 | PASS | `listConversations` and `ConversationList.tsx`/`MessagesLayout.tsx`. `qa-sh13.test.ts` "FR-31/FR-9" (sort, "sender: text" preview, unread, search by subject/name) and "FR-14/FR-18" (Inbox/Archived tabs). |
| FR-10 | PASS | `MessageThread.tsx`: day groups via `formatInSchoolTz`, FileList, "(edited)", `DELETED_TEXT`, IntersectionObserver `?before=`. `qa-sh13.test.ts` "older pages load 30 at a time". `messaging.test.ts` (redacted delete). |
| FR-11 | PASS | `Composer.tsx`. `composer-qa.test.tsx`: Enter sends, Shift+Enter does not, counter only after 4,500, body 1–5,000, ≤5 files. `qa-sh13.test.ts` FR-27 checks `context: 'message'` file linking. |
| FR-12 | PASS | `NewConversationDialog.tsx`, fed by `/api/messaging/contacts`. `composer-qa.test.tsx` (subject ≤120, dedup). E2E parent→teacher round trip uses the dialog. |
| FR-13 | PASS | `THREAD_POLL_MS=5000` (`MessageThread.tsx`), `LIST_POLL_MS=30000` (`ConversationList.tsx`, `MessagesNavBadge.tsx`). `messaging.test.ts` "after+since poll". E2E round trip <6 s. |
| FR-14 | PASS | `conversations.ts` markRead/setMuted/setArchived/leave and `ConversationMenu.tsx`. `qa-sh13.test.ts` "read clears unread + notification + pending email; archive moves tabs; mute is per user" and "leave rules". |
| FR-15 | PASS | `loadOwnEditable` (15-minute window, soft delete only). `messaging.test.ts` "FR-3/FR-15…15-minute window; soft delete". |
| FR-16 | PASS | `src/app/(app)/students/[id]/layout.tsx` and `StudentMessageActions.tsx`: "Message parents" for staff, through `messageableIds`; "Message teacher" for linked parents. Verified by reading the code only. No automated test (see coverage report). |
| FR-17 | PASS | `courses/[courseId]/roster/RosterTable.tsx`: checkbox selection plus "Message selected students". PARENT gets 404 and STUDENT gets a separate view in `page.tsx`. Verified by reading the code only. No automated test. |
| FR-18 | PASS | `src/config/navigation.ts` (Messages, ALL_ROLES, badge), `shell.tsx`, `MessagesNavBadge.tsx`. `qa-sh13.test.ts` checks that `unreadCount` drops after read. A live probe of `/api/messaging/unread-count` without a session returns 401. |
| FR-19 | PASS | `notifications.ts` `onMessageSent` and `types.ts` (`message.received`, COMMUNICATION, email true). `messaging.test.ts` "three sends leave one unread notification" and "muted get no notification". |
| FR-20 | PASS | `email.ts` `processPendingMessageEmails`, hooked into the dispatch route. `email.test.ts`: sent when unread, dropped when read or muted, deferred to the end of quiet hours. |
| FR-21 | PASS | `QuietHoursSection.tsx` on `/account/notifications` and `/api/me/messaging-settings`. `qa-sh13.test.ts` "quiet-hours settings round trip…". `quiet-hours.test.ts` (wrap and DST). |
| FR-22 | PASS | `reports.ts`, `/api/messages/[id]/report`. `MessageThread.tsx` toast "Reported — the school will review this.". `composer-qa.test.tsx` (reason 1–1,000). `messaging.test.ts` "duplicate OPEN report is 409; own message 403". |
| FR-23 | PASS | `safeguarding.ts` listReports (OPEN first)/getReport (±5 context)/reviewReport and `SafeguardingReports.tsx`. `safeguarding.test.ts` "non-lead admins and teachers get 403" and "review needs a note; handled is 409". |
| FR-24 | PASS | `searchConversations` and `getConversationForSafeguarding`. `safeguarding.test.ts` "student conversations only; deleted body and revisions visible". |
| FR-25 | PASS | `viewAudit` in `safeguarding.ts`. `safeguarding.test.ts` "every view audited" and "report detail is audited". |
| FR-26 | PASS | `onMessageReported` and `types.ts` (`message.reported`, mandatoryInApp, email true, ADMIN). `messaging.test.ts` "leads are notified". |
| FR-27 | PASS | `src/server/files/contexts.ts` `messageResolver`. `qa-sh13.test.ts` "FR-27": participant ✓, lead ✓, non-lead admin ✗, non-participant ✗, anonymous ✗, re-attach refused. |
| FR-28 | PASS | 15 route files under `src/app/api/{conversations,messages,messaging,safeguarding,me/messaging-settings}` built on `withHandler` and Zod. A live probe of each group without a session returns 401 `UNAUTHENTICATED` in the standard error shape. The services behind them are covered by the integration suites. |
| FR-29 | PASS | `prisma/seed.ts` `seedMessaging`: Alice is the lead, plus four threads with the specified message counts and one OPEN report, each checked against the contact rules. Dev DB: Alice `isSafeguardingLead=true` and "Staff room" (4 msgs) are present. The course-dependent threads are skipped because the dev DB has 0 courses, which is the designed `logger.warn` behaviour. |
| FR-30 | PASS | `validateNewConversation` → `involvesStudent`. `messaging.test.ts` "FR-30/A11". `qa-sh13.test.ts` FR-32 (`involvesStudent` is true). |
| FR-31 | PASS | `insertMessage` updates `lastMessageAt`. `qa-sh13.test.ts` "send bumps lastMessageAt". |
| FR-32 | PASS | `loadRelations`/`contacts.ts` use `coTeacherIds`. `qa-sh13.test.ts` "a co-teacher manages the course" and "unrelated teacher 403". |
| NFR-1 | PASS | `access.ts` `getParticipation` (404 for non-participants and leavers) and `assertSafeguardingLead` (fresh DB read). `messaging.test.ts` "non-participants and participants who left get 404". `safeguarding.test.ts` 403s. `qa-sh13.test.ts` "ex-participant 404". Live probes: every API returns 401 anonymously, and `/admin/safeguarding` redirects to `/login` (307). |
| NFR-2 | PASS | `qa-sh13.test.ts` "NFR-2: an 'after' poll with nothing new returns empty arrays, quickly" (<100 ms at the service level against local Postgres). Keyset query on `(conversationId, createdAt)`. |
| NFR-3 | PASS | No user-facing hard delete: `deleteMessage` sets `deletedAt`, and `editMessage` writes a `MessageRevision`. `safeguarding.test.ts` "deleted body and revisions visible". See observation O-1. |
| NFR-4 | PASS | `assertRateLimit` (reuses `src/server/rate-limit.ts`). `messaging.test.ts` "the 31st message in a minute is 429 RATE_LIMITED". |
| NFR-5 | PASS | QA scan: the messaging UI's only non-MUI third-party import is `date-fns`, a utility that renders nothing. No Tailwind, shadcn, Radix or notistack anywhere in `src`. All 58 MUI modules used (`@mui/material/*`, `@mui/icons-material/*`, `@mui/x-data-grid`) are standard documented exports and resolve under `tsc`. QA cannot independently verify that mui-mcp was consulted. `dev-log.md` records the lookups. |
| NFR-6 | PASS | `src/lib/validators/messaging.ts` and services in `src/server/messaging/`. Thin `withHandler` routes. No `console.log` in messaging code (grep). UTC storage with `formatInSchoolTz` for display. |
| NFR-7 | PASS | `MessagesLayout.tsx` `useMediaQuery(theme.breakpoints.down(768))` gives a single pane with back navigation. Verified by reading the code. No viewport test exists. |
| NFR-8 | PASS | E2E `messaging.spec.ts` "parent → teacher round trip appears in the other open thread within 6 s", re-run by QA (✓ 25.6 s total). No websocket code (grep). |
| NFR-9 | PASS | Grep of messaging server and UI code: no websocket, typing, reaction or WebRTC code, and no broadcast feature. No files outside the ownership matrix were changed for this feature. |
| NFR-10 | **FAIL** | SH-13's own test requirements are met: the contact matrix, notification collapse, quiet-hours deferral and edit revision tests all exist and pass, as do both Playwright scenarios. Lint ✅ and typecheck ✅. **The "existing suite stays green" clause fails.** The full run is 505/510, and `lockout.test.ts` does not load. All are pre-existing (see Headline 1). |
| NFR-11 | PASS | `reviewReport` audits `safeguarding.report.{review,dismiss}`. `updateUser` audits the flag change. `safeguarding.test.ts` "FR-23/NFR-11" and "FR-2… audited". |

## Headline findings

### 1. Full suite not green. All failures predate SH-13 (NFR-10)
| Failing test | Status |
|---|---|
| `attendance-qa.test.ts` FR-22, FR-10/FR-19 | Pre-existing (in the SH-9, SH-10 and SH-11 lists) |
| `auth.test.ts` "rate limits after 10 attempts per IP" (timeout) | Pre-existing, flaky (SH-11 list) |
| `auth-forms.test.tsx` ForgotPasswordForm focus | Pre-existing (SH-11 list) |
| `useToast.test.tsx` auto-hide | Pre-existing (SH-11 list) |
| `lockout.test.ts` (file fails to load, next-auth ESM) | Pre-existing (SH-11 list) |

None of these files import messaging code. The SH-11 regression in `qa-sh9.test.ts` passed in this run.

### 2. No SH-13 defects found
QA found no stubs, `TODO`s or placeholder logic in any of the 67 owned files. All of them exist and are non-empty.

## Observations (non-blocking)
- **O-1 (NFR-3, low):** `Message.sender` is `onDelete: Cascade`. If a User row were ever hard-deleted, that user's messages and revisions would be deleted with it. No code in `src/` hard-deletes users today (users are archived). Consider `Restrict` if retention must hold against DB-level deletes.
- **O-2:** `canMessage()` in `contact-rules.ts` is exported but nothing calls it. Every caller uses `canMessageWith` or `messageableIds`. Delete it, or keep it as the documented FR-5 entry point.
- **O-3:** `unreadCount` (the sidebar badge) includes muted conversations. The PRD does not specify this. Product should confirm the behaviour.
- **O-4:** FR-16, FR-17, NFR-7 and the safeguarding/quiet-hours UIs have no automated UI tests. They were verified by reading the code. See `coverage-report.md` for suggested tests.
- **O-5:** The FR-29 seed could not be fully verified on the dev DB because it has 0 courses. Re-seed a DB with courses to confirm the Pat↔Tom, MATH-7A and reported threads.

## Gates run by QA
| Check | Result |
|---|---|
| `npm run typecheck` | ✅ clean (including the QA test files) |
| `npm run lint` | ✅ no warnings or errors |
| SH-13 unit plus integration (`TEST_DATABASE_URL` = dev DB) | ✅ 90/90 (Dev 69 + QA 21) |
| E2E `tests/e2e/messaging.spec.ts` (`APP_URL=http://localhost:3100`, fresh `next dev`) | ✅ 2/2. The server was stopped afterwards. |
| Anonymous probes of 9 messaging/safeguarding endpoints and 1 page | ✅ 401 `UNAUTHENTICATED` / 307 → `/login` |
| Full `vitest run` | ❌ 505/510 plus 1 file load error, all pre-existing (Headline 1) |
| Ownership matrix (67 files) | ✅ all present and non-stub |

## QA test files added
- `tests/integration/messaging/qa-sh13.test.ts`: 12 tests covering FR-6/8/9/10/14/18/21/27/31/32 and NFR-2.
- `tests/unit/messaging/composer-qa.test.tsx`: 9 tests covering the FR-11 composer, the FR-7 blocked state, and the FR-11/12/21/22 validators.

QA changed no product code.
