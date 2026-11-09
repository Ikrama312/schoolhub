# Coverage Report — SH-13 (PRD-13 Direct Messaging)

- ticketId: SH-13
- timestamp: 2026-11-09T18:03:21Z
- method: **function-level mapping, done by hand.** No coverage provider is installed (`@vitest/coverage-v8` is not in `devDependencies`), and QA did not add a dependency. Each exported function or component below was traced to the tests that execute it.

## Test inventory (SH-13)

| File | Author | Tests | Result |
|---|---|---|---|
| `tests/unit/messaging/contact-rules.test.ts` | Dev | 43 | ✅ 43/43 |
| `tests/unit/messaging/quiet-hours.test.ts` | Dev | 9 | ✅ 9/9 |
| `tests/integration/messaging/messaging.test.ts` | Dev | 9 | ✅ 9/9 |
| `tests/integration/messaging/email.test.ts` | Dev | 4 | ✅ 4/4 |
| `tests/integration/messaging/safeguarding.test.ts` | Dev | 4 | ✅ 4/4 |
| `tests/e2e/messaging.spec.ts` | Dev | 2 | ✅ 2/2 (QA re-ran it on a fresh `next dev -p 3100`) |
| **`tests/integration/messaging/qa-sh13.test.ts`** | **QA (new)** | 12 | ✅ 12/12 |
| **`tests/unit/messaging/composer-qa.test.tsx`** | **QA (new)** | 9 | ✅ 9/9 |
| **Total** | | **92** | **✅ 92/92** |

The integration tests run against the real migrated Postgres. Set `TEST_DATABASE_URL` to the `.env` `DATABASE_URL` to run them.

## Server code (`src/server/messaging/*`): 42 of 46 exported functions executed by tests (≈91%; the other 4 are `canMessage`, `messageableIds`, and the two route/page guards)

| File | Covered | Not covered |
|---|---|---|
| `contact-rules.ts` | `canMessageWith`, `checkNewConversation`, `canSendInWith` (unit). `loadRelations`, `validateNewConversation`, `canSendIn` (integration) | `canMessage` (has no callers in `src/`, so it is dead code). `messageableIds` (only `students/[id]/layout.tsx` uses it, and no test renders that layout) |
| `messages.ts` | `toMessageDTO`, `assertRateLimit`, `listMessages` (`after`/`since` and `before` paging, hasMore, empty poll), `insertMessage` (including attachments), `sendMessage`, `editMessage`, `deleteMessage` | — |
| `conversations.ts` | `listConversations` (tabs, search, preview, unread), `getConversation`, `createConversation`, `markRead`, `setMuted`, `setArchived`, `leave` (all branches), `unreadCount` | — |
| `access.ts` | `getParticipation`, `isSafeguardingLead`, `assertSafeguardingLead` | `requireSafeguardingLead` and `requirePageSafeguardingLead` are covered only by QA's live probes: anonymous API call → 401, anonymous page → 307 to `/login`. No signed-in non-lead route test exists. The service-level 403 is tested. |
| `quiet-hours.ts` | `isInQuietHours`, `quietHoursEnd` (wrap-midnight, DST), `getSettings`, `putSettings` | — |
| `notifications.ts` | `onMessageSent` (collapse, mute, pending email), `onMessageReported` | — |
| `email.ts` | `processPendingMessageEmails` (send, drop on read, drop when muted, quiet-hours deferral) | Two drop branches have no test: participant left, conversation missing |
| `contacts.ts` | `listContacts`: STUDENT, PARENT and TEACHER groups, `?q=` filter, DROPPED exclusion | ADMIN branch (Staff/Students/Parents groups) and the TEACHER homeroom branch |
| `reports.ts` | `reportMessage` (own message 403, duplicate 409, leads notified) | — |
| `safeguarding.ts` | `listReports`, `getReport`, `reviewReport`, `searchConversations`, `getConversationForSafeguarding` (plus the audit rows) | The `from`/`to` date filters in `searchConversations` |
| `src/server/files/contexts.ts` → `messageResolver` | participant, ex-participant, lead, non-lead admin, anonymous (QA) | — |
| `src/server/services/users.ts` (isSafeguardingLead) | `updateUser` ADMIN-only plus audit (Dev safeguarding test) | — |
| `src/lib/validators/messaging.ts` | send/create/report/settings/list-query schemas (QA) | `reviewReportSchema` and `safeguardingConversationsQuery` are tested only indirectly, through the services |

## API route handlers (`src/app/api/{conversations,messages,messaging,safeguarding,me/messaging-settings}`): 15 files

- These are thin `withHandler` wrappers: guard, then Zod parse, then service. No test calls the handlers directly.
- QA confirmed on a live dev server that every handler group returns **401 UNAUTHENTICATED** without a session (conversations, messages POST, unread-count, safeguarding/reports, me/messaging-settings).
- The E2E calls `POST /api/conversations` (403 for student→student) and drives the send and poll routes through the UI.
- **Gap:** there is no handler-level test of the 403 for a signed-in non-lead calling `/api/safeguarding/*`. The service throws that 403 and the service is tested.

## UI (`src/components/messaging/*`, pages): about 25% unit-tested, the rest is E2E-exercised or untested

| Component | Coverage |
|---|---|
| `Composer.tsx` | ✅ Unit (QA): Enter / Shift+Enter, blank, counter >4,500, FR-7 blocked state |
| `MessagesLayout`, `ConversationList`, `MessageThread`, `NewConversationDialog`, `usePolling`, `/messages` pages | E2E only: parent→teacher round trip <6 s, student picker. No unit tests |
| `ConversationMenu`, `MessagesNavBadge`, `StudentMessageActions`, `RosterTable`, `QuietHoursSection`, `SafeguardingReports`, `SafeguardingConversations`, `/admin/safeguarding` pages, `students/[id]/layout.tsx` | **No automated tests.** Verified only by reading the code. Their server logic is covered. |

## Seed (`prisma/seed.ts` `seedMessaging`)

There is no test. The current dev DB has **0 courses**, so only the "Staff room" thread (4 messages) and Alice's `isSafeguardingLead=true` are present. The Pat↔Tom, MATH-7A and reported student threads were skipped by design (`logger.warn`).

## Biggest coverage gaps (suggested next tests)
1. A route-level test that a signed-in non-lead ADMIN gets 403 on `/api/safeguarding/*`.
2. `listContacts` for ADMIN and for homeroom teachers.
3. A component test for `ConversationMenu` (hide Leave when `canLeave` is false) and for `QuietHoursSection`.
4. Run the seed against a DB that has courses, to confirm all four threads and the report.
