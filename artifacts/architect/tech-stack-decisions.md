# Tech Stack Decisions: PRD-14 School Calendar, Events & Holidays

Ticket: SH-14 · Phase: architect (arch-research-stack) · Timestamp: 2026-11-09T22:40:00Z · Status: complete

> This file replaces the stale SH-13 version. The other files in `artifacts/architect/` are still from SH-13 until their own sub-tasks rewrite them.

**Base stack (checked against `package.json`).** `artifacts/intake/tech-stack.json` reports `react` at 99% confidence, and the workspace matches it:

- Next.js 14.2.18 App Router, React 18.3.1, TypeScript strict
- Prisma 5.20.0 on PostgreSQL 16, Zod 3.23.8, react-hook-form 7.53.0
- MUI 9.5.0: material, icons-material, material-nextjs, x-data-grid, x-date-pickers, x-charts
- date-fns 3.6.0, date-fns-tz 3.2.0, react-markdown 10.1.0 + rehype-sanitize (behind `MarkdownView`)
- Vitest 2.1.1, Testing Library, Playwright 1.47.2

Intake reported no blockers (`blockers: []`, 96% confidence). It raised three warnings and left six unresolved questions (`clarificationLog[0].unresolved`). ADR-1 and ADR-9 through ADR-11 cover the warnings. ADR-12 confirms the intake defaults for the remaining questions.

**Dependency changes (complete list).**

| Package | Version | Kind | Why |
|---|---|---|---|
| `@mui/x-scheduler` | `9.0.0-beta.15` (exact) | dependency | FR-1, FR-9 |
| `node-ical` | `0.27.6` (exact) | devDependency | NFR-6 (tests only) |

Do **not** add `ics`, `rrule`, `luxon`, `dayjs`, SWR/React Query, or any calendar library other than `@mui/x-scheduler`. Reasons are in ADR-3, ADR-5 and NFR-1.

---

## ADR-1: Pin `@mui/x-scheduler@9.0.0-beta.15` and scope the `@mui/x-internals` override

**Context.** FR-1 requires installing `@mui/x-scheduler` first, pinned to the exact version that the MUI MCP server reports. NFR-2 requires checking the docs through the MCP. The MCP `useMuiDocs` listing shows `@mui/x-scheduler@9.0.0-beta.15`, which is also the npm `latest` tag. Its peer dependencies (`react ^18`, `@mui/material ^9.0.0`, `@mui/icons-material ^9.0.0`, `@emotion/* ^11`) are all met.

The conflict is that `package.json` has a global override `"@mui/x-internals": "9.1.0"`. x-scheduler beta.15 depends on `@mui/x-internals` **exactly `9.17.0`**. It also pulls in `@mui/x-tree-view ^9.17.0`, `@mui/x-scheduler-internals 9.0.0-beta.15`, `@base-ui/react ^1.9.0` and `@base-ui/utils ^0.5.0`. With the global override in place, npm would force x-scheduler onto 9.1.0 internals, and that is likely to break at runtime.

**Decision.**
- Run `npm install --save-exact @mui/x-scheduler@9.0.0-beta.15` before any other SH-14 work.
- Scope the override so the existing pinned packages keep 9.1.0 and x-scheduler gets the version it needs:
  ```json
  "overrides": {
    "react-is": "18.3.1",
    "playwright-core": "1.47.2",
    "@mui/x-internals": "9.1.0",
    "@mui/x-scheduler": { "@mui/x-internals": "9.17.0" }
  }
  ```
- Check the result with `npm ls @mui/x-internals`. x-scheduler must resolve 9.17.0, and data-grid, date-pickers and charts must stay on 9.1.0. If npm will not honour the nested override, raise the global override to `9.17.0`. The other three packages declare `^9.1.0`, so 9.17.0 satisfies them. Then re-run `npm run typecheck && npm run test`.
- Add `import type {} from '@mui/x-scheduler/theme-augmentation'` next to the existing theme setup, as the Quickstart shows.

**Consequences.** This is a beta dependency, and the exact pin keeps it reproducible. Upgrading means repeating the MCP lookup. The lockfile grows by the Base UI and tree-view packages, all from MUI. Drives: FR-1, NFR-1, NFR-2.

## ADR-2: Community `EventCalendar` is a read-only, controlled view. SchoolHub owns the editing UI and data loading.

**Context.** I read the MCP docs (Quickstart, Views, Events, Editing, Timezone, Recurring events, Lazy loading, Responsiveness) for beta.15. They show three limits that matter here:
- **Recurrence expansion** and the recurrence tab in the dialog are Premium-only.
- **`dataSource` lazy loading** is only documented on `EventCalendarPremium`.
- **The built-in event dialog** cannot hold SchoolHub's audiences, RSVP, category or `isNoSchool` (FR-12, FR-14).

The Community `EventCalendar` does support the following:
- `views`, `defaultView` / `view` + `onViewChange`
- `viewConfig` (week `startTime: 7`, `endTime: 19`; agenda `dayCount`)
- `displayTimezone` (IANA)
- `readOnly`, `eventCreation={false}`
- `onEventEditingStart` with `cancel()`
- per-event `allDay`, `color`, `readOnly`, `className`

**Decision.**
- Render `<EventCalendar>` from `@mui/x-scheduler/event-calendar` with these props:
  - `views={['month','week','agenda']}`
  - `viewConfig` set to week 07:00–19:00 and agenda `dayCount: 30`
  - `displayTimezone={settings.timezone}`
  - `readOnly`, `eventCreation={false}`
- Choose the default view with MUI `useMediaQuery('(min-width:768px)')`: month at 768 px and wider, agenda below that.
- **Controlled data.** Pass the `events` prop from `GET /api/calendar?from&to&sources&studentId`. Refetch when `onVisibleDateChange` / `onViewChange` fire, using plain `fetch`. Keep a small in-memory cache keyed by range. Do not use `dataSource`, which is Premium.
- **Event click.** In `onEventEditingStart`, call `eventDetails.cancel()`. Then either open SchoolHub's own right-anchored `Drawer` (FR-12) or `router.push` to the assignment or quiz (FR-13). Use the scheduler `id` to tell the kinds apart, prefixed by source: `event:<id>:<occurrenceStart>`, `assignment:<id>`, `quiz:<id>`.
- **Toolbar items.** "New event" (FR-14) is an MUI `Button` that opens a SchoolHub `Dialog`. The source chips (FR-10) are MUI `Chip`s, with their state in `localStorage`.
- **Colours.** Category, subject and timetable colours map to the scheduler's named palette through `color`. The timetable blocks (FR-10) use a lighter `className` style from the theme.
- **Agenda gap.** The PRD asks for infinite scroll in the agenda, which Community doesn't offer. The agenda uses `dayCount: 30` with next/previous paging. If QA requires true infinite scroll, the fallback that PRD FR-3 allows is an MUI `List` with a native `IntersectionObserver` on `< 768 px`, without adding another library. arch-design-system should mark this as an accepted deviation or schedule the fallback.

**Consequences.** We never ship a beta editing flow, and every permission check goes through our own API (NFR-7). The scheduler is a display surface we could swap out later. Drives: FR-9, FR-10, FR-11, FR-12, FR-13, FR-14, NFR-1, NFR-2, NFR-4, NFR-12.

## ADR-3: Expand recurrence on the server with a hand-written `expandOccurrences`, without an RRULE library

**Context.** FR-15 limits recurrence to NONE, WEEKLY and MONTHLY-by-date until `recurrenceUntil`, which can be at most one year out (FR-4). NFR-11 rules out exceptions and complex rules. Community does not expand `rrule` (ADR-2). NFR-3 requires DST-correct dates.

**Decision.**
- `expandOccurrences(event, from, to, tz)` goes in `src/server/calendar/recurrence.ts` and is a pure function.
- Step through the **school-timezone wall clock**:
  - Take the start's local `yyyy-MM-dd HH:mm` with `formatInTimeZone`.
  - Add 7 days, or 1 month with the day of month clamped to skip. A month that lacks the day has no occurrence, which matches RFC 5545 and the scheduler docs.
  - Convert back with `fromZonedTime`.
  - Keep the duration as a wall-clock difference, so an all-day event stays midnight to midnight.
- Stop at the earlier of `recurrenceUntil` (end of that day in the school timezone, inclusive) and `to`.
- The API returns plain occurrences only. The scheduler never receives an `rrule`.

**Consequences.** About 40 lines plus unit tests, including a DST-change week (NFR-10). That is cheaper than adding `rrule`, which is UTC-naive and needs a timezone shim. Drives: FR-15, FR-4, NFR-3, NFR-10, NFR-11.

## ADR-4: Time model: UTC storage, school-timezone rules, and helpers in `src/lib/dates.ts`

**Context.** NFR-8 says to store UTC and display in `SchoolSettings.timezone`. FR-4 stores all-day events as school-timezone midnight with an exclusive `endAt`. FR-16 and FR-34 work on calendar dates in the school timezone. `src/lib/dates.ts` already wraps `date-fns-tz` (`formatInSchoolTz`, `fromZonedTime` usage).

**Decision.**
- Add the small helpers to the existing `src/lib/dates.ts`, without creating a new date module:
  - `schoolMidnight(dateStr, tz)`: `fromZonedTime(\`${d} 00:00\`, tz)`
  - `schoolDateOf(instant, tz)`: `'yyyy-MM-dd'`
- The client sends all-day events as `yyyy-MM-dd` start and inclusive end dates. The Zod validator in `src/lib/validators/calendar.ts` converts them to `[midnight(start), midnight(end+1))`.
- The scheduler receives `Z` instants plus `allDay: true`, and `displayTimezone` places them correctly.

**Consequences.** One source of truth for date rules, and a DST-week test covers the UI path and the feed path (NFR-3). Drives: FR-4, FR-16, FR-34, NFR-3, NFR-8.

## ADR-5: Hand-write the iCalendar builder, emit our own VTIMEZONE, and validate with `node-ical` in tests

**Context.** FR-26 needs RRULE for recurring events, a VTIMEZONE for the school timezone, and RFC escaping. NFR-6 says to parse the feed with `node-ical` in tests. The PRD allows either the `ics` package or a hand-written builder. `ics@3.12.1` writes UTC or floating times and has no VTIMEZONE support, so it cannot express "weekly at 15:30 school time across DST" with RRULE.

**Decision.**
- `src/server/calendar/ical.ts` contains:
  - `escapeText` for `\\`, `;`, `,`, and newline → `\n`
  - `foldLine`: 75 octets, CRLF + space
  - `vtimezone(tz, from, to)`
  - `vevent(...)`
  - `buildCalendar(...)`
- Timed non-recurring events use `DTSTART:...Z`. All-day events use `DTSTART;VALUE=DATE` with an exclusive `DTEND;VALUE=DATE`. Recurring events use `DTSTART;TZID=<tz>` plus `RRULE:FREQ=WEEKLY|MONTHLY;UNTIL=<utc>Z` (MONTHLY adds `BYMONTHDAY`).
- `vtimezone` finds the offset transitions inside the feed window by scanning the window day by day with `getTimezoneOffset`, then narrowing to the minute. It emits one `STANDARD` or `DAYLIGHT` sub-component per transition, each with an explicit `DTSTART`, `TZOFFSETFROM` and `TZOFFSETTO`, which RFC 5545 allows. A zone with no DST (e.g. UTC) gets a single `STANDARD`.
- The same builder serves `GET /api/events/:id/ics` (one event) and the feed. Set `Content-Type: text/calendar; charset=utf-8`.
- Install `node-ical@0.27.6` as an exact devDependency for tests only.

**Consequences.** The builder is about 120 lines with no runtime dependency, and VTIMEZONE is correct for the window actually served. Drives: FR-12, FR-26, FR-33, NFR-3, NFR-6, NFR-10.

## ADR-6: Feed tokens reuse `hashToken` and `randomBytes(32)` from `src/server/auth/tokens.ts`

**Context.** NFR-5 requires 32 random bytes stored hashed. FR-25 says the raw token is shown only at creation or reset. `src/server/auth/tokens.ts` already exports `hashToken` (SHA-256 hex) and generates `randomBytes(32).toString('base64url')`. The token must be found by hash on every feed request, so a slow salted hash such as bcrypt cannot be used. SHA-256 of a 256-bit random value is the standard choice for this.

**Decision.**
- `CalendarFeedToken` is keyed by `userId` with `tokenHash @unique`, per PRD FR-1.
- **Reset** upserts a new hash, so the old URL immediately returns 404.
- **`GET /api/me/calendar-feed`** behaves as follows:
  - With no row yet, it creates one and returns `{ url }`.
  - With an existing row, it returns `{ url: null, hasToken: true, createdAt }`, and the page offers "Reset link" to show a new URL.
- The feed route compares hashes with a DB equality lookup on the unique index. No raw token is logged.

**Consequences.** No new crypto code. Users who lose the URL have to reset it, which is the intent of "shown only at creation/reset". Drives: FR-24, FR-25, NFR-5, NFR-9.

## ADR-7: Feed rate limiting and caching reuse `rateLimit` and plain headers

**Context.** FR-27 sets a limit of 60 requests per token per hour (429), plus `Cache-Control: private, max-age=900`. `src/server/rate-limit.ts` exports `rateLimit(key, limit, windowMs)`, a sliding window that already carries a per-process `ponytail:` note.

**Decision.**
- Call `rateLimit(\`calfeed:${tokenHash}\`, 60, 3_600_000)` **after** the token lookup succeeds, so unknown tokens return 404 and don't fill the map.
- On a 429, set `Retry-After` from `retryAfterMs`.
- Set the cache header directly on the `Response`.

**Consequences.** This inherits the limiter's per-process ceiling, which is acceptable for a single-school deployment. Drives: FR-27, NFR-9.

## ADR-8: Holiday checks are one service, `isSchoolDay`, that reads PRD-06 `SchoolDay` and no-school events

**Context.** FR-16 to FR-19 and FR-34 all ask whether a date is a school day. `timetable-service.ts` already provides `listSchoolDays` (teaching weekdays) and `getScheduleForDate`, which `attendance-service.ts` uses.

**Decision.**
- `isSchoolDay(date)` goes in `src/server/calendar/calendar-service.ts` and returns `{ isSchoolDay, reason }`. It checks:
  1. the ISO weekday against `SchoolDay`
  2. any `isNoSchool` event with a SCHOOL audience whose `[startAt, endAt)` covers that school-timezone date, including recurring occurrences through `expandOccurrences`.
- `getScheduleForDate` calls it and returns `[]` with `reason: 'Holiday: <title>'`. Attendance and the Today views get the reason through that existing path, so no second check is needed.
- The assignment and quiz editor warnings (FR-19) call `GET /api/school-day?date=` from the client. This is new and singular. The existing plural `/api/school-days` is unchanged.

**Consequences.** Every caller goes through one function. Adding the reason field to the `getScheduleForDate` return type is the only change to PRD-06. Drives: FR-16, FR-17, FR-18, FR-19, FR-34, NFR-9.

## ADR-9: SH-14 adds the `AudienceType` enum and audience resolver exactly as PRD-12 specifies (intake warning 1)

**Context.** PRD-12 is not in the workspace, but its spec in `12-announcements.md` defines everything SH-14 needs:
- `enum AudienceType { SCHOOL STAFF ROLE GRADE_LEVEL SECTION COURSE }` with audience rows `{type, refId, includeStudents, includeParents, includeTeachers}`
- `src/server/announcements/audience.ts` exporting `resolveAudienceUserIds(audiences)` and `isUserInAudience(user, audiences)`
- the teacher targeting rule: COURSE audiences for courses they manage, plus their homeroom SECTION

PRD-14 FR-1's `EventAudience` already uses exactly these fields. The models the resolver needs (`StudentProfile.gradeLevelId`, `ParentStudentLink`, `Section.homeroomTeacherId`, `SectionMember`, `Course`, `Enrollment`) all exist.

**Decision.**
- Add `enum AudienceType` with the exact PRD-12 values in SH-14's migration. Do **not** add the `Announcement` models.
- Implement `src/server/announcements/audience.ts` at the PRD-12 path, with the PRD-12 FR-2 semantics, plus `canTargetAudience(user, audience)` for the FR-3 teacher rule. PRD-12 can then use it as it is, without a rename or a second copy (NFR-9).
- The seed's "Grade 7 parents" audience is `GRADE_LEVEL` with `includeStudents=false, includeTeachers=false`.
- Build a minimal `src/components/AudienceBuilder/` from MUI. Each row is a type `Select`, an entity `Autocomplete`, and three `Checkbox`es. It has no live recipient count, because that needs PRD-12's preview endpoint.
- Seed "Sports day" without an announcement link (intake default).

**Consequences.** FR-3, FR-7 and FR-14 move from LOW/MEDIUM confidence to buildable. PRD-12 later adds its own models, reuses the enum and helper, and may extend the builder. Drives: FR-3, FR-6, FR-7, FR-14, FR-37, NFR-7, NFR-9.

## ADR-10: Create a minimal `/admin/academic-years/[id]` page for "Add term breaks" (intake warning 2)

**Context.** FR-20 names this page, but only the REST API exists (`src/app/api/academic-years/[id]/…`, including terms). Moving the shortcut to another screen would break the PRD's route.

**Decision.**
- Add a server page `src/app/(app)/admin/academic-years/[id]/page.tsx`, ADMIN only. It shows the year, a read-only term list from the existing API or service, and an "Add term breaks" `Button` with a `ConfirmDialog`.
- The button posts to a calendar-service function that creates TERM_BREAK no-school events for each gap between consecutive terms. It is idempotent: it skips gaps that already have a TERM_BREAK.
- Term editing UI is out of scope (NFR-11).

**Consequences.** One small page, no new academic-structure behaviour. Drives: FR-20, FR-35, NFR-11.

## ADR-11: Maintenance and notifications reuse the existing cron and registry

**Context.** FR-23, FR-28 and FR-29 add the notification types `event.rsvp_reminder`, `event.created` and `event.updated`. The internal dispatch cron (`src/app/api/internal/email/dispatch/route.ts`) already runs `src/server/quiz/maintenance.ts`, the PRD-10 precedent.

**Decision.**
- Register the three types in `src/server/notifications/types.ts` under `COMMUNICATION`, with the email defaults per FR-28 (HOLIDAY and TERM_BREAK: true).
- Add `src/server/calendar/maintenance.ts` → `sendRsvpReminders(now)`, called from the dispatch route next to the quiz maintenance call.
- "Once per event" needs to be stored somewhere. Add a nullable `CalendarEvent.rsvpReminderSentAt DateTime?` and set it in the same transaction.
- For FR-28 and FR-29, call the existing `notify` from the event service on create or update. The update path compares old and new time and location fields.

**Consequences.** No new job runner. The one column added beyond the PRD model is flagged here for arch-design-system to confirm. The alternative would be checking for existing Notification rows, which is slower. Drives: FR-23, FR-28, FR-29, NFR-9.

## ADR-12: Defaults for the remaining intake questions

**Context.** These are the intake `clarificationLog` items that ADR-9 to ADR-11 don't settle.

**Decision.** Keep intake's defaults:
- **Chips.** The Holidays chip controls events that are HOLIDAY, TERM_BREAK or `isNoSchool`. The School events chip controls all other events. No event appears under both.
- **RSVP guests.** Only PARENT responders may set `guests`. The Zod schema forces 0 for other roles.
- **Feed scope.** The teacher and admin feed shows exactly what `GET /api/calendar` shows them. Teachers get the deadlines of the assignments and quizzes they set.

**Consequences.** The feed and the UI share one query path (`getCalendarItems(user, range, sources)`), so NFR-5 ("feed exposes nothing beyond the app") holds by construction. Drives: FR-10, FR-21, FR-26, FR-32, NFR-5.

## ADR-13: Performance target (500 ms month view for a parent with 3 children) without new infrastructure

**Context.** NFR-4. A month query covers one range of at most 42 days, merging events, assignments, quizzes and timetable for three children.

**Decision.**
- Resolve the user's audience keys once per request: the children's grade levels, sections, courses and roles.
- Query `CalendarEvent` through the `[startAt, endAt]` index. Recurring events are matched by `startAt <= to AND (recurrenceUntil >= from OR recurrence = NONE AND endAt >= from)`.
- Filter the audience in SQL on `EventAudience` with `OR` over those keys. Do not call `isUserInAudience` once per event.
- Run the four source queries with `Promise.all`.
- No caching layer.

**Consequences.** A small, fixed number of indexed queries. Add a cache only if a measurement shows a miss. Drives: FR-32, NFR-4.
