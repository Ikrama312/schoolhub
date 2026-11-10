# QA Report — SH-15 (PRD-15 Parent Portal: Child Switcher, Absence Notes & Conference Booking)

## QA Summary

- ticketId: SH-15
- timestamp: 2026-11-10T03:59:36Z
- overallStatus: PARTIAL
- requirementsChecked: 56
- requirementsPassed: 53
- requirementsFailed: 3

> `requirementsFailed` is **2 FAIL** (partly built: FR-5, FR-35) plus **1 NOT-IMPLEMENTED** (FR-13). All three depend on PRD-12 Announcements or the PRD-14 calendar UI, and neither exists in this workspace. The Architect accepted these three as partial in ADR-11. They are listed here so they aren't lost. Everything SH-15 owns end to end passes.
>
> This file replaces the SH-14 QA report.

## Headline findings

1. **The build and gates are green for SH-15.** `npm run typecheck` is clean, `npm run lint` is clean and `npm run build` succeeds. All 51 SH-15 tests pass: 27 unit, 20 DB integration, 4 Playwright.
2. **Dev's self-report matches reality.** All 27 tasks are marked complete, and all 81 paths in `file-ownership-matrix.json` exist. A scan found no `TODO`/`FIXME`/stub markers in them. The only intentional stub is `listUnreadAnnouncements()`, which returns `[]` (FR-13, see below).
3. **No regressions from SH-15.** The full suite with DB shows 9 failures in parallel and 1 when each suite runs alone. All of them pre-date SH-15:
   - `attendance-qa` **FR-22 A→P→A** fails. QA confirmed this by swapping in the HEAD (`SH-14`) `attendance-service.ts`: the same test fails there too, and the file was restored afterwards.
   - The same baseline run also failed **FR-10/FR-19, "teacher re-saves admin-EXCUSED row"**. SH-15 **fixes** this one.
   - `auth-forms`, `lockout` and `useToast` unit failures come from untouched files.
   - `email-dispatch`, `qa-sh9` and the other `attendance-qa` cases fail only under parallel shared-DB runs and pass in isolation.
4. **Flaky e2e fixture fixed.** `conferences.spec.ts` and `consent-forms.spec.ts` raced on `gradeLevel.order = max+1` under parallel workers, and the conferences spec failed in the first run. QA changed both to use a random offset. Now 4/4 pass in parallel.
5. **Seed observation (FR-45, minor).** The seeded "Science Museum Trip" form is created by Tom, a TEACHER, with a GRADE_LEVEL audience. The consent service would refuse that for a teacher (FR-36: teachers target only their courses). It is harmless as demo data, but the tracking page would show Tom owning a form he couldn't have created. Suggest `createdById: admin.id`.
6. **Seed in the local DB is only partly visible.** The event, 24 slots, calendar event and consent form exist. The 2 bookings, 2 absence notes and 40% responses are skipped because the local DB has 0 Grade 7 students with linked parents. The skip is by design and is logged.

## New QA tests

- `tests/unit/parent-portal/qa-sh15-validators.test.ts` (16 tests) covers:
  - FR-2 rules: date order, 30-day span, 1,000-char details, periods only with partialDay, slotMinutes 5–60, 500-char parentNote.
  - The FR-18 −14/+60 day window.
  - FR-22: rejecting requires a note.
  - The FR-37 signature rule.
  - FR-4/FR-5 `sh_child`: a linked cookie is honoured, an unlinked cookie falls back to the first child, and `?studentId=` overrides the cookie.
- `tests/integration/parent-portal/qa-sh15.test.ts` (13 tests, real DB) covers:
  - Consent forms: create/notify, signature mismatch, one response per student across two parents, audit with IP, tracking and CSV, owner-only access, the 24 h remind throttle, the 48 h cron reminder sent once, and no responses after the due date.
  - Conferences: the slots_requested notification, block and other-teacher 403, the exact cross-teacher overlap message, `.ics` link notifications, the day view, my meetings, cancel and re-book, and the closed window.
  - Overview: action items, the access check, and timing for all 8 cards.

## Requirement Results

| Requirement | Status | Evidence |
|---|---|---|
| FR-1 | PASS | `prisma/schema.prisma` (AbsenceNote, ConferenceEvent, ConferenceSlot, ConsentForm/Audience/Response + 3 enums); migration `prisma/migrations/20261114000000_prd15_parent_portal`; all DB integration tests write these models |
| FR-2 | PASS | `tests/unit/parent-portal/qa-sh15-validators.test.ts` › "FR-2 absence note rules", "FR-2 conference rules" |
| FR-3 | PASS | `src/components/ChildSwitcher/`, `src/app/(app)/layout.tsx` (lists children + `getSelectedChild`), `POST /api/me/selected-child` → `setSelectedChildCookie`. Code-reviewed; no UI test (see coverage gaps) |
| FR-4 | PASS | `src/server/parent/selected-child.ts`; QA unit "unlinked cookie falls back to the first child" |
| FR-5 | FAIL | `/assignments`, `/grades` and `/api/me/timetable` default to the selected child, and `?studentId=` overrides it (QA unit "?studentId= overrides the cookie"; `src/app/(app)/{assignments,grades}/page.tsx`). **The calendar `studentId` filter is missing**: no calendar page or API exists (PRD-14 dev failed). ADR-11 accepted this as partial |
| FR-6 | PASS | `ChildSwitcher` shows the name only, with no Select, for 1 child (code-reviewed) |
| FR-7 | PASS | `src/app/(app)/my-children/page.tsx` (1 child → redirect; else cards); `getChildrenSummary` in `src/server/parent/overview-service.ts`. Not value-asserted by tests |
| FR-8 | PASS | `src/app/(app)/dashboard/page.tsx` redirects PARENT → `/my-children`, which leads to the overview (≤2 clicks) |
| FR-9 | PASS | `getToday` (holiday via `isNoSchool` CalendarEvent, else timetable); runs in QA `getOverview` test (8 cards) |
| FR-10 | PASS | `getAttendanceSummary` (term rate, absences, lates, last 5) plus the "Report an absence" button in `OverviewCards.tsx` |
| FR-11 | PASS | `getAssignmentsSummary` (MISSING + due ≤7 days) |
| FR-12 | PASS | `getRecentGrades` (last 5 visible grades + current % per course) |
| FR-13 | NOT-IMPLEMENTED | `listUnreadAnnouncements()` is a stub that always returns `[]`, and the card renders EmptyState. Blocked: the PRD-12 Announcement model is absent from the workspace (ADR-11) |
| FR-14 | PASS | `getUpcomingEvents` (audience-filtered CalendarEvents + meetings, next 5); QA integration asserts the meetings appear |
| FR-15 | PASS | `getTeachers` + "Message" button in `OverviewCards.tsx`. Caveat: `/messages?to=` doesn't prefill the recipient yet (ponytail note) |
| FR-16 | PASS | QA integration "FR-16 + NFR-5: action items list the pending consent form and the open conference" |
| FR-17 | PASS | `OverviewCards.tsx` `Shell` "View all" links per card; `<Suspense>` per card in `my-children/[studentId]/page.tsx` |
| FR-18 | PASS | `absence/new/page.tsx` + `AbsenceNoteForm`; QA unit window test; e2e `absence-notes.spec.ts` "parent reports an absence for today" |
| FR-19 | PASS | `absence-notes-service.ts` `submit` → PENDING + notify `absence_note.submitted` (homeroom + admins); `types.ts` email default false; e2e submit |
| FR-20 | PASS | `src/app/(app)/my-children/[studentId]/absence/page.tsx` (list with status) |
| FR-21 | PASS | `src/app/(app)/attendance/absence-notes/page.tsx` + `AbsenceNotesReviewClient` (status/date filters, record context); e2e "homeroom teacher approves" |
| FR-22 | PASS | QA unit "reject requires a note"; Dev integration FR-23 (reviewedBy/At recorded; second review → 409) |
| FR-23 | PASS | `tests/integration/absence-notes/absence-approval.test.ts` "approval converts ABSENT → EXCUSED and leaves PRESENT untouched" |
| FR-24 | PASS | Dev integration "approved note pre-fills a later register"; e2e "register shows EXCUSED with a badge" |
| FR-25 | PASS | Dev integration "unlocks EXCUSED only for covered students"; `attendance-qa` FR-10/FR-19 now passes (it failed on baseline) |
| FR-26 | PASS | `absence-notes-service.ts` `review` → notify `absence_note.reviewed` with the reviewer note to linked parents; `types.ts` email default true |
| FR-27 | PASS | Dev integration "attendance.absent is suppressed while a PENDING note covers the student" |
| FR-28 | PASS | QA integration "FR-28: admin-created event notifies teachers of eligible grades"; `admin/conferences` UI (`ConferenceEventsClient`) |
| FR-29 | PASS | QA integration "FR-29: availability generates slots; teacher can block…"; Dev integration "generates 3 slots" |
| FR-30 | PASS | Dev integration concurrent booking (conditional UPDATE); e2e `conferences.spec.ts` "parent books a slot with a note" |
| FR-31 | PASS | QA integration asserts the exact message `You already have a meeting with QA t1 at 15:00`; Dev integration ONE_PER_TEACHER |
| FR-32 | PASS | QA integration "FR-32: cancel then re-book works in-window; after bookingClosesAt neither…" |
| FR-33 | PASS | QA integration "FR-33: booking notifies parent and teacher with an .ics link"; cancel → `conference.cancelled` asserted in FR-32 test |
| FR-34 | PASS | QA integration `teacherDay` asserts student + note; `src/app/(app)/conferences/[id]/day/page.tsx` has print styles |
| FR-35 | FAIL | Meetings come from `listMyMeetings` (QA integration: 2 for parent, 1 for teacher) and show only in the overview "Upcoming events" card. **No calendar "My meetings" source**: the PRD-14 calendar UI doesn't exist (ADR-11) |
| FR-36 | PASS | QA integration "FR-36: admin creates a grade-level form → both linked parents get consent.requested; teacher cannot target a grade" |
| FR-37 | PASS | QA integration "FR-37: signature must match…"; e2e `consent-forms.spec.ts` "parent signs a consent form" |
| FR-38 | PASS | QA integration "FR-38 + NFR-3: one response per student…" plus "no change after dueAt" |
| FR-39 | PASS | QA integration "FR-39: tracking per student + CSV for owner/admin only" and "Remind … throttled to once per 24h" |
| FR-40 | PASS | QA integration "FR-40: 48h-before-due reminder goes once…"; wired into `src/app/api/internal/email/dispatch/route.ts` (cron-secret guarded) |
| FR-41 | PASS | `src/server/files/contexts.ts` `absenceNoteResolver` (linked parents, homeroom teacher, ADMIN) registered as `'absence-note'`; e2e upload path. Resolver matrix not unit-tested |
| FR-42 | PASS | `src/config/navigation.ts` lines 52–57, 67 (parent: My children / Absence notes / Conferences / Consent forms; teacher: Absence notes if homeroom, Conferences; admin: Conferences, Consent forms, Absence notes) |
| FR-43 | PASS | 21 route files under `src/app/api/{absence-notes,conferences,conference-slots,consent-forms,me,students}`; 20 call `requireRole`/`getCurrentUser`, and the 21st (internal dispatch) is CRON_SECRET-guarded |
| FR-44 | PASS | `src/server/notifications/types.ts` lines 220–268 (7 keys incl. `consent.reminder`); all are emitted in passing tests |
| FR-45 | PASS | `prisma/seed.ts` `seedParentPortal` (idempotent). Locally: event + 24 slots + trip event + form exist; family-dependent parts are skipped by design. See finding 5 (creator) |
| FR-46 | PASS | All required tests exist and pass: unit (coverage/slots/signature), integration (approval, pre-fill, suppression, concurrent booking), Playwright (3 flows, 4 tests) |
| NFR-1 | PASS | `tests/integration/conferences/concurrent-booking.test.ts` "two concurrent bookings of one slot → exactly one success, the other 409 SLOT_TAKEN" |
| NFR-2 | PASS | Server-side proxy only: QA integration asserts all 8 overview cards resolve in under 1 s; cards stream through `<Suspense>`. Browser paint was not measured |
| NFR-3 | PASS | QA integration asserts `AuditLog.ip = 203.0.113.7` on consent create/update; absence review route passes `request` to `audit()` (`absence-notes-service.ts:321`) |
| NFR-4 | PASS | A static scan of 32 new `.tsx` files found only `@mui/*`, internal and Next imports; 0 banned libs; 0 `window.confirm/alert`; 10 files use `useToast`/`ConfirmDialog`. The mui-mcp lookup is reported in `dev-log.md`; QA can't re-verify that process step |
| NFR-5 | PASS | QA integration: non-owner teacher and parent denied tracking, other teacher's slot → `NOT_SLOT_TEACHER`, unrelated teacher can't load the overview; Dev integration "only the homeroom teacher or ADMIN can review", cancel by non-booker 403 |
| NFR-6 | PASS | New services in `src/server/{absence-notes,conferences,consent-forms,parent}/`; reuses `audit`, `notify`, `canTargetAudience`, `attendance-service` (edited in place), `toCsv`, `buildCalendar`, file contexts |
| NFR-7 | PASS | typecheck + lint clean; Zod validators in `src/lib/validators/{absence-notes,conferences,consent-forms}.ts` shared by forms and handlers; 0 `console.log` in SH-15 source (the seed's existing `console.log` lines predate SH-15). Full suite failures predate SH-15 (finding 3) |
| NFR-8 | PASS | `schoolToday(…, tz)` for the absence window (`absence-notes-service.ts:123`); `fromZonedTime` for slots; `@db.Date` for note dates and event date; Dev integration uses school-tz `today` |
| NFR-9 | PASS | No payments, pickup or self-registration code; the diff is limited to PRD-15 files plus edits in place to attendance, nav, files and the dispatch cron |
| NFR-10 | PASS | `parsePagination` in `absence-notes`, `conferences`, `consent-forms` and `consent-forms/:id/tracking` list routes; `q` and `sort` in the list Zod queries |

## Recommended follow-ups (non-blocking)
1. FR-13 / FR-35 / FR-5 calendar: finish them when PRD-12 Announcements and the PRD-14 calendar UI land.
2. Set the seed consent form `createdById` to the admin (finding 5).
3. Add `?to=` prefill on `/messages` (FR-15 caveat).
4. Add Playwright tests for `ChildSwitcher` and `/my-children` (coverage gaps).
