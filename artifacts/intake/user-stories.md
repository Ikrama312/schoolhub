# SH-14 — PRD-14: School Calendar, Events & Holidays — User Stories

Pipeline ticket SH-14 (PRD ref SCH-014). Run mode `--brownfield --tech-stack react`.

> **Dependency gap:** PRD-12 (AudienceType, `audience.ts`, audience builder) is not in the workspace. Stories that depend on it (FR-3, FR-7, FR-14) carry LOW/MEDIUM confidence. See `requirements.json` › `clarificationLog`.

## Setup & data

- **FR-1:** As a developer, I want `@mui/x-scheduler` installed at an exact version I looked up through the MUI MCP, so that the calendar UI uses a documented, pinned beta API.
- **FR-2 / FR-4 / FR-5:** As the platform, I want CalendarEvent, EventAudience, EventRsvp and CalendarFeedToken stored with validated fields (title ≤ 150, description ≤ 5,000, end ≥ start, all-day exclusive end, recurrence until ≤ 1 year, guests 0–5, HOLIDAY/TERM_BREAK no-school by default), so that every feature reads consistent data.
- **FR-3 (LOW):** As the platform, I want event audiences to use the shared AudienceType, so that events and announcements target people in the same way.

## Permissions

- **FR-6:** As an admin, I want to create any event, including holidays, term breaks, no-school days and public events, so that I control the school calendar.
- **FR-7 (MEDIUM):** As a teacher, I want to create events for courses I manage or my homeroom section, so that my students and their parents see them. I must be refused (403) for SCHOOL-wide events.
- **FR-8 / FR-36:** As a creator, I want to edit or delete my own events (admins can edit or delete any event, with an audit entry), so that mistakes can be fixed.

## Calendar page (`/calendar`)

- **FR-9:** As any user, I want month, week (07:00–19:00) and agenda views, with Today/previous/next and a date picker, so that I can browse at the right detail on desktop and mobile.
- **FR-10:** As any user, I want toggleable source chips (School events, My assignments, My quizzes, My timetable, Holidays) that are remembered, so that I see only what I care about.
- **FR-11:** As a parent, I want to filter by child and see deadlines labelled with each child's name, so that I know whose deadline it is.
- **FR-12:** As any user, I want to click an event and see its details in a side drawer, with RSVP and "Add to my calendar", so that I can act on it.
- **FR-13:** As a student or parent, I want clicking a deadline to open the assignment or quiz, so that I can go straight to the work.
- **FR-14 (MEDIUM):** As an admin or teacher, I want a "New event" dialog with an audience builder, recurrence and RSVP options, so that I can create events for a chosen audience.
- **FR-35 (MEDIUM):** As any user, I want Calendar in the sidebar, so that I can find it.

## Recurrence

- **FR-15:** As an organiser, I want weekly or monthly events stored once and shown on every occurrence until an end date, so that I don't create them one by one.

## Holidays integration

- **FR-16 / FR-34:** As the platform, I want `isSchoolDay(date)` and `GET /api/school-day`, so that every feature agrees on which days are holidays.
- **FR-17:** As a student, I want my Today view to show "Holiday: Thanksgiving" instead of classes, so that I know school is closed.
- **FR-18:** As a teacher, I want the register to say "No classes today — Thanksgiving" and to ask for extra confirmation before I record attendance on a holiday, so that I avoid mistakes.
- **FR-19:** As a teacher, I want a non-blocking warning when an assignment due date or quiz close date falls on a holiday, so that I avoid mistakes but can still save.
- **FR-20 (MEDIUM):** As an admin, I want "Add term breaks" on the academic year to create TERM_BREAK events for the gaps between terms, so that I don't enter them by hand.

## RSVP

- **FR-21:** As a parent, I want to RSVP Yes, No or Maybe with guests and a note before the deadline, so that the school can plan. After the deadline the controls are disabled.
- **FR-22:** As an event creator or admin, I want to see all responses and export them as CSV, so that I can plan numbers.
- **FR-23:** As an audience member who hasn't answered, I want one reminder 48 hours before the RSVP deadline, so that I don't forget.

## iCal subscription

- **FR-24 / FR-25:** As a parent, I want a private subscribe link on `/account/calendar` that I can copy, with setup instructions and a "Reset link" option, so that I can sync my phone calendar and revoke a leaked link.
- **FR-26:** As a subscriber, I want the feed to include my school events and my children's deadlines (−30 to +365 days), with recurrence and the correct timezone, so that my phone calendar matches SchoolHub.
- **FR-27:** As the school, I want the feed to be token-authenticated, rate limited (60 per hour) and privately cached, so that it can't be abused.

## Notifications

- **FR-28:** As an audience member, I want to be notified when an event starting within 30 days is created (holidays and term breaks also by email), so that I hear about it in time.
- **FR-29:** As an audience member, I want to be notified when the time or location of an upcoming event changes, so that I don't turn up at the wrong time.

## Hooks for later PRDs

- **FR-30:** As the public website (PRD-18), I want `getPublicEvents` and `GET /api/public/events`, so that I can show public events.
- **FR-31:** As dashboards (PRD-16), I want `getUpcomingEventsForUser`, so that I can list upcoming events.
- **FR-32 / FR-33:** As a client, I want the calendar merge API (range ≤ 100 days) and the event CRUD, ICS, RSVP and RSVP-list endpoints, so that the UI and integrations work.

## Seed

- **FR-37:** As a demo user, I want the 2026–27 seed events (Thanksgiving, Winter break, exams, parent evening, science fair, chess club, sports day), so that the calendar is populated.

## Non-Functional Requirements

- **NFR-1:** MUI-only UI, with no banned libraries. QA checks the imports.
- **NFR-2:** Look up every MUI and MUI X Scheduler component through the MUI MCP before using it. If the MCP is unreachable, report a blocker.
- **NFR-3:** All-day events and DST transitions show on the correct dates in both the UI and the feed, with tests for a DST-change week.
- **NFR-4:** A parent's month view with 3 children loads in under 500 ms.
- **NFR-5:** Feed tokens are 32 random bytes, stored hashed. The feed shows no more than the app does.
- **NFR-6:** The feed passes an RFC 5545 validator test (`node-ical`).
- **NFR-7:** Access is enforced server-side everywhere.
- **NFR-8:** Follow the platform conventions (layout, response shapes, UTC storage, school timezone display, logger).
- **NFR-9:** Reuse existing helpers. Don't re-scaffold or rename anything.
- **NFR-10:** Lint, typecheck and tests stay green, and the new unit, integration and Playwright tests are added.
- **NFR-11:** Scope is fixed: no room booking, no occurrence exceptions, no two-way sync.
- **NFR-12:** Supports evergreen browsers, English-only UI, and a 768 px responsive breakpoint.
