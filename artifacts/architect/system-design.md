# System Design: PRD-14 School Calendar, Events & Holidays

Ticket: SH-14 · Phase: architect (arch-design-system) · Timestamp: 2026-11-09T23:58:00Z · Status: complete

Inputs:
- `artifacts/intake/requirements.json`: 37 FR and 12 NFR, 96% confidence
- `artifacts/intake/handoff-to-architect.json`
- `artifacts/architect/tech-stack-decisions.md`: ADR-1 to ADR-13
- `artifacts/architect/requirements-analysis-notes.md`: B1 to B19, D1 to D9, R1 to R4

> This replaces the stale SH-13 `system-design.md`. `api-contracts.json` and `handoff-to-dev-planning.json` in this folder are still SH-13 until `arch-api-contracts` rewrites them.

---

## 1. Overview

SH-14 adds a school calendar to the existing SchoolHub app (Next.js 14 App Router, Prisma/PostgreSQL, MUI 9). The pieces are:

- one Prisma migration
- one server module, `src/server/calendar/`
- a shared audience resolver, at the path PRD-12 will use
- about a dozen thin route handlers
- two new pages (`/calendar`, `/account/calendar`), plus one small admin page
- small, targeted edits to timetable, attendance, the assignment and quiz editors, notifications, the cron, navigation and the seed

Design principles:

1. **One read path.** A single function, `getCalendarItems(user, range, sources, studentId?)`, feeds the `/calendar` API, the iCal feed, `getUpcomingEventsForUser`, and (with `sources=['events']`) the single-event visibility check. That way the feed cannot show anything the app hides (NFR-5).
2. **Recurrence is expanded on the server, at read time.** A recurring event is stored once. Clients and the scheduler only ever receive plain occurrences. The feed emits RRULE (ADR-2, ADR-3).
3. **One holiday rule.** `isSchoolDay` in calendar-service owns the teaching-weekday rule and the no-school-event rule. Timetable, attendance, the editors and `/api/school-day` all call it (ADR-8).
4. **Reuse before writing.** The design reuses `rateLimit`, `notify`, `audit`, `hashToken`, `csv.ts`, `DataTable`, `ConfirmDialog`, `MarkdownView/Editor`, `useToast`, the dispatch cron, `getSchoolTimezone` and the access helpers (NFR-9).

### Intake blockers and warnings

`handoff-to-architect.json` reports **no blockers** (`blockers: []`). It raises three warnings, resolved as follows:

| Intake warning | Resolution | Ref |
|---|---|---|
| PRD-12 missing: no `AudienceType`, `audience.ts` or audience builder | SH-14 adds `enum AudienceType { SCHOOL STAFF ROLE GRADE_LEVEL SECTION COURSE }` and `src/server/announcements/audience.ts`, exactly as PRD-12 §FR-1/FR-2 specify. It also adds a minimal MUI `AudienceBuilder`. PRD-12 adopts all three without changes. No Announcement models. | ADR-9, §3.3 |
| `/admin/academic-years/[id]` page missing | Add a minimal ADMIN server page at that exact route with a read-only term list and an "Add term breaks" button. | ADR-10, §3.9 |
| New dependencies | `@mui/x-scheduler@9.0.0-beta.15` (exact, installed first) with a scoped `@mui/x-internals` override. `node-ical@0.27.6` as an exact devDependency. Nothing else is added. | ADR-1, ADR-5 |

### Conflicts between the research inputs, and how this design settles them

| Topic | arch-research-stack | arch-research-reqs | **Decision** |
|---|---|---|---|
| Audience shape | PRD-12 enum (6 values) with `refId` and `include*` flags | 4-value enum with `targetId` and `roles[]` | **ADR-9.** PRD-14 FR-1 itself defines `EventAudience` with `refId` / `includeStudents` / `includeParents` / `includeTeachers` (verified in `14-calendar.md` L128-137), and PRD-12 L96 defines the 6 values. "Grade 7 parents" = `GRADE_LEVEL` with `includeStudents=false, includeTeachers=false`. No `roles[]` column. |
| Resolver path | `src/server/announcements/audience.ts` | `src/server/audience/audience.ts` | **`src/server/announcements/audience.ts`**, the path PRD-12 names, so PRD-12 doesn't need a rename. |
| `getScheduleForDate` "reason" | Add `reason` to its return | Keep `ScheduleEntry[]`; callers fetch the reason separately | **Keep `ScheduleEntry[]`** (no churn for callers: attendance L130/L472, `getCurrentSlot`). Callers that need the holiday name call `isSchoolDay(date)` directly. FR-17's "reason" is delivered through `isSchoolDay` and `/api/school-day`. |
| Email default per category (FR-28) | Not addressed | D5: a second type | **Two registry types:** `event.created` (`defaultEmail: false`) and `event.holiday_created` (`defaultEmail: true`, used for HOLIDAY/TERM_BREAK). Both keep the per-user preference override, and `notify.ts` is unchanged. This is a deliberate deviation (D-3 below). |
| RSVP reminder "once" | `rsvpReminderSentAt` column | Same, claimed with conditional `updateMany` | Agreed: claim it with `updateMany({where:{id, rsvpReminderSentAt:null}})`. |

### Deviations from the PRD's model and route list (all deliberate)

| ID | Deviation | Why | Traces to |
|---|---|---|---|
| D-1 | `CalendarEvent.rsvpReminderSentAt DateTime?` | Stores "once per event" for the reminder. Claimed atomically. | FR-23 |
| D-2 | `EventAudience @@index([eventId])` and `@@index([type, refId])` | Audience filtering in SQL on the hot path. | NFR-4 |
| D-3 | Extra notification type `event.holiday_created` | Per-category email default, within the existing preference model. | FR-28 |
| D-4 | Back-relations on `User` (`calendarEvents`, `eventRsvps`, `calendarFeedToken`) and `onDelete: Cascade` FKs on `EventRsvp.userId` / `CalendarFeedToken.userId` | Prisma requires the relations. Cascade matches the "cascade deletes" instruction in FR-2. | FR-2 |
| D-5 | Agenda view: 30-day page with next/prev in Community `EventCalendar`, instead of true infinite scroll | Community has no infinite agenda. If QA rejects this, the fallback is MUI `List` + native `IntersectionObserver` below 768 px, fetching the next 30-day window. Rejection triggers the fallback; it is not built up front. | FR-9, ADR-2 |
| D-6 | `GET /api/me/calendar-feed` returns `url` only when it creates the first token, otherwise `{url:null, hasToken:true, createdAt}`. The page offers "Reset link". | The raw token cannot be re-shown because it is stored hashed. | FR-24, FR-25, NFR-5 |
| D-7 | Seed a minimal ELECTIVE `ROBOTICS` course (teacher Tom, current year) only if it doesn't exist | The Chess club audience needs it, and it is absent from the seed. | FR-37 |
| D-8 | Register save on a no-school date requires `holidayOverride: true` in the body, enforced on the server | Makes FR-18's extra confirmation a real rule, not only a UI dialog. | FR-18, NFR-7 |
| D-9 | `GET /api/public/events` is rate limited per IP (`rateLimit('pubcal:'+ip, 120, 3_600_000)`) and range-capped at 100 days | Only unauthenticated JSON route; reuses the existing limiter. | FR-30, NFR-7 |

---

## 2. Component Breakdown

### 2.1 Dependencies and config (do first)

| Change | Ref |
|---|---|
| `npm i --save-exact @mui/x-scheduler@9.0.0-beta.15`. Nested override `"@mui/x-scheduler": {"@mui/x-internals": "9.17.0"}`. Verify with `npm ls @mui/x-internals`. If npm doesn't honour the nested override, fall back to a global `9.17.0`. | FR-1, ADR-1 |
| `import type {} from '@mui/x-scheduler/theme-augmentation'` beside the theme | FR-9, ADR-1 |
| `npm i -D --save-exact node-ical@0.27.6` | NFR-6 |
| Before writing scheduler code, the dev phase looks up the Quickstart, Views, Events, Editing, Timezone, Localization and Responsiveness pages via MUI MCP (`useMuiDocs` + `fetchDocs`). If MCP is unreachable, stop and report a blocker. | NFR-2 |

### 2.2 Data model: migration `20261113000000_add_calendar`

```prisma
enum AudienceType  { SCHOOL STAFF ROLE GRADE_LEVEL SECTION COURSE }   // PRD-12 values, owned here until PRD-12 lands
enum EventCategory { HOLIDAY TERM_BREAK EXAM EVENT MEETING TRIP SPORTS DEADLINE OTHER }
enum Recurrence    { NONE WEEKLY MONTHLY }
enum RsvpResponse  { YES NO MAYBE }

model CalendarEvent {
  id                 String        @id @default(cuid())
  title              String
  description        String?
  category           EventCategory
  startAt            DateTime
  endAt              DateTime
  allDay             Boolean       @default(false)
  location           String?
  roomId             String?
  recurrence         Recurrence    @default(NONE)
  recurrenceUntil    DateTime?     @db.Date
  isNoSchool         Boolean       @default(false)
  rsvpEnabled        Boolean       @default(false)
  rsvpDeadline       DateTime?
  rsvpReminderSentAt DateTime?                                  // D-1
  isPublic           Boolean       @default(false)
  createdById        String
  createdBy          User          @relation("CalendarEventCreator", fields: [createdById], references: [id])
  createdAt          DateTime      @default(now())
  updatedAt          DateTime      @updatedAt
  audiences          EventAudience[]
  rsvps              EventRsvp[]
  @@index([startAt, endAt])
}

model EventAudience {
  id              String        @id @default(cuid())
  eventId         String
  event           CalendarEvent @relation(fields: [eventId], references: [id], onDelete: Cascade)
  type            AudienceType
  refId           String?       // gradeLevelId | sectionId | courseId | Role name (ROLE); null for SCHOOL/STAFF
  includeStudents Boolean       @default(true)
  includeParents  Boolean       @default(true)
  includeTeachers Boolean       @default(true)
  @@index([eventId])
  @@index([type, refId])                                        // D-2
}

model EventRsvp {
  eventId   String
  event     CalendarEvent @relation(fields: [eventId], references: [id], onDelete: Cascade)
  userId    String
  user      User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  response  RsvpResponse
  guests    Int           @default(0)
  note      String?
  createdAt DateTime      @default(now())
  updatedAt DateTime      @updatedAt
  @@id([eventId, userId])
}

model CalendarFeedToken {
  userId    String   @id
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash String   @unique
  createdAt DateTime @default(now())
}
```

Exact field lists for `EventRsvp` follow PRD §FR-1. The dev agent copies any field this sketch omits from `14-calendar.md` L139-148. Traces to FR-2, FR-3, FR-23, NFR-4, NFR-8.

### 2.3 Server modules

| File | Exports | Notes | Reqs |
|---|---|---|---|
| `src/server/announcements/audience.ts` (new, PRD-12 path) | `resolveAudienceUserIds(audiences)`, `isUserInAudience(user, audiences)`, `audienceWhereForUser(user)` (Prisma `EventAudience` filter), `canTargetAudience(user, audience)` | Semantics are those of PRD-12 FR-2. `audienceWhereForUser` precomputes the user's keys once: their grade levels, sections and courses, the same for linked children (parents), the courses they teach and the sections they homeroom (teachers), and their role. It returns an `OR` over `{type, refId, include*}` so filtering happens in SQL (NFR-4). `canTargetAudience`: ADMIN → any. TEACHER → `COURSE` passes `assertCanManageCourse`, or `SECTION` where `homeroomTeacherId === user.id`. Everything else → false. | FR-3, FR-6, FR-7, FR-28, FR-29, FR-23, NFR-4, NFR-7 |
| `src/server/calendar/recurrence.ts` (new, pure) | `expandOccurrences(event, from, to, tz)` | Steps in school-tz wall clock: +7 days, or +1 month on the same day of month, skipping months that lack the day. Duration is kept in wall-clock terms. Stops at the earlier of `recurrenceUntil` (end of that day, inclusive) and `to`. Occurrence id = `${eventId}:${occurrenceStartISO}`. | FR-15, FR-4, NFR-3, ADR-3 |
| `src/server/calendar/ical.ts` (new, pure) | `escapeText`, `foldLine`, `vtimezone(tz, from, to)`, `vevent(item, tz)`, `buildCalendar(items, tz, window)` | All-day events use `VALUE=DATE` with an exclusive `DTEND`. Timed one-off events use UTC `Z`. Recurring events use `TZID` + `RRULE:FREQ=WEEKLY|MONTHLY;UNTIL=…Z` (+`BYMONTHDAY`). Deadlines are zero-duration VEVENTs with `URL`. Lines are CRLF and folded at 75 octets. | FR-12, FR-26, NFR-3, NFR-6, ADR-5 |
| `src/server/calendar/calendar-service.ts` (new) | `getEvent`, `createEvent`, `updateEvent`, `deleteEvent`, `upsertRsvp`, `listRsvps`, `isSchoolDay`, `noSchoolDays(from,to)`, `createTermBreaks(yearId, actor)`, `getOrCreateFeedToken`, `resetFeedToken`, `findUserByFeedToken` | Owns every per-entity check (NFR-7). **Imports nothing from timetable-service** (R2). It reads `prisma.schoolDay` directly, and timetable-service imports *from* it. | FR-5..8, FR-16, FR-20..23, FR-25, FR-33, FR-34, FR-36 |
| `src/server/calendar/sources.ts` (new) | `getCalendarItems`, `getPublicEvents`, `getUpcomingEventsForUser` | The merge in §3.1. It may import timetable-service, the assignment and quiz services, and calendar-service, because nothing imports it back except routes (R2). | FR-10, FR-11, FR-15, FR-26, FR-30..32 |
| `src/server/calendar/maintenance.ts` (new) | `sendRsvpReminders(now)` | Selects events with `rsvpEnabled`, `rsvpDeadline ∈ (now, now+48h]` and `rsvpReminderSentAt = null`. For each, claims it via `updateMany({where:{id, rsvpReminderSentAt:null}, data:{rsvpReminderSentAt:now}})`. If `count===1`, resolves the audience minus existing RSVP userIds and calls `notify('event.rsvp_reminder')`. | FR-23, ADR-11 |
| `src/lib/validators/calendar.ts` (new, client-safe) | `eventInputSchema`, `eventPatchSchema`, `rsvpSchema`, `calendarQuerySchema`, `schoolDayQuerySchema`, `publicEventsQuerySchema` | Rules: title ≤ 150; description ≤ 5000; `endAt ≥ startAt`; `recurrenceUntil` required for WEEKLY/MONTHLY and ≤ start + 1 year; guests 0–5; range `to − from ≤ 100 days`; `sources ⊆ {events, holidays, assignments, quizzes, timetable}`. All-day input is `yyyy-MM-dd` start and inclusive end. The **server** converts it to `[schoolMidnight(start), schoolMidnight(end+1))`. | FR-4, FR-21, FR-32, NFR-8 |
| `src/lib/dates.ts` (edit) | add `schoolMidnight(dateStr, tz)`, `schoolDateOf(instant, tz)` | Pure and client-safe. The single source of all-day and date conversions. | FR-4, FR-16, NFR-3, ADR-4 |

### 2.4 Edits to existing modules

| File | Change | Reqs |
|---|---|---|
| `src/server/timetable/timetable-service.ts` | At both `// PRD-14 holidays hook` lines, replace the inline `schoolDay` weekday check with `if (!(await isSchoolDay(date)).isSchoolDay) return [];`. The weekday rule now lives only in `isSchoolDay`, so the old check is deleted, not duplicated. The return type is unchanged. | FR-16, FR-17, NFR-9 |
| `src/server/attendance/attendance-service.ts` | `getToday` and `getOverview` add `noSchoolReason: string \| null` from `isSchoolDay`. The register save path rejects with `VALIDATION_ERROR` "holidayOverride required" when the date is not a school day and `holidayOverride !== true` (D-8). | FR-18 |
| Attendance landing + `RegisterForm.tsx` | Landing shows "No classes today — <reason>". The register shows a warning `Alert` banner, and the save button opens `ConfirmDialog` "Record attendance on a holiday anyway", which sends `holidayOverride: true`. | FR-18, NFR-1 |
| Teacher/student/parent Today views (those consuming `getScheduleForDate`) | When `isSchoolDay` is false, show the holiday name instead of the empty class list. | FR-17 |
| `AssignmentForm.tsx`, `QuizSettingsPanel.tsx` | On a `dueAt`/`availableUntil` change, `fetch('/api/school-day?date=')`. If false, show a non-blocking `<Alert severity="warning">This date is a holiday (<title>).</Alert>`. Save is unchanged. | FR-19, FR-34 |
| `src/server/notifications/types.ts` | Add `event.created` (COMMUNICATION, defaultEmail false), `event.holiday_created` (COMMUNICATION, defaultEmail true), `event.updated` (COMMUNICATION, false) and `event.rsvp_reminder` (COMMUNICATION, false). All roles. | FR-23, FR-28, FR-29 |
| `src/app/api/internal/email/dispatch/route.ts` | Add an isolated `try { await sendRsvpReminders(now) } catch (e) { logger.error(...) }` block, matching the quiz-maintenance block. | FR-23, NFR-9 |
| `src/config/navigation.ts` | `{ label: 'Calendar', href: '/calendar', icon: CalendarMonth, roles: ALL_ROLES }`. `/account/calendar` gets no sidebar entry, as with the other `/account/*` pages. It is reached from the account area and a "Subscribe" link on `/calendar`. | FR-35 |
| `prisma/seed.ts` | `seedCalendar()`, idempotent: match by title (+ startAt where it is stable). It seeds the 7 events from FR-37 and the ROBOTICS course if absent (D-7). "Sports day" has no announcement link. Grade 6–8 exams use three `GRADE_LEVEL` audiences. "Grade 7 parents" = `GRADE_LEVEL` with only `includeParents`. | FR-37 |

### 2.5 Route handlers (thin: requireUser/requireRole → Zod parse → service → `ok`/`apiError`)

| Route | Auth | Service call | Reqs |
|---|---|---|---|
| `GET /api/calendar?from&to&sources&studentId` | any user | `getCalendarItems` | FR-10, FR-11, FR-32, NFR-7 |
| `POST /api/events` | ADMIN, TEACHER | `createEvent` | FR-5..7, FR-14, FR-28, FR-33 |
| `GET /api/events/:id` | visible to user | `getEvent` (+`myRsvp`, totals, `canEdit`) | FR-12, FR-22, FR-33 |
| `PATCH /api/events/:id` | creator, ADMIN | `updateEvent` | FR-6..8, FR-29, FR-33, FR-36 |
| `DELETE /api/events/:id` | creator, ADMIN | `deleteEvent` | FR-8, FR-33, FR-36 |
| `GET /api/events/:id/ics` | visible to user | `getEvent` → `buildCalendar([event])` | FR-12, FR-33 |
| `PUT /api/events/:id/rsvp` | audience member | `upsertRsvp` | FR-21 |
| `GET /api/events/:id/rsvps[?format=csv]` | creator, ADMIN | `listRsvps` → JSON or `csv.ts` | FR-22 |
| `GET /api/me/calendar-feed` | any user | `getOrCreateFeedToken` | FR-24, FR-25 |
| `POST /api/me/calendar-feed/reset` | any user | `resetFeedToken` | FR-24, FR-25 |
| `GET /api/calendar/feed/[token]` (`.ics` stripped from param) | token | `findUserByFeedToken` → `rateLimit` → `getCalendarItems` → `buildCalendar` | FR-26, FR-27, NFR-5, NFR-6 |
| `GET /api/school-day?date=` (new singular folder; `/api/school-days` untouched) | any user | `isSchoolDay` | FR-16, FR-19, FR-34 |
| `GET /api/public/events?from&to` | public, IP rate limit | `getPublicEvents` | FR-30, D-9 |
| `POST /api/academic-years/:id/term-breaks` | ADMIN | `createTermBreaks` | FR-20 |

Error mapping: not visible → 404 `NOT_FOUND`. Visible but not permitted → 403 `FORBIDDEN`. RSVP after the deadline, or with RSVP disabled → 409 `CONFLICT`. Feed token unknown → plain 404. Feed over the limit → 429 `RATE_LIMITED` + `Retry-After`. `arch-api-contracts` defines the exact shapes.

### 2.6 UI

| Path / component | Contents | Reqs |
|---|---|---|
| `src/app/(app)/calendar/page.tsx` (server) → `CalendarView.tsx` (client) | `requirePageUser`. `<EventCalendar>` from `@mui/x-scheduler/event-calendar`: `views={['month','week','agenda']}`, week `startTime:7, endTime:19`, agenda `dayCount:30`, `displayTimezone={tz}`, `readOnly`, `eventCreation={false}`. The default view is month at `useMediaQuery('(min-width:768px)')`, agenda below that. Controlled `events`, refetched on `onVisibleDateChange`/`onViewChange` with plain `fetch` and a small Map cache keyed by `from|to|sources|studentId`. The page opens the drawer when `?event=<id>` is present (notification links). | FR-9, FR-10, NFR-1, NFR-2, NFR-4, NFR-12 |
| `SourceChips` | MUI `Chip`s: School events · My assignments · My quizzes · My timetable (Week view only) · Holidays. Stored in `localStorage['calendar.sources']`. Holidays = HOLIDAY/TERM_BREAK/`isNoSchool`; School events = everything else, with no overlap. `timetable` is fetched only in Week view. | FR-10 |
| Child filter (PARENT only) | `Select`: "All children" or one child → `studentId`. Deadline titles get the child's name prefixed by the server. | FR-11 |
| `EventDrawer` | Right-anchored `Drawer`: title, category `Chip`, time in school tz, location, `MarkdownView` description, audience chips, RSVP controls (`ToggleButtonGroup` + guests `TextField` for parents + note; disabled after the deadline), "Add to my calendar" (`<a href="/api/events/:id/ics" download>`), and edit/delete when `canEdit` (delete via `ConfirmDialog`). Creator/admin see an RSVP `DataTable` + CSV link. | FR-12, FR-21, FR-22, NFR-1 |
| Deadline click | `onEventEditingStart` → `cancel()` → `router.push(item.href)` | FR-13 |
| `EventEditorDialog` | "New event" button (ADMIN/TEACHER). React Hook Form + `eventInputSchema`. Fields: title, category (HOLIDAY/TERM_BREAK only for admins), all-day switch, date/time pickers (`@mui/x-date-pickers`), location, `MarkdownEditor`, `AudienceBuilder`, recurrence select + until date, RSVP switch + deadline, and admin-only `isNoSchool`/`isPublic`. Results go through `useToast`. | FR-4..7, FR-14 |
| `src/components/AudienceBuilder/` (new shared) | Rows of type `Select` + entity `Autocomplete` (grade level / section / course / role) + three include `Checkbox`es. Types are filtered by `canTargetAudience` rules on the client. The server stays authoritative. | FR-3, FR-7, FR-14 |
| `src/app/(app)/account/calendar/page.tsx` | "Subscribe" card: URL `TextField` (read-only) + copy (`navigator.clipboard`), Google/Apple/Outlook instructions as static text, and "Reset link" behind `ConfirmDialog`. When `url` is null: "Reset link to get a new URL" (D-6). | FR-24, FR-25 |
| `src/app/(app)/admin/academic-years/[id]/page.tsx` | `requirePageRole('ADMIN')`. Year name, read-only term list (existing terms service), and an "Add term breaks" button + `ConfirmDialog` that shows the number of breaks created via toast. | FR-20 |

---

## 3. Data Flow

### 3.1 Calendar read (`GET /api/calendar`, the feed, upcoming events)

```
route → calendarQuerySchema (≤100 days) → getCalendarItems(user, {from,to,sources,studentId})
  1. scope   = studentId ? resolveViewedStudent(user, studentId) : getAccessibleStudentIds(user)   (404 for others)
  2. where   = audienceWhereForUser(user, scope)          // keys computed once
  3. Promise.all([
       events:      CalendarEvent where startAt < to AND (endAt > from OR (recurrence≠NONE AND recurrenceUntil ≥ from))
                    AND (audiences some where) OR createdById=user  (ADMIN: no audience filter)
                    → expandOccurrences(e, from, to, tz) → split into holidays / events by category+isNoSchool,
       assignments: existing assignment service, PUBLISHED, dueAt ∈ [from,to), scoped students/courses,
       quizzes:     existing quiz service, PUBLISHED, availableUntil ∈ [from,to),
       timetable:   getPersonalTimetable(target) projected onto dates in range, skipping noSchoolDays(from,to)
     ]) – only for requested sources
  4. map → CalendarItem union {kind:'event'|'assignment'|'quiz'|'timetable', id, title, start, end, allDay, color, href?, childName?}
```
The feed calls the same function with `from=now−30d, to=now+365d`, sources minus timetable, and recurring events **unexpanded**. Instead of occurrences it gets the series rows so it can emit RRULE. The 100-day cap is skipped because the call is internal. Traces to FR-10, FR-11, FR-15, FR-26, FR-31, FR-32, NFR-4, NFR-5.

### 3.2 Event write

```
POST/PATCH → eventInputSchema → createEvent/updateEvent(user, input)
  - FR-6: non-admin + (isNoSchool | isPublic | HOLIDAY | TERM_BREAK) → 403
  - FR-7: every audience must pass canTargetAudience(user, a) → else 403
  - FR-8: PATCH/DELETE requires createdById===user.id or ADMIN
  - FR-5: isNoSchool ??= category ∈ {HOLIDAY, TERM_BREAK}
  - all-day → schoolMidnight conversion (FR-4)
  - prisma.$transaction: event + replace audiences
  - after commit:
      FR-36 audit() if ADMIN && createdById≠user.id (update/delete)
      FR-28 create: first occurrence within 30 days → notify(HOLIDAY|TERM_BREAK ? 'event.holiday_created' : 'event.created',
            resolveAudienceUserIds(audiences) − creator, link '/calendar?event=<id>')
      FR-29 update: startAt|endAt|allDay|location changed AND event upcoming → notify('event.updated') once
```

### 3.3 Audience resolution (PRD-12 FR-2 semantics)

| Type | refId | Students (`includeStudents`) | Parents (`includeParents`) | Teachers (`includeTeachers`) |
|---|---|---|---|---|
| SCHOOL | null | all active users | | |
| STAFF | null | ADMIN + TEACHER | | |
| ROLE | role name | users with that role | | |
| GRADE_LEVEL | gradeLevelId | `StudentProfile.gradeLevelId = refId` | their `ParentStudentLink` parents | teachers of current-year courses in sections of that grade |
| SECTION | sectionId | current-year `SectionMember`s | their parents | homeroom teacher + teachers of courses in the section |
| COURSE | courseId | ACTIVE `Enrollment`s | their parents | `teacherId` + `coTeacherIds` |

Only ACTIVE, non-archived users count. `isUserInAudience` and `audienceWhereForUser` give the same answer as `resolveAudienceUserIds`. A property-style integration test loops over every seed user to check this (PRD-12 test requirement). Traces to FR-3, FR-7, NFR-7.

### 3.4 School-day check

```
isSchoolDay(date) → d = schoolDateOf(date, tz), isoDay
  1. SchoolDay[isoDay].isTeaching ?? isoDay ≤ 5   → false, reason 'Not a teaching day'
  2. isNoSchool events with a SCHOOL audience where startAt < midnight(d+1) AND (endAt > midnight(d) OR recurring)
     → expandOccurrences within that day → first hit → false, reason 'Holiday: <title>'
  3. → { isSchoolDay: true, reason: null }
noSchoolDays(from, to) = one query, same rules, returns Map<date, reason> (used by the timetable source; avoids N calls)
```
Callers: timetable-service (FR-17), attendance (FR-18), `/api/school-day` (FR-19, FR-34), timetable source in §3.1. Traces to FR-16..19, FR-34.

### 3.5 RSVP

`PUT /api/events/:id/rsvp` → `rsvpSchema` → `upsertRsvp`:
1. Check the event is visible and `rsvpEnabled`. Otherwise 404 (not visible) or 409.
2. Require `isUserInAudience`. Otherwise 403.
3. Require `now < rsvpDeadline`. Otherwise 409.
4. If the user is not a PARENT, force `guests = 0`.
5. Upsert on `(eventId, userId)`.

A recurring event has one RSVP for the whole series. The drawer gets `myRsvp` and totals `{yes, no, maybe, guests}` from `GET /api/events/:id`. Creator and admin read the full list via `/rsvps`, or `?format=csv` via `csv.ts`. Traces to FR-21, FR-22.

### 3.6 Reminder job

Cron `POST /api/internal/email/dispatch` → `sendRsvpReminders(now)` → claim → audience − responders → `notify('event.rsvp_reminder', link '/calendar?event=<id>')`. Traces to FR-23.

### 3.7 iCal feed

```
GET /api/calendar/feed/<token>.ics
  token = param.replace(/\.ics$/, '') → hashToken(token) → CalendarFeedToken by tokenHash (unique) → user ACTIVE?
    no → 404 text/plain
  rateLimit('calfeed:'+hash, 60, 3_600_000) → !ok → 429 + Retry-After
  items = getCalendarItems(user, feed window, series mode)
  body  = buildCalendar(items, tz, window)   // VTIMEZONE for transitions in window, RRULE for series
  200 text/calendar; charset=utf-8, Cache-Control: private, max-age=900
```
Token lifecycle:
- `getOrCreateFeedToken` creates the row on first use from `randomBytes(32).toString('base64url')`, stores `hashToken(raw)`, and returns the URL once.
- `resetFeedToken` upserts a new hash, so the old URL returns 404 immediately.
- No raw token is ever logged.

Traces to FR-24..27, NFR-5, NFR-6, ADR-6, ADR-7.

### 3.8 Public and dashboard hooks

- `getPublicEvents(from, to)`: `isPublic` events, expanded, returning only public-safe fields (id, title, category, start, end, allDay, location, description). Traces to FR-30.
- `getUpcomingEventsForUser(user, limit)`: `getCalendarItems(user, now..now+90d, ['events','holidays'])`, sorted, then the first `limit` items. No UI. Traces to FR-31, NFR-11.

### 3.9 Term breaks

`POST /api/academic-years/:id/term-breaks` (ADMIN) → `createTermBreaks`:
1. Order the terms by `startDate`.
2. For each consecutive pair where `next.start > prev.end + 1 day`, create an all-day TERM_BREAK with `isNoSchool=true` and a SCHOOL audience, from `prev.end+1` (inclusive) to `next.start` (exclusive).
3. Skip any gap that already has a TERM_BREAK with the same span. This makes the call idempotent.
4. Return `{ created }`.
5. Write an `audit()` entry.

Traces to FR-20.

---

## 4. Cross-cutting

- **Time (NFR-3, NFR-8).**
  - Storage is in UTC. Display uses `SchoolSettings.timezone`, read via the existing `getSchoolTimezone()`. No third copy is created.
  - All-day events run from school-tz midnight with an exclusive end.
  - Expansion steps in wall-clock time.
  - The feed uses `VALUE=DATE` for all-day events and `TZID` + VTIMEZONE for series.
  - The scheduler gets `displayTimezone`.
  - One DST-week test fixture (America/New_York 2026-11-01, or the seed tz) runs through the expansion, the all-day path and the feed.
- **Security (NFR-5, NFR-7).**
  - Every route calls `requireUser`/`requireRole`, except the feed (hashed token) and public events (public fields only, IP limit).
  - Per-entity checks live in calendar-service.
  - Students see only themselves, and parents only their linked children (`getAccessibleStudentIds` / `resolveViewedStudent`).
  - A non-visible event returns 404, so its existence doesn't leak.
- **Performance (NFR-4).**
  - A parent with 3 children in month view needs about 6 indexed queries, run in parallel.
  - The audience is filtered in SQL, and holidays are found with one `noSchoolDays` query.
  - There is no cache layer. Add one only if the Playwright timing or a measurement exceeds 500 ms.
- **UI rules (NFR-1, NFR-12).**
  - Only MUI, icons and MUI X (including the scheduler) are used. Toasts go through `useToast`, side panels through `Drawer`, and confirmations through `ConfirmDialog`/`Dialog`.
  - English only. The breakpoint is 768 px.
- **Scope (NFR-11).**
  - Out of scope: per-occurrence exceptions, room booking (`roomId` is stored and unused), two-way sync, and dashboard or public-site UI.
- **Tests (NFR-10).**
  - Unit tests:
    - `expandOccurrences`: weekly, monthly on the 31st, the until bound, a DST week
    - `isSchoolDay`: weekday, holiday, recurring no-school
    - `ical`: escaping `, ; \ \n`, folding, RRULE, VALUE=DATE exclusive end, node-ical parse
    - all-day conversion
    - term-break gap math
    - `canTargetAudience`
  - Integration tests:
    - calendar merge per role (admin, teacher, student, parent with 3 children)
    - feed token reset (old URL 404, new URL 200 and node-ical-valid)
    - RSVP deadline (409) and parent-only guests
    - audience resolver parity across seed users
    - teacher SCHOOL create → 403
  - Playwright:
    - an admin creates a holiday, and the student's Today view shows the holiday name
    - a parent RSVPs
    - the feed URL returns a valid ICS
  - `npm run lint && npm run typecheck && npm run test` stays green.

### Risks carried forward

| Risk | Mitigation |
|---|---|
| R1 Beta scheduler API drift | Exact pin, MCP lookup before use, and the scheduler used only as a read-only display (ADR-2). The D-5 fallback is pre-agreed. |
| R2 Import cycle between timetable and calendar | The edges run one way: timetable-service → calendar-service, and sources.ts → (timetable, assignments, quizzes, calendar-service). calendar-service reads teaching weekdays via `prisma.schoolDay` and never imports timetable-service. |
| R3 DST correctness across 4 code paths | Shared pure helpers in `src/lib/dates.ts` plus one shared DST fixture. |
| R4 Audience is both the hot path and the security boundary | A single implementation plus the parity test. |

---

## 5. Requirements Traceability

| Req | Design element(s) |
|---|---|
| FR-1 | §2.1 exact pin `@mui/x-scheduler@9.0.0-beta.15` + scoped override (ADR-1) |
| FR-2 | §2.2 migration `20261113000000_add_calendar`: enums, 4 models, cascades, `[startAt,endAt]` index |
| FR-3 | §2.2 `AudienceType` (PRD-12 values); §2.3 `announcements/audience.ts`; §3.3 resolution table |
| FR-4 | §2.3 `validators/calendar.ts` + `schoolMidnight`; §3.2 all-day conversion |
| FR-5 | §3.2 `isNoSchool ??= HOLIDAY/TERM_BREAK` in `createEvent` |
| FR-6 | §3.2 admin-only field check; §2.6 editor hides admin fields |
| FR-7 | §2.3 `canTargetAudience`; §3.2 check on create/patch |
| FR-8 | §3.2 creator/ADMIN guard on PATCH/DELETE |
| FR-9 | §2.6 `CalendarView` with `EventCalendar` views/viewConfig/breakpoint; D-5 agenda fallback |
| FR-10 | §2.6 `SourceChips` + localStorage; §3.1 `sources` param, holidays/events split |
| FR-11 | §2.6 parent child filter; §3.1 `studentId` scope + `childName` |
| FR-12 | §2.6 `EventDrawer`; §2.5 `GET /api/events/:id`, `/ics` |
| FR-13 | §2.6 deadline click → `router.push(href)` |
| FR-14 | §2.6 `EventEditorDialog` + `AudienceBuilder` |
| FR-15 | §2.3 `recurrence.ts` `expandOccurrences`; §3.1 read-time expansion |
| FR-16 | §2.3 `isSchoolDay`; §3.4 |
| FR-17 | §2.4 timetable-service hook + Today views |
| FR-18 | §2.4 attendance `noSchoolReason`, `holidayOverride` (D-8), `RegisterForm` banner/confirm |
| FR-19 | §2.4 `AssignmentForm` / `QuizSettingsPanel` warning via `/api/school-day` |
| FR-20 | §2.6 `/admin/academic-years/[id]` page; §2.5 term-breaks route; §3.9 `createTermBreaks` |
| FR-21 | §2.5 `PUT /api/events/:id/rsvp`; §3.5 `upsertRsvp` rules |
| FR-22 | §2.5 `/rsvps[?format=csv]`; §2.6 drawer totals + `DataTable` |
| FR-23 | §2.3 `maintenance.ts`; §2.4 cron hook + type; D-1 `rsvpReminderSentAt` |
| FR-24 | §2.6 `/account/calendar`; §2.5 me/calendar-feed routes |
| FR-25 | §3.7 token lifecycle with `hashToken`; D-6 |
| FR-26 | §2.3 `ical.ts`; §3.7 feed build (window, RRULE, VTIMEZONE, escaping) |
| FR-27 | §2.5 feed route; §3.7 rate limit + Cache-Control |
| FR-28 | §2.4 types `event.created` + `event.holiday_created` (D-3); §3.2 notify on create |
| FR-29 | §2.4 type `event.updated`; §3.2 notify on time/location change |
| FR-30 | §3.8 `getPublicEvents`; §2.5 `/api/public/events` (D-9) |
| FR-31 | §3.8 `getUpcomingEventsForUser` |
| FR-32 | §2.5 `GET /api/calendar`; §3.1 `getCalendarItems`; 100-day cap in validator |
| FR-33 | §2.5 event CRUD + `/ics` routes |
| FR-34 | §2.5 `GET /api/school-day` (singular, new folder) |
| FR-35 | §2.4 `navigation.ts` Calendar entry |
| FR-36 | §3.2 `audit()` on admin edits/deletes of other users' events |
| FR-37 | §2.4 `seedCalendar()` + ROBOTICS course (D-7) |
| NFR-1 | §2.6 MUI-only components; §4 UI rules |
| NFR-2 | §2.1 MCP lookup gate before scheduler use |
| NFR-3 | §2.3 wall-clock expansion, `dates.ts` helpers, ical VALUE=DATE/TZID; §4 DST fixture |
| NFR-4 | §3.1 parallel indexed queries, SQL audience filter, D-2 index; §4 performance |
| NFR-5 | §3.7 32-byte token, SHA-256 hash; §3.1 shared read path |
| NFR-6 | §2.1 `node-ical` devDep; §4 parse tests |
| NFR-7 | §2.5 auth column; §3.3; §4 security |
| NFR-8 | §2.3 module layout under `src/server/calendar/`; thin routes; Zod; UTC storage |
| NFR-9 | §1 reuse list; §2.4 edits instead of new helpers |
| NFR-10 | §4 tests |
| NFR-11 | §4 scope; §3.8 hooks only |
| NFR-12 | §2.6 768 px breakpoint, English only |
