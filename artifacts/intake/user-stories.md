# SH-15 User Stories — PRD-15 Parent Portal

Source: PRD-15 (SCH-015). Each story references its requirement id in `requirements.json`.

## PRD User Stories (verbatim)

- As a parent with several children, I want to switch the active child in one place so that every page shows that child's data. (FR-3–FR-6)
- As a parent, I want a child overview page so that I can see today's classes, recent grades, attendance and what's due. (FR-7–FR-17)
- As a parent, I want to report an absence in advance or after the fact with a reason and optional document so that it is excused. (FR-18–FR-20, FR-23–FR-24)
- As a teacher or admin, I want to review absence notes and approve or reject them so that attendance is accurate. (FR-21–FR-27)
- As a teacher, I want to publish conference time slots so that parents can book them. (FR-28–FR-29, FR-34)
- As a parent, I want to book, reschedule or cancel a conference slot so that I can meet my child's teachers. (FR-30–FR-33, FR-35)
- As an admin, I want to send consent forms and track responses so that trips can be planned. (FR-36, FR-39–FR-40)
- As a parent, I want to sign consent forms online so that I don't need to send paper slips. (FR-37–FR-38)

## Per-Requirement Stories

### FR-1 (HIGH)
As a developer, I want: add Prisma enums AbsenceNoteStatus, AbsenceReason, ConsentResponseValue and models AbsenceNote, ConferenceEvent, ConferenceSlot, ConsentForm, ConsentAudience, ConsentResponse exactly as specified, with a migration; reuse existing AudienceType enum (GRADE_LEVEL/SECTION/COURSE only for consent), so that the feature is consistent, testable and safe to build on.  
_Source: PRD-15 FR-1 Data model_

### FR-2 (HIGH)
As a developer, I want: absenceNote validation: toDate >= fromDate, span <= 30 days, details <= 1,000 chars, periodIds used only when partialDay; ConferenceEvent.slotMinutes 5–60; ConferenceSlot.parentNote <= 500 chars, so that the feature is consistent, testable and safe to build on.  
_Source: PRD-15 FR-1 Data model (field comments)_

### FR-3 (HIGH)
As a parent, I want: pARENT users with 2+ linked children see a top-bar child switcher (avatar + first name dropdown); selection stored in cookie sh_child, so that I can manage my child's school life in one place without calling the office.  
_Source: PRD-15 FR-2.1_

### FR-4 (HIGH)
As a parent, I want: sh_child cookie is validated against ParentStudentLink on every request; an invalid/unlinked value falls back to the first child, so that I can manage my child's school life in one place without calling the office.  
_Source: PRD-15 FR-2.1_

### FR-5 (HIGH)
As a parent, I want: parent-facing pages accepting studentId (timetable, assignments, grades, calendar filter) default to the selected child, replacing per-page child selectors; ?studentId= remains an override, so that I can manage my child's school life in one place without calling the office.  
_Source: PRD-15 FR-2.2; AC-1_

### FR-6 (HIGH)
As a parent, I want: parents with exactly one child see that child's name in the top bar with no dropdown, so that I can manage my child's school life in one place without calling the office.  
_Source: PRD-15 FR-2.3_

### FR-7 (HIGH)
As a parent, I want: /my-children replaces the PRD-03 'My children' list: one-child parents redirect to /my-children/[studentId]; multi-child parents see cards with attendance rate this term, missing-assignment count and average grade linking to each overview, so that I can manage my child's school life in one place without calling the office.  
_Source: PRD-15 FR-3.1; AC-8_

### FR-8 (HIGH)
As a parent, I want: child overview is the default landing page for parents after sign-in (within 2 clicks of sign-in), so that I can manage my child's school life in one place without calling the office.  
_Source: PRD-15 FR-3 heading; Goals 1; AC-8_

### FR-9 (HIGH)
As a parent, I want: overview 'Today' card shows the child's schedule for today or a holiday message (PRD-06/14 data), so that I can manage my child's school life in one place without calling the office.  
_Source: PRD-15 FR-3.2 Today_

### FR-10 (HIGH)
As a parent, I want: overview 'Attendance' card shows term rate, absences and lates this term, last 5 marks and a 'Report an absence' button, so that I can manage my child's school life in one place without calling the office.  
_Source: PRD-15 FR-3.2 Attendance_

### FR-11 (HIGH)
As a parent, I want: overview 'Assignments' card shows missing assignments (red) and those due in the next 7 days, so that I can manage my child's school life in one place without calling the office.  
_Source: PRD-15 FR-3.2 Assignments_

### FR-12 (HIGH)
As a parent, I want: overview 'Recent grades' card shows last 5 returned/visible grades with course and score, plus current percent per course, so that I can manage my child's school life in one place without calling the office.  
_Source: PRD-15 FR-3.2 Recent grades_

### FR-13 (MEDIUM)
As a parent, I want: overview 'Announcements' card shows the last 3 unread announcements for this child, so that I can manage my child's school life in one place without calling the office.  
_Source: PRD-15 FR-3.2 Announcements (PRD-12 Announcement model not present in workspace)_

### FR-14 (HIGH)
As a parent, I want: overview 'Upcoming events' card shows the next 5 calendar items, so that I can manage my child's school life in one place without calling the office.  
_Source: PRD-15 FR-3.2 Upcoming events_

### FR-15 (HIGH)
As a parent, I want: overview 'Teachers' card lists the child's teachers with subject and a 'Message' button (PRD-13 messaging), so that I can manage my child's school life in one place without calling the office.  
_Source: PRD-15 FR-3.2 Teachers_

### FR-16 (HIGH)
As a parent, I want: overview 'Action items' card lists pending consent forms and open conference bookings, so that I can manage my child's school life in one place without calling the office.  
_Source: PRD-15 FR-3.2 Action items_

### FR-17 (HIGH)
As a parent, I want: each overview card has a 'View all' link to the full page/tab and loads independently via React Suspense streaming, so that I can manage my child's school life in one place without calling the office.  
_Source: PRD-15 FR-3.2, FR-3.3_

### FR-18 (HIGH)
As a parent, I want: parent absence form at /my-children/[studentId]/absence/new: from/to dates (past 14 days to 60 days ahead), whole day or specific periods (checkboxes from bell schedule), reason, details, optional PDF/JPG/PNG upload with file context 'absence-note', so that I can manage my child's school life in one place without calling the office.  
_Source: PRD-15 FR-4.1_

### FR-19 (HIGH)
As a parent, I want: on submit the note is PENDING and notifies the homeroom teacher and admins via notify() type absence_note.submitted (default email false), so that I can manage my child's school life in one place without calling the office.  
_Source: PRD-15 FR-4.2_

### FR-20 (HIGH)
As a parent, I want: parents see a list of their absence notes with status, so that I can manage my child's school life in one place without calling the office.  
_Source: PRD-15 FR-4.2_

### FR-21 (HIGH)
As a teacher or admin, I want: review queue /attendance/absence-notes for homeroom TEACHER (own section) and ADMIN (all), filterable by status and date; each note shows student, dates, reason, details, document link and existing attendance records for those dates, so that attendance and meetings stay accurate without office involvement.  
_Source: PRD-15 FR-4.3_

### FR-22 (HIGH)
As a teacher or admin, I want: reviewers can Approve (optional note) or Reject (note required); reviewedById, reviewNote, reviewedAt are recorded, so that attendance and meetings stay accurate without office involvement.  
_Source: PRD-15 FR-4.3; API POST /api/absence-notes/:id/review_

### FR-23 (HIGH)
As a parent, I want: approval sets every matching attendance record (dates, and periods if partial) with status ABSENT or no record yet to EXCUSED with note 'Absence note #<id>', writes audit(), and attendance rate recalculates; rejected notes leave records unchanged, so that I can manage my child's school life in one place without calling the office.  
_Source: PRD-15 FR-4.4; AC-3; AC-4_

### FR-24 (HIGH)
As a parent, I want: for future dates an approved note pre-fills students as EXCUSED with an 'Absence note' badge when a register is later taken; teachers may still change it, so that I can manage my child's school life in one place without calling the office.  
_Source: PRD-15 FR-4.4; AC-2_

### FR-25 (HIGH)
As a teacher or admin, I want: teachers may select EXCUSED in the register only when an approved note covers that student/date/period; ADMIN can always set EXCUSED (relaxes current ADMIN-only rule in attendance-service), so that attendance and meetings stay accurate without office involvement.  
_Source: PRD-15 FR-4.5_

### FR-26 (HIGH)
As a parent, I want: parent is notified of the review decision including the reviewer's note (absence_note.reviewed, default email true), so that I can manage my child's school life in one place without calling the office.  
_Source: PRD-15 FR-4.6; AC-4_

### FR-27 (HIGH)
As a parent, I want: pRD-07 attendance.absent notifications are suppressed for a student when a PENDING or APPROVED note covers that date/period, so that I can manage my child's school life in one place without calling the office.  
_Source: PRD-15 FR-4.7; AC-2_

### FR-28 (HIGH)
As a admin or teacher, I want: admin creates/edits ConferenceEvent at /admin/conferences (title, date, booking window, slot length, eligible grade levels); teachers teaching eligible students are notified (conference.slots_requested), so that trips and conferences can be planned without paper or phone calls.  
_Source: PRD-15 FR-5.1; API POST/PATCH /api/conferences_

### FR-29 (HIGH)
As a teacher or admin, I want: teacher availability page /conferences/[id]/availability: pick time ranges and location; system regenerates unbooked slots of slotMinutes; teachers can remove unbooked slots and block individual slots, so that attendance and meetings stay accurate without office involvement.  
_Source: PRD-15 FR-5.2; API PUT /api/conferences/:id/availability_

### FR-30 (HIGH)
As a parent, I want: parent booking page /conferences/[id] shows, for each of the selected child's teachers with slots, available slots as time buttons; booking is atomic (UPDATE … WHERE bookedByParentId IS NULL) with an optional note, so that I can manage my child's school life in one place without calling the office.  
_Source: PRD-15 FR-5.3_

### FR-31 (HIGH)
As a parent, I want: booking rules: max one slot per teacher per child; overlapping bookings with other teachers are rejected with message 'You already have a meeting with <teacher> at <time>', so that I can manage my child's school life in one place without calling the office.  
_Source: PRD-15 FR-5.3; AC-6_

### FR-32 (HIGH)
As a parent, I want: reschedule = cancel + book; cancellation allowed until bookingClosesAt (booking only within booking window), so that I can manage my child's school life in one place without calling the office.  
_Source: PRD-15 FR-5.4_

### FR-33 (HIGH)
As a parent, I want: booking/cancellation notifies parent and teacher (conference.booked, conference.cancelled) with an .ics attachment link, so that I can manage my child's school life in one place without calling the office.  
_Source: PRD-15 FR-5.5_

### FR-34 (HIGH)
As a teacher or admin, I want: teacher day view lists booked slots in order with student, parent and note, and is printable, so that attendance and meetings stay accurate without office involvement.  
_Source: PRD-15 FR-5.6_

### FR-35 (MEDIUM)
As a parent, I want: booked conference slots appear on both parties' calendars as PRD-14 source 'My meetings', so that I can manage my child's school life in one place without calling the office.  
_Source: PRD-15 FR-5.7 (PRD-14 calendar UI/aggregation not present in workspace)_

### FR-36 (HIGH)
As a admin or teacher, I want: admins (any audience) and teachers (courses they manage) create consent forms at /consent-forms/new with title, Markdown description, due date, optional linked CalendarEvent, audience; parents of audience students notified (consent.requested, default email true), so that trips and conferences can be planned without paper or phone calls.  
_Source: PRD-15 FR-6.1_

### FR-37 (HIGH)
As a parent, I want: parents see pending consent forms on the child overview and at /consent-forms; responding requires Granted/Declined and a typed signature matching the parent's name case-insensitively, plus optional comment, so that I can manage my child's school life in one place without calling the office.  
_Source: PRD-15 FR-6.2; AC-7_

### FR-38 (HIGH)
As a parent, I want: one response per student (any linked parent); responses may be changed until dueAt and every change is audited, so that I can manage my child's school life in one place without calling the office.  
_Source: PRD-15 FR-6.2_

### FR-39 (HIGH)
As a admin or teacher, I want: creator/admin tracking page shows per-student status (Granted, Declined, No response) with filters, CSV export (?format=csv), and 'Remind non-responders' throttled to once per 24 hours, so that trips and conferences can be planned without paper or phone calls.  
_Source: PRD-15 FR-6.3; API tracking/remind_

### FR-40 (HIGH)
As a parent, I want: maintenance run sends a reminder 48 hours before dueAt to parents with no response, so that I can manage my child's school life in one place without calling the office.  
_Source: PRD-15 FR-6.4_

### FR-41 (HIGH)
As a parent, I want: register file context 'absence-note' readable by the submitting parent, other linked parents, homeroom teacher and admins, so that I can manage my child's school life in one place without calling the office.  
_Source: PRD-15 FR-7.1_

### FR-42 (HIGH)
As a parent, I want: navigation entries: Parents — My children, Absence notes, Conferences, Consent forms; Teachers — Absence notes (homeroom only), Conferences; Admins — Conferences, Consent forms, Absence notes, so that I can manage my child's school life in one place without calling the office.  
_Source: PRD-15 FR-8.1_

### FR-43 (HIGH)
As a developer, I want: implement the REST API table (me/children/summary, students/:id/overview, absence-notes CRUD/review, conferences, availability, slots, book/cancel, consent-forms, responses, tracking, remind) with role checks enforced server-side via requireRole/access helpers and the standard response/error shapes, so that the feature is consistent, testable and safe to build on.  
_Source: PRD-15 API table; Platform Context conventions_

### FR-44 (MEDIUM)
As a developer, I want: register new notification types absence_note.submitted, absence_note.reviewed, conference.slots_requested, conference.booked, conference.cancelled, consent.requested (and consent reminder) in src/server/notifications/types.ts, so that the feature is consistent, testable and safe to build on.  
_Source: PRD-15 FR-4/5/6 notify keys; Platform Context notifications rule (reminder key name not specified)_

### FR-45 (HIGH)
As a developer, I want: seed data: one pending and one approved absence note for Grade 7; 'Autumn conferences' 3 weeks out for Grade 7 with Tom and Tina slots 15:00–17:00 (10 min), two booked; consent form 'Science Museum Trip' for Grade 7 due in 10 days linked to a calendar event with 40% responses, so that the feature is consistent, testable and safe to build on.  
_Source: PRD-15 Seed Data_

### FR-46 (HIGH)
As a developer, I want: tests: unit (absence coverage matching whole-day/periods/multi-day, slot generation, signature match); integration (approval updates/pre-fill, concurrent atomic booking, notification suppression); Playwright (absence note → approve → register EXCUSED; book conference slot; sign consent), so that the feature is consistent, testable and safe to build on.  
_Source: PRD-15 Test Requirements_

## Acceptance Criteria (from PRD)

1. Pat switches to Sara → timetable, assignments, grades show Sara's data without extra selection.
2. Pat reports Sam absent tomorrow (medical), Tom approves → tomorrow's register pre-fills Sam EXCUSED with 'Absence note' badge; no absence notification sent.
3. Sam ABSENT yesterday, note for yesterday approved → records become EXCUSED, attendance rate recalculated.
4. Rejected note → Pat notified with reviewer's note; records stay ABSENT.
5. Two parents click the same slot simultaneously → one succeeds, other gets 'just taken'.
6. Pat has 15:20 with Tina, tries Tom at 15:20 → overlap error.
7. Grade 7 consent form, Pat grants for Sam typing 'pat parent' → accepted (case-insensitive), tracking shows Granted.
8. Parent with one child signs in → lands on that child's overview.

## Non-Functional Requirements

- **NFR-1** (HIGH): Concurrency: two simultaneous bookings of the same slot → exactly one succeeds; the other gets 'That slot was just taken' (409 CONFLICT) and refreshed slots. _(Source: PRD-15 NFR-1; AC-5)_
- **NFR-2** (HIGH): Performance: child overview first section paints < 1 s; full page < 2 s. _(Source: PRD-15 NFR-2)_
- **NFR-3** (HIGH): Auditability: absence approvals, consent responses and changes write AuditLog entries including IP address. _(Source: PRD-15 NFR-3)_
- **NFR-4** (HIGH): UI component rule: Material UI only (@mui/material v9, icons, MUI X data-grid/date-pickers/charts/scheduler); every component looked up via mui-mcp (useMuiDocs + fetchDocs) before use; banned libraries (Tailwind, shadcn, Radix, Chakra, lucide-react, notistack, etc.) never imported; toasts via shared useToast(), confirmations via Dialog, pickers via Autocomplete; MCP unreachable = blocker. QA must verify. _(Source: PRD-15 Platform Context — UI component rule (item 6 mandates recording as NFR))_
- **NFR-5** (HIGH): Security/access: every handler and server page enforces access server-side; parents only for linked students, homeroom teachers only for their section, consent tracking only creator/admin. _(Source: PRD-15 Platform Context — Roles; code conventions)_
- **NFR-6** (HIGH): Brownfield: reuse existing models/services/components/helpers (audit(), notify(), files contexts, attendance-service, AudienceType/audience.ts, DataTable, FileUpload, MarkdownView, ConfirmDialog, UserAvatar); new services in src/server/<feature>/<feature>-service.ts; no renames, no re-scaffolding. _(Source: PRD-15 Platform Context — Code layout and conventions)_
- **NFR-7** (HIGH): Quality gates: npm run lint && npm run typecheck && npm run test stay green; TypeScript strict; Zod validators in src/lib/validators/<feature>.ts shared by forms and handlers; no console.log (use logger). _(Source: PRD-15 Platform Context — Constraints; conventions)_
- **NFR-8** (HIGH): Date handling: timestamps stored UTC, displayed and date rules (absence windows, 'today', due dates, 48h reminder) evaluated in SchoolSettings.timezone; date-only fields use @db.Date. _(Source: PRD-15 Platform Context — conventions; Assumptions)_
- **NFR-9** (HIGH): Scope: deliver in a single forge run; no payments, pickup/transport, or parent self-registration; do not modify behaviour owned by PRD-16+. _(Source: PRD-15 Out of Scope; Constraints)_
- **NFR-10** (MEDIUM): Lists use standard pagination (?page, ?pageSize ≤100), sorting and ?q search where applicable. _(Source: PRD-15 Platform Context — Pagination conventions)_

## Open Questions / Flagged Assumptions

- PRD-12 Announcement model/read-state is absent from the workspace (only src/server/announcements/audience.ts). Should the overview Announcements card render an empty state, or must SH-15 add a minimal Announcement read model? (FR-13)
- PRD-14 dev phase failed (run-summary SH-14 dev failedCount=1): CalendarEvent models exist but no calendar pages/API. How should 'My meetings' (FR-35), 'Upcoming events' (FR-14), calendar studentId filter (FR-5) and ConsentForm.eventId linking be satisfied?
- Shared wrappers live under src/components/<Name>/ (e.g. src/components/Toast/useToast.ts), not src/components/shared/ as the PRD states. Confirm reuse in place rather than moving.
- Student detail route is /students/[id] (not [studentId]); confirm overview 'View all' links target existing tabs.
- No parent timetable/grades page with a child selector found under src/app/(app) (only /grades, /assignments and /api/me/timetable). Which pages must adopt the sh_child default (FR-5)?
- Notification key name for the 48h consent reminder and the manual 'Remind non-responders' is not specified (FR-44).
- Does 'block individual slots' need a new ConferenceSlot field (schema has none), or is a blocked slot represented by deleting it? (FR-29)
