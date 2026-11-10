# Coverage Report — SH-14 (PRD-14 School Calendar, Events & Holidays)

> This file replaces the SH-13 coverage report.
>
> **Method.** `@vitest/coverage-v8` is not installed. QA did not add a dependency just to measure coverage. Instead, every exported function in the code Dev shipped was mapped by hand to the tests that execute it. Integration tests ran against real Postgres, with `TEST_DATABASE_URL` set to the dev database.

## Scope: what Dev actually shipped

Dev finished TASK-1 to TASK-7 of 27 tasks. **TASK-8 to TASK-27 have no code at all.** That covers every service, API route, page, seed change and the integration and E2E suites. The "not built" table below lists those files.

| File | Change | Exported functions / units | Covered by | Function coverage |
|---|---|---|---|---|
| `src/lib/dates.ts` (+18 lines) | MODIFY | `schoolMidnight`, `schoolDateOf`, `addDateDays` | `tests/unit/dates.test.ts` (4 SH-14 cases, including DST week) | 3/3 |
| `src/lib/validators/calendar.ts` (211) | CREATE | `audienceInputSchema`, `eventInputSchema`/`checkEvent`, `eventPatchSchema`, `rsvpSchema`, `calendarQuerySchema`, `schoolDayQuerySchema`, `publicEventsQuerySchema` | `tests/unit/calendar/validators.test.ts` (12), `tests/unit/calendar/qa-sh14.test.ts` (3) | 7/7 |
| `src/server/calendar/recurrence.ts` (85) | CREATE | `expandOccurrences` (plus internal `naive`, `fromNaive`, `overlaps`) | `recurrence.test.ts` (6), `qa-sh14.test.ts` (3) | 1/1 |
| `src/server/calendar/ical.ts` (160) | CREATE | `escapeText`, `foldLine`, `vtimezone`, `vevent`, `buildCalendar` | `ical.test.ts` (10, parsed with node-ical), `qa-sh14.test.ts` (3) | 5/5 |
| `src/server/announcements/audience.ts` (221) | CREATE | `audienceClausesForUser`, `audienceWhereForUser`, `audienceMatchesClauses`, `isUserInAudience`, `resolveAudienceUserIds`, `canTargetAudience` | `tests/unit/calendar/audience.test.ts` (6, mocked DB), **`tests/integration/calendar/qa-sh14.test.ts` (7, real Postgres, QA)** | 6/6 |
| `src/server/notifications/types.ts` (+33) | MODIFY | 4 `event.*` registrations | `tests/unit/calendar/qa-sh14.test.ts` (QA) | 4/4 |
| `prisma/schema.prisma` and migration `20261113000000_add_calendar` | MODIFY/CREATE | 4 enums, 4 models | `prisma migrate status` reports the schema up to date. `tests/integration/calendar/qa-sh14.test.ts` checks defaults, the composite RSVP PK, cascades and the unique token hash. | 4/4 models exercised |
| `src/theme/theme.ts` (+2) | MODIFY | scheduler theme augmentation (type-only) | `npm run typecheck` ✅ | n/a |
| `package.json` / lock | MODIFY | `@mui/x-scheduler@9.0.0-beta.15`, `node-ical@0.27.6`, scoped override | `npm ls @mui/x-internals` shows 9.17.0 overridden | n/a |

**Shipped code: 26 of 26 exported functions/units have at least one executing test (100% function coverage).**

### Branches still uncovered in shipped code
- `audience.ts` `resolveOne`: `ROLE` with a null `refId`, and `GRADE_LEVEL` with `includeTeachers` only. Teacher clauses for courses outside the current year.
- `audience.ts` `isUserInAudience([])`, the empty-audience early return.
- `recurrence.ts`: the `MAX_STEPS` guard is never reached. A one-year weekly series yields 53 steps, which QA asserts.
- `ical.ts` `vevent`: an all-day **series** (DATE-valued `UNTIL`) is not tested.

## Not built (0% coverage, files missing)

| Task | Missing files |
|---|---|
| TASK-8 | `src/server/calendar/calendar-service.ts` |
| TASK-9 | `src/server/calendar/sources.ts` |
| TASK-10 | `src/server/calendar/maintenance.ts`. The dispatch route was not modified. |
| TASK-11–13 | No changes to `timetable-service.ts`, `attendance-service.ts`, attendance validator, register route or page, `RegisterForm.tsx` |
| TASK-14 | `src/app/api/events/route.ts`, `[id]/route.ts`, `[id]/ics`, `[id]/rsvp`, `[id]/rsvps` |
| TASK-15 | `src/app/api/calendar/route.ts`, `src/app/api/school-day/route.ts`, `academic-years/[id]/term-breaks/route.ts` |
| TASK-16 | `me/calendar-feed` (plus `reset`), `calendar/feed/[token]`, `public/events`. `public-routes.ts` was not modified. |
| TASK-17–22 | `AudienceBuilder.tsx`, `EventEditorDialog.tsx`, `EventDrawer.tsx`, `calendar/page.tsx`, `CalendarView.tsx`, `SourceChips.tsx`, `account/calendar/*`, `admin/academic-years/[id]/*`. `navigation.ts` was not modified. |
| TASK-23 | No warnings in `AssignmentForm.tsx` or `QuizSettingsPanel.tsx` |
| TASK-24 | `prisma/seed.ts` has no calendar events |
| TASK-25–27 | `tests/integration/calendar/{calendar-merge,audience-parity,school-day,events-rsvp,feed-token}.test.ts`, `tests/e2e/calendar.spec.ts` |

Across all of PRD-14, 16 of the 61 entries in the ownership matrix are done (all TASK-1 to TASK-7 files). 31 CREATE files are missing. The 14 existing files that later tasks were meant to MODIFY were not touched. By task, 7 of 27 planned tasks are done (about 26%).
