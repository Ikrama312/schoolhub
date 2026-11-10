# UI Verification Report: SH-14 (PRD-14 School Calendar, Events & Holidays)

- **Ticket:** SH-14
- **Status:** blocked
- **Result:** 15 UI-facing findings: **0 PASS, 15 FAIL (not implemented), 0 BLOCKED**

> This report replaces the SH-13 report. The SH-13 screenshots in `screenshots/` are left as they were and are also in git history. SH-14 evidence is in `screenshots-sh14/` and `uiv-raw-sh14.log`. `ui-verification-report.json` has the same findings in machine-readable form.

## Headline

**SH-14 has no UI to verify.** The Dev phase finished only TASK-1 to TASK-7, the backend foundation:

- dependencies
- Prisma models and migration
- validators
- recurrence expansion
- iCal builder
- audience resolver
- notification types

None of the user-facing tasks has code on disk: TASK-13 and TASK-17 to TASK-23. These files are missing:

- `/calendar`: `page.tsx`, `CalendarView.tsx`, `SourceChips.tsx`
- `EventDrawer.tsx`
- `EventEditorDialog.tsx`
- `AudienceBuilder.tsx`
- `/account/calendar`: `page.tsx`, `SubscribeCard.tsx`
- `/admin/academic-years/[id]`: the page and `TermBreaksButton.tsx`

None of the existing screens was changed for holidays either: the timetable Today view, the attendance register, the assignment editor and the quiz settings. `src/config/navigation.ts` has no calendar entries.

This agrees with the QA report: overall FAIL, with 32 requirements NOT-IMPLEMENTED.

**What needs to happen:** re-run Dev for TASK-8 to TASK-27, then QA, then this phase.

## The environment also blocked rendering

Even for pages that already exist, nothing could be rendered after login:

- **:3001 server:** the `next dev` server for this repo serves `/login` without styles (serif fallback fonts, no MUI theme), and the page never hydrates. Playwright fills the form and the value reads back correctly. The native form POST then reloads the page empty, so login failed for **all four seeded roles** (admin, teacher, parent, student). The `*-error.png` screenshots show this.
  - A likely cause is that the dev server is stale after the TASK-1 dependency and override changes to `@mui/x-scheduler` and `@mui/x-internals`. This is not confirmed.
  - I did not restart the server because it is shared.
  - **Restart the dev server before the next UI-verification run.**
- **:3000 server:** this one runs from a different checkout (`~/Documents/forge/schoolhub`) and returns 500 for every route, so it was not used.
- **Signed-out requests:** without a session, `/calendar` and `/account/calendar` return 307 to `/login`, and `/api/calendar` and `/api/school-day` return 401. That is only the auth middleware answering, not evidence that a page or route exists.
- **Design reference:** there is no `figma-readiness.json`, so the PRD text was the only reference.

## Findings

All verdicts are **FAIL**. Each surface is missing from source, which I confirmed with a file check and `git diff`. None was marked PASS, because nothing was rendered.

| Req | Surface | Verdict | Notes |
|---|---|---|---|
| FR-9 | `/calendar` (month, week and agenda views, navigation) | FAIL | `calendar/page.tsx` and `CalendarView.tsx` do not exist (TASK-20). |
| NFR-12 | Default view (month at 768 px or wider, agenda below 768 px) | FAIL | Depends on the missing `/calendar` page. |
| FR-10 | Source chips | FAIL | `SourceChips.tsx` and `sources.ts` do not exist. |
| FR-11 | Parent child filter and child-name labels | FAIL | There is no calendar page or sources code. |
| FR-12 | Event drawer, including the "Add to my calendar" .ics download | FAIL | `EventDrawer.tsx` and `/api/events/[id]/ics` do not exist. |
| FR-13 | Clicking a deadline opens the assignment or quiz | FAIL | There is no calendar page. |
| FR-14 | "New event" button, editor dialog and audience builder | FAIL | `EventEditorDialog.tsx` and `AudienceBuilder.tsx` do not exist. |
| FR-21 | RSVP controls, disabled after the deadline | FAIL | There is no drawer and no RSVP API. |
| FR-22 | Own RSVP and totals; full list and CSV export for the creator and admins | FAIL | There is no drawer and no `rsvps` API. |
| FR-24 | `/account/calendar` Subscribe card | FAIL | The page, `SubscribeCard.tsx` and `/api/me/calendar-feed` do not exist. |
| FR-35 | Calendar entries in the sidebar | FAIL | `navigation.ts` has 0 calendar entries. |
| FR-17 | Holiday name shown in Today and timetable views | FAIL | `getScheduleForDate` is unchanged and only has a "holidays hook in here" comment. `isSchoolDay` does not exist. |
| FR-18 | Holiday banner and confirmation on the attendance register | FAIL | The register page and `RegisterForm.tsx` are unchanged. |
| FR-19 | Holiday warning in the assignment editor and quiz settings | FAIL | `AssignmentForm.tsx` and `QuizSettingsPanel.tsx` are unchanged. |
| FR-20 | "Add term breaks" admin button | FAIL | The page, the button and the API do not exist. |

The other requirements have no UI surface, so they are out of scope for this phase. QA covers them:

- FR-1 to FR-8
- FR-15 and FR-16
- FR-23
- FR-25 to FR-34
- FR-36 and FR-37

## Method

1. I listed the requirements that have a user-visible surface, using `requirements.json` and the UI tasks in `implementation-plan.json`.
2. I checked whether each planned UI file exists, and ran `git diff HEAD -- src` and a grep of `navigation.ts`.
3. I sent signed-out HTTP requests to the :3000 and :3001 servers.
4. I ran a Playwright driver, `/tmp/uiv-sh14/d2.cjs` (outside the repo, `bypassCSP` per ADR-4), against :3001. It tried to log in as each seeded role, then open `/calendar`, `/account/calendar` and `/admin/academic-years/x` and call the calendar APIs. Login failed for every role, as described above.
5. I created no fixtures and made no changes to the database or product code.
