# SH-14 File Structure — PRD-14 School Calendar, Events & Holidays

Phase: dev-planning · Ticket: SH-14 · Legend: `+` CREATE, `~` MODIFY. Task id in brackets.
This replaces the stale SH-13 plan.

```
package.json                                              ~ [TASK-1]  @mui/x-scheduler@9.0.0-beta.15 (exact), scoped @mui/x-internals override, node-ical@0.27.6 devDep
package-lock.json                                         ~ [TASK-1]
prisma/
├── schema.prisma                                         ~ [TASK-2]  AudienceType, EventCategory, Recurrence, RsvpResponse; CalendarEvent, EventAudience, EventRsvp, CalendarFeedToken; User back-relations
├── migrations/20261113000000_add_calendar/migration.sql  + [TASK-2]
└── seed.ts                                               ~ [TASK-24] seedCalendar() + ROBOTICS course (D-7)
src/
├── theme/theme.ts                                        ~ [TASK-1]  import type {} from '@mui/x-scheduler/theme-augmentation'
├── lib/
│   ├── dates.ts                                          ~ [TASK-3]  schoolMidnight, schoolDateOf
│   └── validators/
│       ├── calendar.ts                                   + [TASK-3]  eventInput/Patch, rsvp, calendarQuery, schoolDayQuery, publicEventsQuery
│       └── attendance.ts                                 ~ [TASK-12] registerPutBody.holidayOverride
├── config/
│   ├── navigation.ts                                     ~ [TASK-20] Calendar entry (ALL_ROLES)
│   └── public-routes.ts                                  ~ [TASK-16] '/api/calendar/feed/', '/api/public/'
├── server/
│   ├── announcements/audience.ts                         + [TASK-6]  PRD-12 path: resolveAudienceUserIds, isUserInAudience, audienceWhereForUser, canTargetAudience
│   ├── calendar/
│   │   ├── recurrence.ts                                 + [TASK-4]  expandOccurrences (pure)
│   │   ├── ical.ts                                       + [TASK-5]  RFC 5545 builder (pure)
│   │   ├── calendar-service.ts                           + [TASK-8]  CRUD, RSVP, isSchoolDay, noSchoolDays, createTermBreaks, feed tokens
│   │   ├── sources.ts                                    + [TASK-9]  getCalendarItems, getPublicEvents, getUpcomingEventsForUser
│   │   └── maintenance.ts                                + [TASK-10] sendRsvpReminders
│   ├── notifications/types.ts                            ~ [TASK-7]  event.created / holiday_created / updated / rsvp_reminder
│   ├── timetable/timetable-service.ts                    ~ [TASK-11] both "PRD-14 holidays hook" lines → isSchoolDay
│   └── attendance/attendance-service.ts                  ~ [TASK-12] noSchoolReason, holidayOverride (D-8)
├── components/AudienceBuilder/AudienceBuilder.tsx        + [TASK-17]
└── app/
    ├── api/
    │   ├── calendar/
    │   │   ├── route.ts                                  + [TASK-15] GET /api/calendar
    │   │   └── feed/[token]/route.ts                     + [TASK-16] GET /api/calendar/feed/<token>.ics
    │   ├── events/
    │   │   ├── route.ts                                  + [TASK-14] POST
    │   │   └── [id]/
    │   │       ├── route.ts                              + [TASK-14] GET/PATCH/DELETE
    │   │       ├── ics/route.ts                          + [TASK-14]
    │   │       ├── rsvp/route.ts                         + [TASK-14] PUT
    │   │       └── rsvps/route.ts                        + [TASK-14] GET (+?format=csv)
    │   ├── me/calendar-feed/
    │   │   ├── route.ts                                  + [TASK-16] GET
    │   │   └── reset/route.ts                            + [TASK-16] POST
    │   ├── school-day/route.ts                           + [TASK-15] (singular; /api/school-days untouched)
    │   ├── public/events/route.ts                        + [TASK-16]
    │   ├── academic-years/[id]/term-breaks/route.ts      + [TASK-15]
    │   ├── attendance/register/route.ts                  ~ [TASK-12] pass holidayOverride
    │   └── internal/email/dispatch/route.ts              ~ [TASK-10] isolated sendRsvpReminders block
    └── (app)/
        ├── calendar/
        │   ├── page.tsx                                  + [TASK-20] server, requirePageUser
        │   ├── CalendarView.tsx                          + [TASK-20] client, EventCalendar
        │   ├── SourceChips.tsx                           + [TASK-20]
        │   ├── EventDrawer.tsx                           + [TASK-19]
        │   └── EventEditorDialog.tsx                     + [TASK-18]
        ├── account/calendar/
        │   ├── page.tsx                                  + [TASK-21]
        │   └── SubscribeCard.tsx                         + [TASK-21]
        ├── admin/academic-years/[id]/
        │   ├── page.tsx                                  + [TASK-22]
        │   └── TermBreaksButton.tsx                      + [TASK-22]
        ├── attendance/take/
        │   ├── page.tsx                                  ~ [TASK-13] "No classes today — <reason>"
        │   └── RegisterForm.tsx                          ~ [TASK-13] warning Alert + ConfirmDialog → holidayOverride
        └── courses/[courseId]/
            ├── assignments/AssignmentForm.tsx            ~ [TASK-23] holiday warning
            └── quizzes/[quizId]/edit/QuizSettingsPanel.tsx ~ [TASK-23] holiday warning
tests/
├── unit/
│   ├── dates.test.ts                                     ~ [TASK-3]
│   ├── public-routes.test.ts                             ~ [TASK-16]
│   ├── attendance-register-form.test.tsx                 ~ [TASK-13]
│   └── calendar/
│       ├── validators.test.ts                            + [TASK-3]
│       ├── recurrence.test.ts                            + [TASK-4]  weekly, monthly-31st, until bound, DST week
│       ├── ical.test.ts                                  + [TASK-5]  escaping, folding, RRULE, VALUE=DATE, node-ical parse
│       └── audience.test.ts                              + [TASK-6]  canTargetAudience
├── integration/calendar/
│   ├── calendar-merge.test.ts                            + [TASK-25] per role incl. parent with 3 children
│   ├── audience-parity.test.ts                           + [TASK-25] resolver parity over seed users
│   ├── school-day.test.ts                                + [TASK-25] isSchoolDay, recurring no-school, term-break gaps
│   ├── events-rsvp.test.ts                               + [TASK-26] teacher SCHOOL → 403, RSVP deadline 409, parent-only guests
│   └── feed-token.test.ts                                + [TASK-26] reset → old 404, new 200 + node-ical valid
└── e2e/calendar.spec.ts                                  + [TASK-27]
```

## Notes for Dev

- **Import direction (R2):** timetable-service → calendar-service; sources.ts → (timetable-service, assignments, quiz, calendar-service). calendar-service never imports timetable-service or sources.ts.
- **Public routes:** the system design doesn't mention it, but `src/config/public-routes.ts` must list `/api/calendar/feed/` and `/api/public/`, or the middleware will redirect the feed and the public events route to login.
- **"Today view" (FR-17):** the only UI that uses `getScheduleForDate` is the teacher attendance landing (`attendance/take/page.tsx`). No student or parent Today view exists, and adding one is out of scope (NFR-11). The TASK-11 service change makes every schedule consumer return `[]` on holidays. For students, the e2e test checks the holiday on `/calendar`.
- **RegisterForm:** the `[courseId]` and `section/[sectionId]` register pages pass `register` straight through, so `noSchoolReason` reaches the form with no page edits.
- **MUI MCP gate (NFR-2):** before TASK-18, TASK-19 or TASK-20 is coded, look up the x-scheduler Quickstart, Views, Events, Editing, Timezone, Localization and Responsiveness pages. If MCP is unreachable, stop and report a blocker.
