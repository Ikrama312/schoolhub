# Dev Log — SH-13 (PRD-13 Direct Messaging)

> Before this run, this file held the SH-11 log and `task-completion-markers.json` held SH-11's markers. Following the established precedent, both were replaced for SH-13. This is SH-13's first dev iteration.
> `dev-rerun-count.json` was left untouched because the engine owns it.

## Iteration 1 (2026-11-09)

All 27 tasks in `implementation-plan.json` were implemented in dependency order, at the exact paths in `file-ownership-matrix.json`. The `mui-mcp` server was reachable: `useMuiDocs` and `fetchDocs` for `@mui/material@9.5.0` (Autocomplete, useMediaQuery) were checked before any UI was written (NFR-5).

### Checklist
- TASK-1: Prisma models + migration 20261112000000_add_direct_messaging (applied, client generated) — ✓ complete
- TASK-2: Messaging constants + Zod validators — ✓ complete
- TASK-3: contact-rules.ts + role×role unit matrix — ✓ complete
- TASK-4: access.ts (getParticipation, safeguarding guards) — ✓ complete
- TASK-5: message.received / message.reported types + NotifyInput.inApp — ✓ complete
- TASK-6: quiet-hours.ts + unit tests (wrap, edges, DST) — ✓ complete
- TASK-7: messaging notifications, deferred email worker, dispatch hook — ✓ complete
- TASK-8: messages.ts (keyset list, send, edit, soft delete) — ✓ complete
- TASK-9: conversations.ts (list, create, get, read, mute, archive, leave, unread count) — ✓ complete
- TASK-10: 'message' file-access context — ✓ complete
- TASK-11: contacts.ts grouped contacts — ✓ complete
- TASK-12: reports.ts + safeguarding.ts — ✓ complete
- TASK-13: Conversation API routes — ✓ complete
- TASK-14: Message, messaging and settings API routes — ✓ complete
- TASK-15: Safeguarding API routes — ✓ complete
- TASK-16: isSafeguardingLead in users validator/service — ✓ complete
- TASK-17: Seed (safeguarding lead, Pat↔Sam link, 4 idempotent threads) — ✓ complete
- TASK-18: usePolling, MessagesLayout, ConversationList — ✓ complete
- TASK-19: MessageThread, Composer, ConversationMenu — ✓ complete
- TASK-20: NewConversationDialog — ✓ complete
- TASK-21: /messages pages — ✓ complete
- TASK-22: Navigation, unread badge, safeguarding nav flag — ✓ complete
- TASK-23: Student layout actions + roster RosterTable selection — ✓ complete
- TASK-24: QuietHoursSection on /account/notifications — ✓ complete
- TASK-25: Safeguarding page, conversation view, reports/conversations components — ✓ complete
- TASK-26: Integration tests (messaging, email, safeguarding) — ✓ complete
- TASK-27: Playwright E2E messaging.spec.ts — ✓ complete

### Verification
- `tsc --noEmit`: clean. `next lint`: clean.
- New unit tests: `tests/unit/messaging/*`, 52 passing.
- New integration tests: `tests/integration/messaging/*`, 17 passing against the local migrated Postgres (`TEST_DATABASE_URL` = dev DB; fixtures are tagged and removed afterwards).
- E2E: `tests/e2e/messaging.spec.ts`, 2/2 passing against `next dev -p 3100`. The parent→teacher message appeared within the 6 s limit.
- Full `vitest run`: 484 passed, 5 failed. None of the 5 are in messaging code. 4 fail identically on a clean HEAD worktree: `lockout.test.ts` (next-auth import under vitest), `attendance-qa.test.ts` ×2, `useToast.test.tsx` and `auth-forms.test.tsx`. `assignments/qa-sh9.test.ts` passes when run on its own on both HEAD and this branch, so it is flaky when the full suite runs in parallel.
- `npm run db:seed` ran cleanly. The dev DB has no courses or sections, so the Pat↔Tom, MATH-7A group and student↔teacher (reported) threads were skipped with `logger.warn`, as designed: the seed never forces data that breaks the contact rules. Tina↔Tom was created and Alice is set as the safeguarding lead.

### Notes, deviations and gaps
- **Owned route not editable (TASK-16).** `PATCH /api/users/:id` (`src/app/api/users/[id]/route.ts`) is not in the ownership matrix. `updateUser` now rejects the flag on non-ADMIN users (400 `SAFEGUARDING_LEAD_REQUIRES_ADMIN`) and writes a `user.update` audit row with `{ isSafeguardingLead: { old, new } }`. It accepts an optional `{ actorId }`, but the existing route does not pass one yet, so that row has `actorId = null`. The route's own `user.updated` row still records the actor and the changed field. Follow-up: pass `{ actorId: actor.id }` in the route (one line).
- **access.ts** imports `requireRole`/`next/navigation` lazily inside the route and page guards. Without that, every messaging service pulled in next-auth, and the services could not be imported in vitest.
- **Safeguarding tables** use MUI X `DataGrid` directly instead of the shared `DataTable`. `DataTable` always renders a URL-driven `q` search box, and neither safeguarding endpoint supports one. The participant filter reuses `UserPicker`, which is fine for staff-only admin search; the contact-rule concern applies only to the messaging picker.
- **`SafeguardingTabs`** (the Reports/Conversations tab switch) and **`SafeguardingThreadView`** (the read-only renderer shared by the drawer and the conversation page) are exported from the owned `SafeguardingReports.tsx` and `SafeguardingConversations.tsx`. No extra files were added.
- **ADMIN contacts:** besides "Staff" and "School office", admins get "Students" and "Parents" groups (search-driven, capped at 50), because ADMIN may message anyone (FR-5).
- **Teacher homeroom group:** "Homeroom <section>" lists the homeroom students and their linked parents together.
- **Contact rules:** courses with `archivedAt` set do not count as a live relationship.
- **Deferred email content:** the email never includes message text. It says there are unread messages and links to the conversation.
- **Environment:** a stale `next-server` (13 days old) was already listening on :3000 and returning 500s. It was left running; E2E ran on :3100 instead.
