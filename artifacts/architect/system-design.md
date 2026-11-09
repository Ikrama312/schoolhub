# System Design: PRD-12 Announcements & News

Ticket: **SH-12** · Phase: architect (`arch-design-system`) · Timestamp: 2026-11-09T19:00:00Z · Status: **complete**

Inputs: `artifacts/intake/requirements.json` (36 FR, 11 NFR, 94% confidence), `artifacts/intake/handoff-to-architect.json`, `artifacts/architect/tech-stack-decisions.md` (ADR-1..7), `artifacts/architect/requirements-analysis-notes.md` (B1–B22, R1–R11, A1–A8), and the FR-1 Prisma block in `12-announcements.md`.

> This file replaces the SH-11 version that was here before.

---

## 1. Overview

Announcements is a brownfield feature inside the existing Next.js 14 App Router + Prisma/PostgreSQL + MUI 9 app. **No new dependencies** (ADR-1). The work is:

- one Prisma migration (FR-1)
- a generic **audience service** (FR-3..FR-8)
- an **announcements service** with permissions, visibility, publishing, stats and reminders (FR-9..FR-31)
- 12 thin route handlers (FR-34)
- 6 pages plus a course tab, a nav badge and seed data (FR-13..FR-35)

The two design centres are:

1. **One set of audience rules, three consumers.** A per-user `AudienceKeys` set drives a pure matcher (`isUserInAudience`), a Prisma `where` fragment (feed, unread-count), and the inverse `resolveAudienceUserIds` expansion (preview, stats, notify). The read path never expands recipients (NFR-2).
2. **Visibility is decided at read time.** One `visibleWhere(now)` predicate is used everywhere. The cron only sends the one notification, claiming `notifiedAt` atomically (FR-16, FR-27).

### Blockers from intake

`handoff-to-architect.json` reports **`blockers: []`**. There are no blockers to surface.

### Assumptions and decisions carried into the design

| # | Item | Decision | Req |
|---|---|---|---|
| A1 | Section membership scope | `SectionMember` rows of the targeted section. A section belongs to one academic year, so this is the current-year membership whenever the section is current. Composer pickers offer only current-year sections. | FR-5 |
| A2 | Zero-recipient drafts | Allowed. The zero-recipient refusal (`VALIDATION_ERROR`) runs only on the transition to PUBLISHED or SCHEDULED. | FR-15 |
| A3 | Parent expansion | Parents are reached only through ACTIVE, non-archived students. The ACTIVE/non-archived filter is applied to every final user. The matcher follows the same rule. | FR-3..FR-6 |
| A4 | Pins beyond 3 | The 3 newest pinned items go on top of page 1. Any further pinned items fall into newest-first order. | FR-17 |
| A5 | AC-8 fixture | The seed stays skip-if-missing. The integration/e2e fixture creates Pat's 6A child and the `ParentStudentLink`. | FR-22, FR-35, NFR-10 |
| A6 | Archived courses | Courses with `archivedAt != null` are excluded from every teacher branch and from the COURSE student branch. Not stated in the PRD, so flagged here. | FR-4..FR-6 |
| A7 | Archive is terminal | Archive is terminal for authors: PATCH on an ARCHIVED row by a non-admin returns 409 CONFLICT. Admins may still edit. | FR-12 |
| A8 | Reminder throttle | Nullable `Announcement.lastRemindedAt` column. A refused reminder returns **429 RATE_LIMITED** with `details.retryAfter` (ADR-4). | FR-25 |
| A9 | `mandatoryInApp` per instance | `NOTIFICATION_TYPES` is static (B9). Keep the **single type key `announcement.published`** with `mandatoryInApp: false`, and add an optional `mandatoryInApp?: boolean` override to `NotifyInput`. `notify()` passes `{ ...def, mandatoryInApp: input.mandatoryInApp ?? def.mandatoryInApp }` to `resolvePrefs`. Announcements set it to `requiresAck`. This is a one-line change to a shared function, and it keeps the type name exactly as FR-26 states. The rejected alternative was a second `announcement.published_ack` type. | FR-26 |
| A10 | Non-member responses | Detail, ack, stats and remind return **404 NOT_FOUND** to callers who are not allowed to see the announcement, so its existence is not leaked. Targeting violations on create/update/preview return **403 FORBIDDEN** (AC-3). | NFR-3, NFR-6, FR-10 |
| A11 | Publish timestamp | Publish-now sets `publishAt = now`, so one column orders the feed and drives visibility (R4). | FR-16, FR-17 |

### Deliberate additions to the FR-1 schema

FR-1 says "exactly as specified". These additions are the minimum the other requirements force, and each is listed with its reason:

- `Announcement.lastRemindedAt DateTime?`: needed by FR-25 (A8). Intake pre-approved it.
- Indexes: `AnnouncementAudience @@index([announcementId])` and `@@index([type, refId])`, `Announcement @@index([status, publishAt])`, `@@index([authorId])`, `@@index([isPublic, status])`, and `AnnouncementRead @@index([userId])`. These serve NFR-2.
- Back-relations needed for Prisma to compile: `User.announcements Announcement[]`, `FileObject.announcementAttachments AnnouncementAttachment[]`. `AnnouncementRead.user` is a relation to `User` (`User.announcementReads`, cascade on user delete is not used; users are archived, not deleted) so the stats table can join names.

Everything else matches the PRD block field for field. That includes `coverFileId` as a plain scalar with no FK relation, and `AnnouncementAudience` having no timestamps.

---

## 2. Component Breakdown

### 2.1 Data layer: `prisma/schema.prisma` + `prisma/migrations/20261112000000_add_announcements/` (FR-1)

```prisma
enum AnnouncementStatus { DRAFT SCHEDULED PUBLISHED ARCHIVED }
enum AudienceType { SCHOOL STAFF ROLE GRADE_LEVEL SECTION COURSE }

model Announcement {
  // ...PRD fields verbatim...
  lastRemindedAt DateTime?                       // FR-25 addition
  @@index([status, publishAt])
  @@index([authorId])
  @@index([isPublic, status])
}
model AnnouncementAudience { /* PRD verbatim */ @@index([announcementId]) @@index([type, refId]) }
model AnnouncementAttachment { /* PRD verbatim */ @@index([announcementId]) }
model AnnouncementRead {
  /* PRD verbatim */
  user User @relation(fields: [userId], references: [id])
  @@index([userId])
}
```

### 2.2 Validation: `src/lib/validators/announcements.ts` (FR-2, FR-34)

This module is isomorphic: it is used by both the composer form (react-hook-form + zodResolver) and the handlers.

- `audienceRowSchema`: `{ type, refId?, includeStudents, includeParents, includeTeachers }`, with these refinements:
  - `refId` is required unless the type is SCHOOL or STAFF.
  - For ROLE, `refId` must be a `Role` value.
  - For GRADE_LEVEL, SECTION and COURSE, at least one include flag must be true.
- `announcementInputSchema`, with these fields:
  - `title`: trimmed, 1..150 characters
  - `body`: 1..20,000 characters
  - `audiences`: 0..20 rows of `audienceRowSchema`
  - `pinned`, `requiresAck`, `isPublic`
  - `coverFileId?`, `attachmentFileIds` (0..10)
  - `mode`: `'draft' | 'publish' | 'schedule'`
  - `publishAt?` (ISO), `expiresAt?` (ISO)

  Refinements on `announcementInputSchema`:
  - `mode === 'schedule'` requires `publishAt > now`.
  - `expiresAt` must be later than `publishAt ?? now`.
- `announcementPatchSchema`: `announcementInputSchema.partial()`.
- `feedQuerySchema`: `{ tab: 'all' | 'unread' | 'ack', courseId?, page, pageSize }`.
- `statsQuerySchema`: `{ filter?: 'unread' | 'unacked', format?: 'csv' }`.
- `previewAudienceSchema`: `{ audiences }`.

### 2.3 Audience service: `src/server/announcements/audience.ts` (FR-3..FR-8, NFR-2)

This module is generic. It never imports Announcement models (FR-8), and its input type is `AudienceRow = { type: AudienceType; refId: string | null; includeStudents: boolean; includeParents: boolean; includeTeachers: boolean }`. PRD-14 imports it unchanged.

**`getAudienceKeys(userId) → AudienceKeys`** loads one user's keys with at most about 4 indexed queries. The keys are:

```ts
type AudienceKeys = {
  userId: string;
  role: Role;
  active: boolean;
  // As a STUDENT (own) or PARENT (per linked ACTIVE child)
  gradeLevelIds: Set<string>;
  sectionIds: Set<string>;   // SectionMember rows
  courseIds: Set<string>;    // ACTIVE enrollment, non-archived course
  // As a TEACHER
  teachCourseIds: Set<string>;   // teacherId or coTeacherIds has, non-archived
  teachSectionIds: Set<string>;  // homeroom ∪ Course.sectionId of taught courses
  teachGradeLevelIds: Set<string>; // Section.gradeLevelId of taught current-year courses
  // Parent only: which child produced each key (FR-22)
  childByKey: Map<string, { id: string; firstName: string }[]>; // key = `${type}:${refId}`
};
```

All the functions below use these keys.

- **`matchesAudience(row, keys) → boolean`** is a pure function and the single source of the rules (R1). For an inactive user it returns false. Otherwise it matches by type:

  | Type | Matches when |
  |---|---|
  | SCHOOL | always |
  | STAFF | role is ADMIN or TEACHER |
  | ROLE | role equals `refId` |
  | GRADE_LEVEL | (`includeStudents` and the user is a STUDENT and `gradeLevelIds` has `refId`) or (`includeParents` and the user is a PARENT and `gradeLevelIds` has `refId`) or (`includeTeachers` and `teachGradeLevelIds` has `refId`) |
  | SECTION | the same pattern with `sectionIds` and `teachSectionIds` |
  | COURSE | the same pattern with `courseIds` and `teachCourseIds` |

- **`isUserInAudience(user, rows)`** returns `rows.some(r => matchesAudience(r, keys))`. Keys are passed in when the caller already has them (FR-7).
- **`audienceWhere(keys) → Prisma.AnnouncementAudienceWhereInput`** builds the SQL form of the same table: an `OR` of `{ type, refId: { in: [...] }, include<Flag>: true }` branches, built only for the non-empty key sets. The feed uses it as `audiences: { some: audienceWhere(keys) }`, which compiles to `EXISTS` (ADR-2).
- **`resolveAudienceUserIds(rows) → string[]`** expands recipients. It runs one `user.findMany({ select: { id } })` per row/flag branch, takes the union in a `Set`, and then applies one final `status: ACTIVE, archivedAt: null` filter. Students that feed the parent branches are filtered to ACTIVE first (A3).
- **`countAudienceByRole(rows)`** runs `resolveAudienceUserIds` and then `user.groupBy(role)`. It serves the preview and reach figures.
- **`audienceLabels(rows) → string[]`** batch-loads GradeLevel, Section and Course names and produces chips such as "Grade 7 · Parents" or "MATH-7A · Students, Parents" (FR-18).

Agreement between the matcher and `resolveAudienceUserIds` is not assumed. NFR-10's property test checks `isUserInAudience(u, rows) === resolveAudienceUserIds(rows).includes(u.id)` for every seed user and every seed row.

### 2.4 Announcements service: `src/server/announcements/announcements-service.ts` (FR-9..FR-31, FR-36)

| Function | Responsibility | Req |
|---|---|---|
| `visibleWhere(now)` | `status IN (SCHEDULED, PUBLISHED) AND publishAt <= now AND (expiresAt IS NULL OR expiresAt > now)`. Used by the feed, detail, ack, unread-count, files and public news. | FR-16, FR-17, NFR-6 |
| `isVisible(a, now)` | The same predicate in JS, for single rows. | FR-16 |
| `displayStatus(a, now)` | Derives SCHEDULED, PUBLISHED, EXPIRED, ARCHIVED or DRAFT for the manage view, so the status is correct between cron ticks (R5). | FR-23 |
| `assertCanTarget(user, rows, isPublic)` | ADMIN may target anything. TEACHER may target only COURSE rows for courses where they are `teacherId` or in `coTeacherIds` (the same test as `course-access.ts`), and SECTION rows where `homeroomTeacherId = user.id`. Every other case, including `isPublic`, throws 403 FORBIDDEN. | FR-9, FR-10, NFR-3 |
| `createAnnouncement(user, input)` | `requireRole(ADMIN, TEACHER)` at the route, then `assertCanTarget`, then the zero-recipient check if the mode is not draft (FR-15). A transaction creates the announcement, audience rows and attachment rows and calls `attachFiles(tx, 'announcement', id, [cover, ...attachments])`. Files are attached even for drafts (R9, B7). After commit, `mode = publish` calls `claimAndNotify(id, now)`. | FR-11, FR-13, FR-15, FR-16, FR-27 |
| `updateAnnouncement(user, id, patch)` | Allowed for the author or ADMIN, otherwise 404. ARCHIVED rows edited by a non-admin return 409 (A7). If `audiences` or `isPublic` is in the patch, it re-runs `assertCanTarget` on the **resulting** values (R8). The audience is replaced wholesale inside the transaction, and attachments are re-synced (attach new, detach removed). A transition to publish or schedule re-checks for zero recipients. It never clears `notifiedAt` (FR-29). An admin editing someone else's row triggers `audit('announcement.update')`. | FR-12, FR-29 |
| `archiveAnnouncement(user, id)` | Allowed for the author or ADMIN. Sets `status = ARCHIVED`. An admin archiving someone else's row triggers `audit('announcement.archive')`. | FR-12 |
| `listFeed(user, { tab, courseId, page })` | Loads the keys, then queries `visibleWhere ∧ audiences.some(audienceWhere(keys))`, adding the `courseId` filter when present (`audiences.some{type: COURSE, refId}` after `assertCanViewCourse`). The `tab` filter: `unread` → `reads.none{userId}`; `ack` → `requiresAck ∧ reads.none{userId, acknowledgedAt not null}`. Page 1 prepends up to 3 pinned items (`take 3`, ordered by `publishAt desc`) and excludes them from the main list (A4). The main list is ordered by `publishAt desc, id desc`. Each row includes `reads where userId`, `_count.attachments` and the author name and role. DTOs add `excerpt`, `labels` and, for parents, `forChildren`. | FR-17, FR-18, FR-21, FR-22, NFR-2 |
| `unreadCount(user)` | `count` over the same `where` as the feed plus `reads.none{userId}`. | FR-32 |
| `getForViewer(user, id)` | Visible to ADMIN, the author, or a user for whom `isVisible ∧ isUserInAudience` holds. Everyone else gets 404. For audience members only, it upserts `AnnouncementRead { readAt }` and keeps the existing `readAt`. Returns the body (rendered client-side with `MarkdownView`), attachments, the viewer's read row and `canEdit`. | FR-19, NFR-6 |
| `acknowledge(user, id)` | Requires `isVisible ∧ isUserInAudience`, otherwise 404. A row with `!requiresAck` returns 409 CONFLICT. Upserts with `acknowledgedAt` set once; repeat calls are idempotent and return the original time. | FR-20 |
| `previewAudience(user, rows)` | `assertCanTarget(user, rows, false)` first, so teachers cannot probe the sizes of other audiences. Then `countAudienceByRole`. Returns `{ total, byRole }`. | FR-14 |
| `listManage(user, page)` | No visibility filter. TEACHER sees `authorId = me`; ADMIN sees everything. For each row on the page it computes `reach = resolveAudienceUserIds(rows).length`, `read% = reads(readAt) ∩ recipients / reach`, and `ack%` when `requiresAck`. `ponytail:` live reach is computed per page row (pageSize ≤ 50). Snapshot a `recipientCount` if this gets slow. | FR-23 |
| `getStats(user, id, filter)` | Allowed for the author or ADMIN, otherwise 404. Recipients come from the live `resolveAudienceUserIds`, left-joined to reads. Returns the counts `{ recipients, read, acknowledged, readPct, ackPct }` and the rows `{ name, role, readAt, acknowledgedAt }`, filtered by unread or unacked. Reads from users who have left the audience are excluded (R11). | FR-24 |
| `statsCsv(rows)` | `toCsv` from `src/server/csv.ts` with the columns Name, Role, Read at and Acknowledged at, formatted in the school timezone. | FR-24, NFR-7 |
| `sendReminder(user, id, now)` | Allowed for the author or ADMIN, otherwise 404. Requires `requiresAck ∧ isVisible`, otherwise 409. Claims atomically with `updateMany({ where: { id, OR: [{ lastRemindedAt: null }, { lastRemindedAt: { lte: now − 24h } }] }, data: { lastRemindedAt: now } })`. A count of 0 throws 429 RATE_LIMITED with `{ retryAfter }`. Otherwise it notifies `recipients − acknowledged` with `announcement.reminder` and returns `{ notified }`. | FR-25, AC-5 |
| `claimAndNotify(id, now)` | `updateMany({ where: { id, notifiedAt: null, ...visibleWhere(now) }, data: { notifiedAt: now, status: PUBLISHED } })`. If the count is 1, it resolves recipients and calls `notify()` in chunks of 1,000 (R7). This is the only code path that sends `announcement.published`. | FR-27, FR-29 |
| `getPublicNews({ page })` | `isPublic ∧ visibleWhere(now)`. The DTO is `{ id, title, excerpt, body, publishAt, coverFileId, attachments[{ id, name }] }`, with no author email and no audience. | FR-31 |

Helpers that live beside the service:

- **`src/server/announcements/excerpt.ts`**: `toPlainText(md, max)`, a regex strip plus truncation (ADR-5). Its output is only ever rendered as escaped text (NFR-4). It produces the 200-character card excerpt (FR-18) and the 300-character email body (FR-28).
- **`src/server/announcements/maintenance.ts`**: `publishDueAnnouncements(now)`. It does `findMany({ where: { status: SCHEDULED, notifiedAt: null, publishAt: { lte: now } }, take: 50, select: { id } })`, then runs `claimAndNotify` for each id and logs `{ claimed }`. It copies the claim pattern in `quiz/maintenance.ts` (FR-27, NFR-11).
- **`src/server/announcements/files.ts`**: `announcementFileResolver(user, file)`. It loads the announcement by `file.contextId`. If `isPublic ∧ isVisible`, it allows access (including when `user` is null). Otherwise:
  - no user: deny
  - ADMIN or author: allow
  - `isVisible ∧ isUserInAudience`: allow
  - anything else: deny

  It is registered in `registerBuiltInContexts` in `src/server/files/contexts.ts` (FR-30, B8).

### 2.5 Existing modules touched (NFR-8)

| File | Change | Req |
|---|---|---|
| `src/server/notifications/types.ts` | Add `'announcement.published'` (COMMUNICATION, `defaultEmail: true`, `mandatoryInApp: false`, roles ALL) and `'announcement.reminder'` (COMMUNICATION, `defaultEmail: true`, `mandatoryInApp: true`, roles ALL). | FR-26 |
| `src/server/notifications/notify.ts` | Optional `NotifyInput.mandatoryInApp` override (A9). | FR-26 |
| `src/app/api/internal/email/dispatch/route.ts` | Add an isolated `try { await publishDueAnnouncements(now) } catch (e) { logger.error }` block alongside the existing passes. | FR-27 |
| `src/server/files/contexts.ts` | `register('announcement', announcementFileResolver)`. | FR-30 |
| `src/config/public-routes.ts` | Add `'/api/public/news'` to `PUBLIC_API_PATHS`. | FR-31 |
| `src/config/navigation.ts` + sidebar component | Add an optional `badgeEndpoint?: string` to `NavItem`, and an Announcements entry for all roles with `badgeEndpoint: '/api/announcements/unread-count'`. The sidebar wraps the icon in MUI `Badge` and polls every 30 s, gated by visibility, copying `NotificationBell`. | FR-32 |
| `src/config/course-tabs.ts` | `{ key: 'announcements', label: 'Announcements', href: id => '/courses/' + id + '/announcements', roles: ALL_ROLES }`. | FR-21 |
| `prisma/seed.ts` | Six announcements, idempotent by `(title, authorId)`. MATH-7A and Grade 7 targets are skipped when missing. Already-published seeds get `notifiedAt = now`, so seeding never sends notifications. | FR-35 |

### 2.6 API layer: `src/app/api/**` (FR-34)

Every handler is `withHandler` → `requireUser` or `requireRole` → `parseQuery` or `parseBody` (Zod) → one service call → `ok` or `paginated`. No business logic lives in routes.

| Route file | Methods | Role gate |
|---|---|---|
| `announcements/route.ts` | GET (feed), POST (create) | any / ADMIN, TEACHER |
| `announcements/unread-count/route.ts` | GET | any |
| `announcements/preview-audience/route.ts` | POST | ADMIN, TEACHER |
| `announcements/manage/route.ts` | GET | ADMIN, TEACHER |
| `announcements/[id]/route.ts` | GET, PATCH | any (service gates) / ADMIN, TEACHER |
| `announcements/[id]/archive/route.ts` | POST | ADMIN, TEACHER |
| `announcements/[id]/ack/route.ts` | POST | any (service gates) |
| `announcements/[id]/stats/route.ts` | GET (`?format=csv` → `text/csv` + `Content-Disposition`) | ADMIN, TEACHER |
| `announcements/[id]/remind/route.ts` | POST | ADMIN, TEACHER |
| `public/news/route.ts` | GET (no auth, `rateLimit` by IP, `parsePagination` clamp) | public |

STUDENT and PARENT callers hitting the ADMIN/TEACHER routes get 403 from `requireRole` (FR-11). The exact request and response shapes are owned by `arch-api-contracts`.

### 2.7 UI layer: `src/app/(app)/announcements/**` (FR-13..FR-24, FR-32, FR-33, NFR-1, NFR-5)

Each page is a server component that enforces access through the same service calls (NFR-3) and renders client components. All UI uses MUI only, and every component is looked up through mui-mcp before use.

| Route | Components |
|---|---|
| `/announcements` | `PageHeader` with a "New announcement" button for ADMIN and TEACHER (FR-33). MUI `Tabs` for All, Unread and Requires acknowledgement. A list of `AnnouncementCard` (`Card`, `CardMedia` cover thumbnail via `/api/files/:id`, title, author and role, date in the school timezone, `Chip` labels, excerpt, attachment count, a "For Sam" `Chip` for parents, and an unread dot with `visuallyHidden` "Unread"). `Pagination` and `EmptyState`. |
| `/announcements/[id]` | Title and metadata, then `MarkdownView` for the body (NFR-4) and `FileList` for attachments. When `requiresAck`, a `Button` reading "I acknowledge" that becomes a disabled "Acknowledged on 14 Sep" (`formatInSchoolTz`, NFR-7). Edit and Stats links for the author and admins. |
| `/announcements/new`, `/announcements/[id]/edit` | `AnnouncementComposer` (react-hook-form + zodResolver): `TextField` title, `MarkdownEditor`, `FileUpload` (cover, context `announcement`), `FileUpload` + `FileList` (attachments), and `AudienceBuilder`. `AudienceBuilder` has rows of `Select` type → `Autocomplete` entity (grade levels, sections, courses, roles; teachers see only their own courses and homeroom) → three `Checkbox`es, plus a debounced (400 ms) preview line "Will reach N people: …". Further fields: `Switch`es for pinned, requires acknowledgement and public (admins only), a `RadioGroup` for Publish now / Schedule / Save draft, and `DateTimePicker`s for publishAt and expiresAt, converted from the school timezone to UTC on submit. Server errors surface through `useToast()`. |
| `/announcements/manage` | `DataTable` with the columns status chip (`displayStatus`), title, audience summary, reach, read % and ack %. Row actions are Edit, Stats and Archive (`ConfirmDialog`). |
| `/announcements/[id]/stats` | `StatCard`s for recipients, read % and ack %. A `DataTable` of recipients with an Unread / Not acknowledged `ToggleButtonGroup`, an "Export CSV" link (`?format=csv`) and "Send reminder" (`ConfirmDialog`; a 429 response is shown as a toast with the retry time). |
| `/courses/[id]/announcements` | The feed list component with `courseId`, behind `assertCanViewCourse`. |

---

## 3. Data Flow

### 3.1 Create and publish now (FR-10, FR-13..FR-15, FR-27, FR-28)

```
Composer ──POST /api/announcements──► withHandler → requireRole(ADMIN,TEACHER) → parseBody(announcementInputSchema)
  → assertCanTarget(user, audiences, isPublic)          ── 403 on violation (AC-3)
  → countAudienceByRole(audiences).total === 0 ?        ── 400 VALIDATION_ERROR (not for drafts)
  → $transaction: create Announcement{status:PUBLISHED, publishAt:now} + audiences + attachments; attachFiles(...)
  → (after commit) claimAndNotify(id, now)
       updateMany(id, notifiedAt null, visible) → count 1
       → resolveAudienceUserIds → notify({type:'announcement.published', userIds (chunks of 1k), title,
           body: toPlainText(body,300), link:/announcements/id, mandatoryInApp: requiresAck,
           email:{template:'generic-notification', data:{title, body, link, ctaLabel:'Read announcement'}}})
  → 201 { announcement }
```

### 3.2 Scheduled publish (FR-16, FR-27, AC-4)

```
Create with mode=schedule → status SCHEDULED, publishAt=T, notifiedAt null   (no notify)
Before T: visibleWhere excludes it (publishAt > now)  → absent from feed, detail 404 for non-authors
At/after T: visibleWhere includes it immediately on read (no cron needed)
Cron  POST /api/internal/email/dispatch (CRON_SECRET) → publishDueAnnouncements(now)
       → findMany(SCHEDULED, notifiedAt null, publishAt<=now, take 50)
       → claimAndNotify(id) per row; concurrent runs: only one updateMany gets count 1 → exactly one send
```

### 3.3 Feed read (FR-17, FR-22, NFR-2)

```
GET /api/announcements?tab=&courseId=&page=
  → getAudienceKeys(user)            ~4 indexed queries (parent: children → profiles, section members, enrollments)
  → findMany(visibleWhere(now) ∧ audiences.some(audienceWhere(keys)) ∧ tab filter)
       EXISTS over AnnouncementAudience(type, refId) index; Announcement(status, publishAt) index
  → page 1: pinned take 3 first, then the rest newest-first
  → DTO: excerpt (toPlainText 200), labels (audienceLabels, batched), unread flag, forChildren (keys.childByKey)
```

The target is under 200 ms for a parent with 3 children and 2,000 announcements. NFR-10 includes an optional timing check in the integration suite.

### 3.4 Detail, read and acknowledge (FR-19, FR-20)

```
GET /:id → admin|author|(visible ∧ member) else 404 → member: upsert AnnouncementRead{readAt}
POST /:id/ack → visible ∧ member else 404; !requiresAck → 409 → upsert {acknowledgedAt: existing ?? now}
```

### 3.5 Stats and reminder (FR-24, FR-25, AC-5)

```
GET /:id/stats → author|admin else 404 → recipients = resolveAudienceUserIds; join reads
   50 recipients, 30 acked → ackPct 60
POST /:id/remind → claim lastRemindedAt (≤ now−24h) → 0 rows → 429 {retryAfter}
   → notify('announcement.reminder', recipients − acked)  → { notified: 20 }
```

### 3.6 Files and public news (FR-30, FR-31, AC-7)

```
GET /api/files/:id (already public route) → access registry → announcementFileResolver(user|null, file)
GET /api/public/news?page= (no session) → getPublicNews → isPublic ∧ visible → public DTO
```

---

## 4. Cross-cutting Rules

- **Security (NFR-3, NFR-6).** Every handler and server page calls `requireUser` or `requireRole`. Ownership, membership and targeting checks live in the service, so pages and routes share them. Non-members get 404; targeting violations get 403.
- **Sanitisation (NFR-4).** The body renders only through `MarkdownView` (react-markdown + rehype-sanitize). Excerpts and email bodies are plain text from `toPlainText`, rendered as escaped text and never through `dangerouslySetInnerHTML`.
- **Timezones (NFR-7).** All columns are UTC. Composer inputs are interpreted in `getSchoolTimezone()` (imported from `assignments-service.ts`, B15) and converted with `date-fns-tz`. All dates are displayed with `formatInSchoolTz`.
- **Logging (NFR-11).** All new server code logs through `logger` from `src/lib/logger.ts`. `console.*` is used only in the existing seed style.
- **UI rule (NFR-1).** MUI only. Toasts go through `useToast`, confirmations through `ConfirmDialog`, pickers through `Autocomplete` and `DateTimePicker`. The existing `eslint-no-restricted-imports` unit test guards against banned libraries. If mui-mcp is unreachable during development, report a blocker.
- **Scope (NFR-9).** No comments, reactions, translation, SMS or public website pages. Only `getPublicNews` and `/api/public/news` are exposed.

## 5. Test Plan Mapping (NFR-10)

| Layer | File | Covers |
|---|---|---|
| Unit | `tests/unit/announcements/audience-match.test.ts` | `matchesAudience` for every type × flag combination × role, using hand-built keys and no DB (FR-3..FR-6). |
| Unit | `tests/unit/announcements/permissions.test.ts` | `assertCanTarget` for admin, teacher course, co-teacher, homeroom, foreign course, SCHOOL, STAFF, ROLE, GRADE_LEVEL and `isPublic` (FR-9, FR-10). |
| Unit | `tests/unit/announcements/excerpt.test.ts` | `toPlainText` stripping and truncation (FR-18, FR-28). |
| Unit | `tests/unit/validators/announcements.test.ts` | Zod limits and refinements (FR-2). |
| Integration | `tests/integration/announcements/audience-agreement.test.ts` | For every seed and fixture user × every audience row, `isUserInAudience` equals membership in `resolveAudienceUserIds` (FR-7). |
| Integration | `tests/integration/announcements/publish.test.ts` | `publishDueAnnouncements` run twice and concurrently produces one notification set; FR-29 no re-notify on PATCH; AC-4. |
| Integration | `tests/integration/announcements/api.test.ts` | AC-1, AC-2, AC-3 (403), AC-5 (60%, 20 notified, 429), AC-6, AC-7, AC-8 (the fixture creates Pat's 6A child). |
| E2E | `tests/e2e/announcements.spec.ts` | Admin composes a Grade 7 parents announcement with ack, Pat reads and acknowledges, admin opens stats. |

---

## 6. Requirements Traceability

| Req | Design element(s) |
|---|---|
| FR-1 | §2.1 schema and migration `20261112000000_add_announcements`; additions listed in §1 |
| FR-2 | §2.2 `src/lib/validators/announcements.ts` |
| FR-3 | §2.3 `resolveAudienceUserIds`, `matchesAudience` (SCHOOL, STAFF, ROLE); ACTIVE filter (A3) |
| FR-4 | §2.3 GRADE_LEVEL branches, `teachGradeLevelIds` (current year, non-archived, A6) |
| FR-5 | §2.3 SECTION branches, SectionMember plus homeroom plus section courses (A1) |
| FR-6 | §2.3 COURSE branches, ACTIVE enrollment, `teacherId` ∪ `coTeacherIds` |
| FR-7 | §2.3 `isUserInAudience` on `AudienceKeys`; §5 agreement test |
| FR-8 | §2.3 generic `AudienceRow` input, no Announcement imports |
| FR-9 | §2.4 `assertCanTarget` ADMIN branch |
| FR-10 | §2.4 `assertCanTarget` TEACHER branch on create, PATCH and preview; A10 |
| FR-11 | §2.6 `requireRole(ADMIN, TEACHER)` on write routes |
| FR-12 | §2.4 `updateAnnouncement`, `archiveAnnouncement`, `audit()`; A7 |
| FR-13 | §2.7 `AnnouncementComposer`, `AudienceBuilder` |
| FR-14 | §2.4 `previewAudience`, §2.3 `countAudienceByRole`; §2.7 debounced preview line |
| FR-15 | §2.4 zero-recipient check on publish or schedule only (A2) |
| FR-16 | §2.4 `visibleWhere`, `isVisible`; §3.2 |
| FR-17 | §2.4 `listFeed` (tabs, pinned 3, newest first, pagination); A4, A11 |
| FR-18 | §2.4 feed DTO, `excerpt.ts`, `audienceLabels`; §2.7 `AnnouncementCard` |
| FR-19 | §2.4 `getForViewer` with read upsert; §2.7 detail page with `MarkdownView` |
| FR-20 | §2.4 `acknowledge`; §2.7 ack button with `formatInSchoolTz` |
| FR-21 | §2.5 course-tabs entry; §2.4 `listFeed` `courseId` filter with `assertCanViewCourse`; §2.7 course tab page |
| FR-22 | §2.3 `childByKey`; §2.4 `forChildren` in the DTO; §2.7 "For Sam" chip |
| FR-23 | §2.4 `listManage`, `displayStatus`; §2.7 manage page |
| FR-24 | §2.4 `getStats`, `statsCsv`; §2.6 `?format=csv`; §2.7 stats page |
| FR-25 | §2.4 `sendReminder`, `lastRemindedAt` claim, 429 (A8) |
| FR-26 | §2.5 `types.ts` entries plus the `notify` `mandatoryInApp` override (A9) |
| FR-27 | §2.4 `claimAndNotify`, `maintenance.ts` `publishDueAnnouncements`; §2.5 dispatch route hook; §3.1, §3.2 |
| FR-28 | §3.1 notify email data (`generic-notification`, `toPlainText` 300, "Read announcement") |
| FR-29 | §2.4 `updateAnnouncement` never touches `notifiedAt`; the `claimAndNotify` claim |
| FR-30 | §2.4 `files.ts` `announcementFileResolver`; §2.5 `contexts.ts` registration |
| FR-31 | §2.4 `getPublicNews`; §2.6 `public/news/route.ts`; §2.5 `public-routes.ts` |
| FR-32 | §2.5 `NavItem.badgeEndpoint` plus sidebar `Badge`; §2.4 `unreadCount` |
| FR-33 | §2.7 feed `PageHeader` button for ADMIN and TEACHER |
| FR-34 | §2.6 route table, `withHandler` and Zod |
| FR-35 | §2.5 `prisma/seed.ts` (6 announcements, skip-if-missing, `notifiedAt` preset) |
| FR-36 | §2.3 and §2.4 files under `src/server/announcements/` |
| NFR-1 | §2.7 MUI-only components; §4 UI rule |
| NFR-2 | §2.1 indexes; §2.3 `audienceWhere` `EXISTS`; §3.3 |
| NFR-3 | §2.4 `assertCanTarget`; §2.6 role gates; §4 security |
| NFR-4 | §2.4 `excerpt.ts`; §2.7 `MarkdownView`; §4 sanitisation |
| NFR-5 | §2.7 unread dot with `visuallyHidden` "Unread" |
| NFR-6 | §2.4 `visibleWhere`, 404 for non-members; A10 |
| NFR-7 | §2.7 `DateTimePicker` in the school timezone; §4 timezones |
| NFR-8 | §2.5 existing modules reused; ADR-1 |
| NFR-9 | §4 scope |
| NFR-10 | §5 test plan |
| NFR-11 | §2.4 `maintenance.ts` logging; §4 logging |
