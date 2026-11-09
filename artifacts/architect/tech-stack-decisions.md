# Tech Stack Decisions: PRD-12 Announcements & News

Ticket: SH-12 · Phase: architect (arch-research-stack) · Timestamp: 2026-11-09T18:30:00Z · Status: complete

**Base stack (checked against `package.json`).** `artifacts/intake/tech-stack.json` reports `react` at 100% confidence, and the workspace matches it:

- Next.js 14.2.18 App Router, React 18.3.1, TypeScript strict
- Prisma 5.20.0 on PostgreSQL 16, Zod 3.23.8
- MUI 9.5.0: material, icons-material, material-nextjs, x-data-grid, x-date-pickers, x-charts
- react-markdown 10.1.0, rehype-sanitize 6.0.0, remark-gfm 4.0.1
- date-fns 3.6.0, date-fns-tz 3.2.0, papaparse ^5.4.1
- `@react-email/*` and nodemailer

Intake reported no blockers (`blockers: []`, confidence 94%). No NFR calls for a different stack:

- **NFR-2** (feed for a parent with 3 children over 2,000 rows in under 200 ms): one Prisma query with an `EXISTS`-style `some` filter on `AnnouncementAudience`, using indexed columns.
- **FR-27** (exactly-once publish notification): an atomic `updateMany ... where notifiedAt IS NULL` claim inside the existing cron route.

None of this needs a cache, a queue, a job runner or a search engine.

**Overall decision: keep the stack and add no dependencies (NFR-8, NFR-9).**

---

## ADR-1: Keep the existing stack and add no dependencies

**Context.** NFR-8 requires reusing existing services and components. NFR-1 limits UI to MUI. Everything PRD-12 needs is already installed or already in the repo.

**Decision.** Add nothing to `dependencies` or `devDependencies`. Each need maps to something that already exists:

| Need | Use | Req |
|---|---|---|
| Schema and migration | Prisma 5.20 migration: 2 enums and 4 models, plus back-relations on `User` and `FileObject` | FR-1 |
| Validation | Zod schemas in `src/lib/validators/announcements.ts`, shared by the composer form (`react-hook-form` + `@hookform/resolvers`) and the route handlers | FR-2, FR-34 |
| Route handlers | `withHandler`, `ok`, `paginated`, `parsePagination`, `parseBody`, `parseQuery` and `AppError` from `src/server/http.ts` | FR-17, FR-34 |
| Body editing and rendering | `src/components/MarkdownEditor` and `src/components/MarkdownView` (react-markdown + rehype-sanitize) | FR-13, FR-19, NFR-4 |
| Cover image and attachments | `FileUpload` and `FileList`, plus `registerFileAccess('announcement', …)` in `src/server/files/contexts.ts` | FR-13, FR-30 |
| Audience entity pickers | MUI `Autocomplete` (grade, section, course, role) and the existing `UserPicker` where users are involved | FR-13, NFR-1 |
| publishAt and expiresAt inputs | `@mui/x-date-pickers` `DateTimePicker`, converted with `date-fns-tz` in `SchoolSettings.timezone` | FR-13, FR-16, NFR-7 |
| Manage list and recipient table | `src/components/DataTable` | FR-23, FR-24 |
| CSV export | `src/server/csv.ts` | FR-24 |
| Notifications and email | `notify()`, a new type in `src/server/notifications/types.ts`, and the `generic-notification` template | FR-26, FR-27, FR-28 |
| Audit | `audit()` from `src/server/audit.ts` | FR-12 |
| "Acknowledged on 14 Sep" | `formatInSchoolTz` from `src/lib/dates.ts` | FR-20, NFR-7 |
| Toasts and confirmations | `useToast()`, `ConfirmDialog` | NFR-1 |
| Logging | `logger` from `src/lib/logger.ts` | NFR-11 |

**Consequences.** There are no install or lockfile changes, and the banned-library QA check (NFR-1) stays trivially green. All new code goes in `src/server/announcements/`, `src/lib/validators/announcements.ts`, `src/app/(app)/announcements/**`, and `src/app/api/announcements/**` plus `src/app/api/public/news` (FR-36).

---

## ADR-2: Use Prisma relation filters for audience membership, with one shared rule module

**Context.** FR-7 and NFR-2 require membership checks through SQL joins, never by loading all recipients. FR-7 and NFR-10 require `isUserInAudience` and `resolveAudienceUserIds` to agree for every seed user. FR-8 requires the module to be generic so PRD-14 calendar events can reuse it.

**Decision.**

1. `src/server/announcements/audience.ts` defines the audience row shape generically: `{ type, refId, includeStudents, includeParents, includeTeachers }`. It does not import Announcement.
2. The module exports three functions, all built from one per-type rule table so the rules are written once:
   - `resolveAudienceUserIds(audiences)`: per-type Prisma `user.findMany({ where: … , select: { id } })`, unioned into a `Set`.
   - `isUserInAudience(user, audiences)`: the same per-type `where`, AND-ed with `id = user.id`, as a single `count`/`findFirst`.
   - `audienceWhereForUser(user)`: a Prisma `AnnouncementAudience` `where` fragment (an OR over the type branches) for the feed. The feed then runs `announcement.findMany({ where: { audiences: { some: audienceWhereForUser(user) } } })`. The user's context is precomputed once per request with a few indexed lookups: role, grade level, current-year section ids, active course ids, managed course ids, homeroom section, and the same values for each linked child of a parent. The branches then compare `refId` against small id lists.
3. Prisma relation filters (`some`) compile to `EXISTS` subqueries. Use `$queryRaw` only if a measured test misses the 200 ms target. Add a `ponytail:` note at that spot.
4. Indexes in the migration:
   - `AnnouncementAudience(type, refId)`
   - `AnnouncementAudience(announcementId)`
   - `Announcement(status, publishAt)`
   - `Announcement(isPublic, status)`
   - `AnnouncementRead(userId)`, needed because the composite PK `(announcementId, userId)` doesn't serve lookups by `userId` alone (unread-count and the Unread tab)

**Consequences.** There is no raw SQL by default, and the code stays type-safe. The property-style integration test (NFR-10) checks the shared rule table through both entry points. The feed cost does not grow with recipients: a parent with 3 children produces about 6 small `IN` lists.

---

## ADR-3: Decide visibility at read time and send the notification through the existing cron route

**Context.**

- FR-16 and AC-4: a scheduled announcement becomes visible at `publishAt <= now` with no cron involved.
- FR-27: the notification is sent exactly once.
- The maintenance entry point is `POST /api/internal/email/dispatch`. It runs isolated, idempotent passes in `try/catch`, and `src/server/quiz/maintenance.ts` claims work with `updateMany where releasedAt: null`.

**Decision.**

- The visibility predicate is `status IN (PUBLISHED, SCHEDULED) AND publishAt <= now AND (expiresAt IS NULL OR expiresAt > now)`. It is applied in the feed, the detail page, unread-count, public news and the file resolver. A SCHEDULED row whose time has passed is treated as published, so no status flip is needed for visibility.
- `publishDueAnnouncements(now)` lives in `src/server/announcements/maintenance.ts` and is called from the dispatch route as another isolated `try/catch` block. For each due row it claims the row with `updateMany({ where: { id, notifiedAt: null }, data: { notifiedAt: now, status: PUBLISHED } })`. It sends `notify()` only when `count === 1`. Batches are 50 rows, matching `dispatchEmails`.
- Publish-now uses the same claim and then notifies inline. Later audience edits never touch `notifiedAt`, which satisfies FR-29.

**Consequences.** Concurrent cron runs cannot double-notify. No new scheduler is added. Notification latency for scheduled items equals the cron interval, and AC-4 allows this.

---

## ADR-4: Reminder throttle uses an `Announcement.lastRemindedAt` column and 429 RATE_LIMITED

**Context.** FR-25 refuses a second reminder within 24 hours and leaves the status code and storage to the architect. The FR-1 schema has no field for this. `src/server/rate-limit.ts` is per-process and in-memory, so it is the wrong tool for a durable per-announcement business rule. `http.ts` already maps `RATE_LIMITED` to 429.

**Decision.**

- Add a nullable `lastRemindedAt DateTime?` to `Announcement`. This is the only deviation from the FR-1 field list, and intake suggested it.
- Claim the reminder atomically: `updateMany({ where: { id, OR: [{ lastRemindedAt: null }, { lastRemindedAt: { lt: now - 24h } }] }, data: { lastRemindedAt: now } })`.
- If `count === 0`, throw `AppError('RATE_LIMITED', …)`, which returns 429. The details include `retryAfter` (an ISO timestamp).
- Otherwise notify recipients where the resolved audience has no `AnnouncementRead.acknowledgedAt`.

**Consequences.** The rule survives restarts and multiple instances, and it is race-safe. 429 is the right semantic for "try again later". 409 would suggest a state conflict that the user could fix.

---

## ADR-5: Strip Markdown to plain text with a small local helper and no new library

**Context.**

- FR-18 needs a 200-character plain-text excerpt.
- FR-28 needs the first 300 characters of the body as plain text in the email.
- NFR-4 requires sanitisation.
- No Markdown-to-text helper exists in the repo. `remark`/`strip-markdown` are not direct dependencies.

**Decision.** Add `toPlainText(md, max)` in `src/server/announcements/excerpt.ts`. It strips code fences, images, links (keeping the link text), HTML tags, emphasis, heading and list markers with about six regexes, collapses whitespace, and truncates with `…`. Its output is only ever rendered as a React text node or as a react-email text prop, both of which escape it. It is never fed into `dangerouslySetInnerHTML`, so the sanitising boundary stays the escaping renderer. The full body always renders through `MarkdownView` (rehype-sanitize).

**Consequences.** No dependency is added. Unusual Markdown, such as nested reference links, may leave stray characters in excerpts. That is cosmetic only. Mark it with `ponytail:`. If excerpts look wrong, switch to `remark` + `strip-markdown`.

---

## ADR-6: Add a navigation badge as an optional `badge` field on NavItem, polled like NotificationBell

**Context.** FR-32 needs an unread count on the sidebar. `NavItem` has no badge field. `NotificationBell` already polls with MUI `Badge`.

**Decision.**

- Add an optional `badgeEndpoint?: string` to `NavItem`. The Announcements entry sets it to `/api/announcements/unread-count`.
- The sidebar renders MUI `Badge` around the icon and reuses the NotificationBell fetch/poll interval logic, extracted only if it is a direct copy.
- `unread-count` uses the visibility predicate from ADR-3 and `audienceWhereForUser` from ADR-2, plus `reads: { none: { userId } }`.
- The unread dot has visually hidden text "Unread" (NFR-5).

**Consequences.** This is one optional field and one conditional `Badge`, and existing nav items are unaffected.

---

## ADR-7: Security boundaries

**Context.** NFR-3, NFR-6, FR-10, FR-11, FR-30 and FR-31.

**Decision.**

- **Role checks.** Every handler starts with `requireRole`.
- **Teacher audience rules.** These checks live in one function, `assertCanTarget(user, audiences, isPublic)` in `announcements-service.ts`, called from both POST and PATCH. A teacher may target:
  - COURSE, only when `teacherId` or `coTeacherIds` contains the teacher
  - SECTION, only when `homeroomTeacherId` is the teacher

  Any other type, or `isPublic`, returns 403.
- **Non-members.** Detail, ack and stats return 404 to non-members. This avoids leaking that an announcement exists, and it matches the platform convention for hidden resources.
- **File access resolver.** Anonymous access is allowed only for `isPublic && visible(now)`. Everyone else goes through `isUserInAudience`, the author check or the ADMIN check.
- **Public route.** `/api/public/news` is added to `PUBLIC_API_PATHS`. It selects only public-safe fields: no audience, no author email.

**Consequences.** One choke point governs targeting rules, so the unit tests (NFR-10) cover it directly.

---

## Open items handed to arch-design-system

These come from the intake defaults, and the stack decisions don't change them:

- FR-5: section membership means current academic year.
- FR-15: drafts may have zero recipients.
- FR-17: pins beyond 3 flow into newest-first order.
- FR-12: archive is terminal for authors.
- AC-8: the fixture creates Pat's 6A child.
