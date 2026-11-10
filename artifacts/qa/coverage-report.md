# Coverage Report — SH-15 (PRD-15 Parent Portal)

> This file replaces the SH-14 coverage report.

## Method

The project has no instrumented coverage tool: `@vitest/coverage-v8` is not installed, and QA did not add a dependency for it. Coverage below is **behavioural**. Each exported function or page the Dev agent wrote is mapped to the automated test that exercises it.

Commands used:
- `npx vitest run <files>` with `TEST_DATABASE_URL=$DATABASE_URL` (local Postgres :5433). Fixtures are tagged and deleted in `afterAll`.
- `PORT=3100 APP_URL=http://localhost:3100 npx playwright test tests/e2e/{absence-notes,conferences,consent-forms}.spec.ts` against `npm run build` + `next start`.

## Test inventory (SH-15)

| File | Author | Kind | Tests | Result |
|---|---|---|---|---|
| tests/unit/absence-notes/absence-coverage.test.ts | Dev | unit | 4 | pass |
| tests/unit/conferences/conference-slots.test.ts | Dev | unit | 5 | pass |
| tests/unit/consent-forms/signature.test.ts | Dev | unit | 2 | pass |
| tests/integration/absence-notes/absence-approval.test.ts | Dev | integration (DB) | 4 | pass |
| tests/integration/conferences/concurrent-booking.test.ts | Dev | integration (DB) | 3 | pass |
| **tests/unit/parent-portal/qa-sh15-validators.test.ts** | **QA (new)** | unit | 16 | pass |
| **tests/integration/parent-portal/qa-sh15.test.ts** | **QA (new)** | integration (DB) | 13 | pass |
| tests/e2e/absence-notes.spec.ts | Dev (fixture fixed by QA) | Playwright | 2 | pass |
| tests/e2e/conferences.spec.ts | Dev (fixture fixed by QA) | Playwright | 1 | pass |
| tests/e2e/consent-forms.spec.ts | Dev (fixture fixed by QA) | Playwright | 1 | pass |
| **Total** | | | **51** | **51 pass** |

QA fix to the e2e fixtures: `conferences.spec.ts` and `consent-forms.spec.ts` both created a grade level with `order: max(order)+1`. Under parallel workers this collided on the unique `order` constraint, and the conferences spec failed 1 time in 1 parallel run. A random offset now matches the pattern the integration tests use. After the fix, 4/4 pass in parallel.

## Per-module coverage

| Module | Functions covered by tests | Not covered |
|---|---|---|
| `src/lib/validators/absence-notes.ts` | `absenceNoteInputSchema`, `absenceNoteSchemaFor`, `reviewSchema` (QA unit) | `absenceNoteListQuery` (exercised only via the UI/e2e) |
| `src/lib/validators/conferences.ts` | `conferenceEventInputSchema`, `bookingSchema`, `availabilitySchema` (QA unit) | `conferenceEventPatchSchema`, `slotPatchSchema`, list queries |
| `src/lib/validators/consent-forms.ts` | `consentResponseSchema`, `trackingQuery` (QA) | `consentFormInputSchema` past-due refine |
| `src/server/absence-notes/absence-coverage.ts` | `coversRecord` (Dev unit) | — |
| `src/server/absence-notes/absence-notes-service.ts` | `submit`, `review`, `findCovering`, `assertHomeroomOrAdmin` (Dev integration + e2e) | `list` filters (status/date) are covered only via e2e page load |
| `src/server/attendance/attendance-service.ts` (SH-15 edits) | pre-fill, EXCUSED rule, absent suppression (Dev integration; `attendance-qa` FR-10/FR-19 now passes) | — |
| `src/server/conferences/conference-slots.ts` | `generateSlots`, `overlaps` (Dev unit) | — |
| `src/server/conferences/conferences-service.ts` | `createEvent`, `setAvailability`, `patchSlot`, `book`, `cancel`, `teacherDay`/`listSlots(view=day)`, `listMyMeetings` (QA + Dev integration) | `updateEvent` (409 when booked), `removeSlot`, `listEvents`, `getEvent`, `slotIcs` body |
| `src/server/consent-forms/consent-forms-service.ts` | `create`, `respond`, `tracking` (JSON + CSV), `remind`, `sendConsentDueReminders`, `assertConsentOwnerOrAdmin` (QA integration) | `list` (parent pending filter is reached indirectly via `getActionItems`) |
| `src/server/consent-forms/signature.ts` | `signatureMatches` (Dev + QA unit) | — |
| `src/server/parent/selected-child.ts` | `getSelectedChild` (QA unit, with mocked cookie/DB) | `setSelectedChildCookie` |
| `src/server/parent/overview-service.ts` | `getOverview` (all 8 cards), `getActionItems`, `getUpcomingEvents` (QA integration) | `getChildrenSummary`; the card contents of today/attendance/assignments/grades/teachers are run but not value-asserted |
| `src/server/files/contexts.ts` (`absenceNoteResolver`) | upload path covered by the e2e absence spec | resolver allow/deny matrix not unit-tested |
| `src/server/notifications/types.ts` | all 7 new keys used by passing tests (`absence_note.*`, `conference.*`, `consent.*`) | — |
| API routes (21 files under `src/app/api/**`) | thin wrappers (`withHandler → requireRole → Zod → service`). The e2e specs exercise booking, review, consent response and absence submission. | `selected-child`, `me/children/summary`, `students/:id/overview`, `conference-slots/:id/ics`, `availability`, `remind`, `tracking` are called directly through services, not over HTTP |
| UI pages/components (32 `.tsx` files) | e2e covers the absence form, review queue + register, booking page, consent respond page | `ChildSwitcher`, `/my-children` summary cards, `/admin/conferences`, availability page, day view, consent create/tracking UI have **no automated UI test** |
| `prisma/seed.ts` (`seedParentPortal`) | manual run state checked: event + 24 slots + calendar event + consent form present | the bookings, absence notes and 40% responses are skipped locally because the DB has no Grade 7 students with linked parents |

## Estimate

- **Services and validators (logic):** about 80% of exported functions are exercised by tests. Every money-path or safety-path rule has a test: atomic booking, overlap, window, EXCUSED conversion, suppression, signature, one response per student, throttle, and the 48 h reminder.
- **API route handlers:** about 35% are hit over HTTP. The rest are one-line delegations to tested services.
- **UI:** about 30% of the new pages have Playwright coverage. The remaining admin and teacher screens are untested.

## Gaps worth closing next
1. Playwright for `ChildSwitcher` (FR-3/FR-6) and the `/my-children` multi-child summary (FR-7).
2. Unit tests for the `absenceNoteResolver` access matrix (FR-41).
3. `updateEvent` 409 when slots are booked, and `removeSlot` of a booked slot.
