# QA Report — SH-14 (PRD-14 School Calendar, Events & Holidays)

## QA Summary

- ticketId: SH-14
- timestamp: 2026-11-10T00:49:09Z
- overallStatus: FAIL
- requirementsChecked: 49
- requirementsPassed: 5
- requirementsFailed: 44

> `requirementsFailed` counts **12 FAIL**, meaning partly built, plus **32 NOT-IMPLEMENTED**, meaning no code exists.
>
> This file replaces the SH-13 QA report.

## Headline findings

### 1. Dev phase incomplete: 7 of 27 tasks shipped (blocking)
`task-completion-markers.json` lists TASK-1 to TASK-7 only. `dev-rerun-count.json` shows 3 Dev runs, and earlier runs hit the turn limit. TASK-8 to TASK-27 have **no code**:
- no calendar service
- no API routes
- no `/calendar` or `/account/calendar` pages
- no holiday integration in timetable or attendance
- no seed data
- no integration or E2E suites

31 of the 61 ownership-matrix files are missing (see `coverage-report.md`). PRD-14 cannot be used by any role. Every user-facing acceptance criterion (1 to 8) is unmet.

### 2. What did ship is real and correct
The shipped foundation is real code: the scheduler deps, the Prisma models and migration, date helpers, validators, the recurrence expander, the iCal builder, the audience resolver and the notification types. Nothing is a stub: there are no TODOs and no placeholder bodies. All of it passes its tests, including **17 new QA tests**, 7 of them on real Postgres.

### 3. Dev test defect fixed by QA (test-only)
`tests/unit/calendar/ical.test.ts:11` expected `'…b\;c…'`. In a JS string, `\;` is a plain `;`, so the test asserted the **pre-fix** behaviour and failed against the corrected `escapeText`. The RFC 5545 output `\;` is right. QA changed the expectation to `'…b\\;c…'`. **QA changed no product code.**

### 4. Full suite not green, all failures pre-existing (NFR-10)
| Run | Result |
|---|---|
| `vitest run` (no DB) | 410 pass, 2 fail, `lockout.test.ts` fails to load. **All three appear in the SH-11/SH-13 baseline:** `auth-forms` ForgotPasswordForm focus, `useToast` auto-hide, `lockout` next-auth ESM. |
| `vitest run` (`TEST_DATABASE_URL` = dev DB) | 559/565. Baseline failures: `attendance-qa` FR-22 and FR-10/FR-19. Also `qa-sh9` FR-13/FR-42 and `attendance-qa` NFR-1 (perf) failed. **Both pass when re-run in isolation**, so they are flaky under parallel load. None of the failing files imports SH-14 code. |
| `npm run typecheck` | ✅ clean |
| `npm run lint` | ✅ no warnings or errors |
| `prisma migrate status` | ✅ 14 migrations, schema up to date |
| SH-14 tests (unit + QA integration) | ✅ **64/64** (Dev 47, including the fixed ical test, plus QA 17) |

## Requirement Results

| Requirement | Status | Evidence |
|---|---|---|
| FR-1 | PASS | `package.json`: `@mui/x-scheduler` `9.0.0-beta.15` exact, `node-ical` `0.27.6`, scoped `@mui/x-internals` override. `npm ls` shows 9.17.0 overridden. `src/theme/theme.ts` augmentation passes `npm run typecheck`. |
| FR-2 | PASS | `prisma/schema.prisma` has 4 enums and 4 models, with `@@id([eventId,userId])`, cascades and `@@index([startAt,endAt])`. Migration `20261113000000_add_calendar` is applied. `tests/integration/calendar/qa-sh14.test.ts` "TASK-2 schema…" checks the duplicate RSVP (P2002), the unique token hash and the cascade on event delete. |
| FR-3 | PASS | `AudienceType` (SCHOOL/STAFF/ROLE/GRADE_LEVEL/SECTION/COURSE) is defined in the schema, with the resolver at `src/server/announcements/audience.ts`. `qa-sh14.test.ts` (integration): COURSE/SECTION/GRADE_LEVEL/SCHOOL/STAFF/ROLE resolve correctly, **and resolver ↔ user-side parity holds for all 10 fixture users**. |
| FR-4 | FAIL | Partly built. The Zod rules are in `src/lib/validators/calendar.ts`, tested by `validators.test.ts` and `qa-sh14.test.ts` (title ≤150, description ≤5000, end ≥ start, until required and ≤1 year, guests 0–5). `schoolMidnight` exists (`dates.test.ts`). **Nothing stores events yet** (no calendar-service, TASK-8), so all-day midnight/exclusive-end storage is not wired. |
| FR-5 | NOT-IMPLEMENTED | `isNoSchool` defaults to `false` in the schema and has no validator default. QA test "isNoSchool has no schema default" confirms this. The category-based default belongs in the missing `calendar-service.ts`. |
| FR-6 | NOT-IMPLEMENTED | Only the `ADMIN_ONLY_CATEGORIES` constant exists. Nothing enforces it: no service and no `POST /api/events`. |
| FR-7 | FAIL | Partly built. `canTargetAudience` is correct: `audience.test.ts` (mocked) and `qa-sh14.test.ts` (real DB: teacher and co-teacher may target their COURSE, homeroom teacher their SECTION, a non-homeroom teacher may not, SCHOOL denied). **No `POST /api/events`**, so the 403 acceptance path does not exist. |
| FR-8 | NOT-IMPLEMENTED | `src/app/api/events/[id]/route.ts` and `calendar-service.ts` are missing. |
| FR-9 | NOT-IMPLEMENTED | `src/app/(app)/calendar/page.tsx` and `CalendarView.tsx` are missing. |
| FR-10 | NOT-IMPLEMENTED | `SourceChips.tsx` and `sources.ts` are missing. Only the label and colour constants exist in the validators. |
| FR-11 | NOT-IMPLEMENTED | No calendar page and no `sources.ts`. The resolver's `studentIds` filter exists (`qa-sh14.test.ts`), but no code uses it. |
| FR-12 | NOT-IMPLEMENTED | `EventDrawer.tsx` and `api/events/[id]/ics` are missing. |
| FR-13 | NOT-IMPLEMENTED | No calendar page and no deadline sources. |
| FR-14 | NOT-IMPLEMENTED | `EventEditorDialog.tsx` and `AudienceBuilder.tsx` are missing. |
| FR-15 | FAIL | Partly built. `expandOccurrences` is correct: `recurrence.test.ts` (weekly, monthly on the 31st, until, DST) and `qa-sh14.test.ts` (in-progress occurrence, empty range, 1-year bound). **No `GET /api/calendar`** returns occurrences. Series edits are not implemented. |
| FR-16 | NOT-IMPLEMENTED | `src/server/calendar/calendar-service.ts` (`isSchoolDay`) is missing. |
| FR-17 | NOT-IMPLEMENTED | `timetable-service.ts` `getScheduleForDate` is unchanged (`git diff` is empty). |
| FR-18 | NOT-IMPLEMENTED | Attendance service, route, page and `RegisterForm` are unchanged. |
| FR-19 | NOT-IMPLEMENTED | `AssignmentForm.tsx` and `QuizSettingsPanel.tsx` are unchanged. |
| FR-20 | NOT-IMPLEMENTED | `admin/academic-years/[id]` page and `term-breaks` route are missing. |
| FR-21 | NOT-IMPLEMENTED | `api/events/[id]/rsvp` is missing. `rsvpSchema` exists (`validators.test.ts`), but nothing enforces deadlines. |
| FR-22 | NOT-IMPLEMENTED | `api/events/[id]/rsvps` (CSV) and the drawer are missing. |
| FR-23 | FAIL | Partly built. `event.rsvp_reminder` is registered (`qa-sh14.test.ts` unit). `src/server/calendar/maintenance.ts` and the dispatch hook are missing, so nothing sends it. |
| FR-24 | NOT-IMPLEMENTED | `account/calendar/page.tsx` and `SubscribeCard.tsx` are missing. |
| FR-25 | NOT-IMPLEMENTED | `api/me/calendar-feed` (plus `reset`) is missing. Only the `CalendarFeedToken.tokenHash` column exists. |
| FR-26 | FAIL | Partly built. The RFC 5545 builder is correct: `ical.test.ts`, parsed by node-ical, covers escaping, folding, VTIMEZONE, RRULE with BYMONTHDAY, VALUE=DATE exclusive end, and URL on deadlines. `qa-sh14.test.ts` adds an empty feed, DST and non-DST VTIMEZONE, and a 75-octet boundary. **Nothing selects feed content** (no `sources.ts`, no feed route). |
| FR-27 | NOT-IMPLEMENTED | `api/calendar/feed/[token]/route.ts` is missing. `public-routes.ts` is unchanged. |
| FR-28 | FAIL | Partly built. `event.created` (email false) and `event.holiday_created` (email true) are registered (`qa-sh14.test.ts`). No create path sends them. |
| FR-29 | FAIL | Partly built. `event.updated` is registered (`qa-sh14.test.ts`). No PATCH path sends it. |
| FR-30 | NOT-IMPLEMENTED | `getPublicEvents` and `api/public/events` are missing. Only `publicEventsQuerySchema` exists. |
| FR-31 | NOT-IMPLEMENTED | `getUpcomingEventsForUser` is missing. |
| FR-32 | NOT-IMPLEMENTED | `api/calendar/route.ts` is missing. `calendarQuerySchema` (≤100 days) is tested, but nothing serves it. |
| FR-33 | NOT-IMPLEMENTED | All `api/events/**` routes are missing. |
| FR-34 | NOT-IMPLEMENTED | `api/school-day/route.ts` is missing. |
| FR-35 | NOT-IMPLEMENTED | `src/config/navigation.ts` has no calendar entries. |
| FR-36 | NOT-IMPLEMENTED | No edit or delete path exists, so nothing calls `audit()`. |
| FR-37 | NOT-IMPLEMENTED | `prisma/seed.ts` has no calendar events (0 matches). |
| NFR-1 | NOT-IMPLEMENTED | No calendar UI shipped. `grep` finds no banned imports (FullCalendar, react-datepicker, notistack, tailwind) in `src/`, but Drawer, Dialog and useToast usage cannot be verified without UI. |
| NFR-2 | NOT-IMPLEMENTED | No MUI components were used yet, so there are no MCP lookups to verify. |
| NFR-3 | FAIL | Partly built. DST-week tests pass for expansion (`recurrence.test.ts`), all-day midnight (`dates.test.ts`) and iCal (`ical.test.ts` "weekly RRULE keeps 15:30 local across DST"). There is no UI and no feed endpoint to render on the correct dates. |
| NFR-4 | NOT-IMPLEMENTED | No month-view endpoint or page to measure. |
| NFR-5 | FAIL | Partly built. The schema stores only `tokenHash` (unique, checked in `qa-sh14.test.ts`). No 32-byte token generation and no feed scoping exist. |
| NFR-6 | PASS | `tests/unit/calendar/ical.test.ts` "buildCalendar parsed by node-ical" (6 cases) and `qa-sh14.test.ts` empty-feed parse. The generator output is valid per node-ical. |
| NFR-7 | NOT-IMPLEMENTED | No route handlers or server pages exist, so there are no `requireUser`/`requireRole` checks to verify. |
| NFR-8 | FAIL | Partly built. The shipped code follows conventions: cuid IDs, `createdAt`/`updatedAt` on the main models, client-safe Zod validators, services under `src/server/calendar/`, no `console.log`. There are no handlers to check for response shapes or error codes. |
| NFR-9 | FAIL | Partly built. The shipped code reuses `assertCanManageCourse`, `AppError`, `formatInSchoolTz`/`fromZonedTime` and the `dateOnly` validator, with no duplicate helpers and no renames. The planned reuse of `getScheduleForDate`, `rateLimit`, `notify`, `audit` and the maintenance cron is not built. |
| NFR-10 | FAIL | Lint ✅, typecheck ✅, SH-14 unit tests ✅ 57/57 (Dev 47 + QA 10). Of the required suites, **integration** (calendar merge, feed token reset, RSVP deadline) and **Playwright** (3 scenarios) do not exist. The full suite is not green (pre-existing failures, Headline 4). |
| NFR-11 | PASS | No out-of-scope behaviour shipped. `roomId` is stored but unused (schema comment). Recurrence is NONE/WEEKLY/MONTHLY only (`recurrence.ts`). There are no exception or sync models. |
| NFR-12 | NOT-IMPLEMENTED | No UI exists for browser support or the 768 px default-view rule. |

## Checks run

| Check | Result |
|---|---|
| Ownership matrix (61 entries) | TASK-1 to TASK-7: 16/16 present and non-stub (no TODO, FIXME or placeholder). TASK-8 to TASK-27: 31 CREATE files missing, 14 MODIFY files unchanged. |
| SH-14 tests, `TEST_DATABASE_URL` set | ✅ 64/64 in 7 files |
| QA fixture cleanup | ✅ 0 `qa-sh14` users left in the DB after the run |
| Full suite, typecheck, lint | See Headline 4 |

## QA test files added
- `tests/integration/calendar/qa-sh14.test.ts` (7 tests, real Postgres): audience resolution for every AudienceType, resolver ↔ `isUserInAudience` parity, `audienceWhereForUser` SQL filter including the parent child-filter, dedupe and inactive-user exclusion, `canTargetAudience` on real rows, and the schema constraints and cascades.
- `tests/unit/calendar/qa-sh14.test.ts` (10 tests): notification type defaults, `expandOccurrences` edge cases, iCal fold boundary, empty feed, DST and non-DST VTIMEZONE, validator boundaries, and the missing FR-5 default.
- `tests/unit/calendar/ical.test.ts`: one wrong expectation corrected (Headline 3).

## Recommendation
Re-run the Dev phase for TASK-8 to TASK-27, then run QA again. The foundation from TASK-1 to TASK-7 is solid and tested, and can be built on unchanged. When Dev adds the calendar service, add a case to `tests/unit/calendar/qa-sh14.test.ts` (or Dev's service tests) for the **FR-5 category default**.
