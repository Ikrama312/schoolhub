# File Structure — SH-13 Direct Messaging

Phase: dev-planning · 2026-11-09T23:10:00Z

67 files: 54 CREATE, 13 MODIFY, 0 DELETE. Generated from the same table as `implementation-plan.json` and `file-ownership-matrix.json`.

```
prisma/
  └─ schema.prisma  [MODIFY · TASK-1]
  └─ seed.ts  [MODIFY · TASK-17]
prisma/migrations/20261112000000_add_direct_messaging/
  └─ migration.sql  [CREATE · TASK-1]
src/app/(app)/
  └─ layout.tsx  [MODIFY · TASK-22]
  └─ shell.tsx  [MODIFY · TASK-22]
src/app/(app)/account/notifications/
  └─ page.tsx  [MODIFY · TASK-24]
src/app/(app)/admin/safeguarding/
  └─ page.tsx  [CREATE · TASK-25]
src/app/(app)/admin/safeguarding/conversations/[id]/
  └─ page.tsx  [CREATE · TASK-25]
src/app/(app)/courses/[courseId]/roster/
  └─ RosterTable.tsx  [CREATE · TASK-23]
  └─ page.tsx  [MODIFY · TASK-23]
src/app/(app)/messages/
  └─ layout.tsx  [CREATE · TASK-21]
  └─ page.tsx  [CREATE · TASK-21]
src/app/(app)/messages/[conversationId]/
  └─ page.tsx  [CREATE · TASK-21]
src/app/(app)/students/[id]/
  └─ layout.tsx  [CREATE · TASK-23]
src/app/api/conversations/
  └─ route.ts  [CREATE · TASK-13]
src/app/api/conversations/[id]/
  └─ route.ts  [CREATE · TASK-13]
src/app/api/conversations/[id]/archive/
  └─ route.ts  [CREATE · TASK-13]
src/app/api/conversations/[id]/leave/
  └─ route.ts  [CREATE · TASK-13]
src/app/api/conversations/[id]/messages/
  └─ route.ts  [CREATE · TASK-13]
src/app/api/conversations/[id]/mute/
  └─ route.ts  [CREATE · TASK-13]
src/app/api/conversations/[id]/read/
  └─ route.ts  [CREATE · TASK-13]
src/app/api/internal/email/dispatch/
  └─ route.ts  [MODIFY · TASK-7]
src/app/api/me/messaging-settings/
  └─ route.ts  [CREATE · TASK-14]
src/app/api/messages/[id]/
  └─ route.ts  [CREATE · TASK-14]
src/app/api/messages/[id]/report/
  └─ route.ts  [CREATE · TASK-14]
src/app/api/messaging/contacts/
  └─ route.ts  [CREATE · TASK-14]
src/app/api/messaging/unread-count/
  └─ route.ts  [CREATE · TASK-14]
src/app/api/safeguarding/conversations/
  └─ route.ts  [CREATE · TASK-15]
src/app/api/safeguarding/conversations/[id]/
  └─ route.ts  [CREATE · TASK-15]
src/app/api/safeguarding/reports/
  └─ route.ts  [CREATE · TASK-15]
src/app/api/safeguarding/reports/[id]/
  └─ route.ts  [CREATE · TASK-15]
src/components/messaging/
  └─ Composer.tsx  [CREATE · TASK-19]
  └─ ConversationList.tsx  [CREATE · TASK-18]
  └─ ConversationMenu.tsx  [CREATE · TASK-19]
  └─ MessageThread.tsx  [CREATE · TASK-19]
  └─ MessagesLayout.tsx  [CREATE · TASK-18]
  └─ MessagesNavBadge.tsx  [CREATE · TASK-22]
  └─ NewConversationDialog.tsx  [CREATE · TASK-20]
  └─ QuietHoursSection.tsx  [CREATE · TASK-24]
  └─ SafeguardingConversations.tsx  [CREATE · TASK-25]
  └─ SafeguardingReports.tsx  [CREATE · TASK-25]
  └─ StudentMessageActions.tsx  [CREATE · TASK-23]
  └─ usePolling.ts  [CREATE · TASK-18]
src/config/
  └─ navigation.ts  [MODIFY · TASK-22]
src/lib/messaging/
  └─ constants.ts  [CREATE · TASK-2]
src/lib/validators/
  └─ messaging.ts  [CREATE · TASK-2]
  └─ users.ts  [MODIFY · TASK-16]
src/server/files/
  └─ contexts.ts  [MODIFY · TASK-10]
src/server/messaging/
  └─ access.ts  [CREATE · TASK-4]
  └─ contact-rules.ts  [CREATE · TASK-3]
  └─ contacts.ts  [CREATE · TASK-11]
  └─ conversations.ts  [CREATE · TASK-9]
  └─ email.ts  [CREATE · TASK-7]
  └─ messages.ts  [CREATE · TASK-8]
  └─ notifications.ts  [CREATE · TASK-7]
  └─ quiet-hours.ts  [CREATE · TASK-6]
  └─ reports.ts  [CREATE · TASK-12]
  └─ safeguarding.ts  [CREATE · TASK-12]
src/server/notifications/
  └─ notify.ts  [MODIFY · TASK-5]
  └─ types.ts  [MODIFY · TASK-5]
src/server/services/
  └─ users.ts  [MODIFY · TASK-16]
tests/e2e/
  └─ messaging.spec.ts  [CREATE · TASK-27]
tests/integration/messaging/
  └─ email.test.ts  [CREATE · TASK-26]
  └─ messaging.test.ts  [CREATE · TASK-26]
  └─ safeguarding.test.ts  [CREATE · TASK-26]
tests/unit/messaging/
  └─ contact-rules.test.ts  [CREATE · TASK-3]
  └─ quiet-hours.test.ts  [CREATE · TASK-6]
```

Notes:
- `src/app/(app)/students/[id]/` keeps the `[id]` segment (PRD forbids renaming routes).
- `src/app/api/messages/[id]` and `src/app/api/conversations/[id]` are the only dynamic segments at their levels — no Next.js slug conflicts.
- `RosterTable.tsx` is colocated with the roster page (same pattern as `account/notifications/PreferencesTable.tsx`).
- No new dependencies. No DELETE operations.
