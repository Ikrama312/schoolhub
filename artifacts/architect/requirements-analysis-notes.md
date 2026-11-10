# Requirements Analysis Notes: ticket SH-15

Written by `arch-research-reqs` for `arch-design-system`. This is a supporting document, not a primary phase output.
Source: `artifacts/intake/requirements.json` (2026-11-10T12:00:00Z), PRD-15 Parent Portal: Child Switcher, Absence Notes & Conference Booking. It has 46 FRs and 10 NFRs (56 requirements) at 95% confidence.
`handoff-to-architect.json` lists **no blockers**. It has 6 warnings, and 7 clarifications are unresolved. §3 proposes a default for each one so that `arch-design-system` can decide.

## 1. Codebase facts verified (2026-11-10)

| Fact | Where | Impact |
|---|---|---|
| No `AbsenceNote`/`Conference*`/`Consent*` models; `AudienceType` exists (SCHOOL, STAFF, ROLE, GRADE_LEVEL, SECTION, COURSE) | `prisma/schema.prisma:1236` | FR-1: one additive migration. Consent can only use 3 of the 6 values, so this must be enforced in Zod, not by a new enum |
| `Section.homeroomTeacherId` exists; `assertHomeroom`-style check is private to attendance-service | `schema.prisma:397`, `attendance-service.ts:56-60` | FR-21/22/41 "homeroom teacher" = `Section.homeroomTeacherId` for the student's current-year `SectionMember` section. Export or duplicate a small helper |
| EXCUSED is ADMIN-only on save; `canExcuse: user.role === 'ADMIN'` on load | `attendance-service.ts:219`, `:208` | FR-25: replace with a per-record check against approved notes; `getRegister` must return per-student `excusable` + `noteId` for FR-24 badge/pre-fill |
| Absent/late notifications are sent after commit via `notificationsFor(diff)` → `notifyStudentAndParents` | `attendance-service.ts:~297-310` | FR-27: filter `notes.absent` against PENDING/APPROVED note coverage at this single point |
| `AttendanceRecord` requires a `sessionId`; there is no sessionless record | `schema.prisma:569-585` | FR-23 "no record yet": approval cannot create records without a session. Updates existing ABSENT records; for dates with no session, coverage is applied at register load (FR-24). The same coverage function serves both |
| `audit()` stores IP only when `request` is passed | `src/server/audit.ts:12,38` | NFR-3: absence review, consent response handlers must pass `request` |
| Maintenance = passes run on every `/api/internal/email/dispatch` call | `src/server/quiz/maintenance.ts`, `assignments/reminders.ts` | FR-40: add a consent-reminder pass there; idempotency needs a "reminded48hAt" marker (field or AuditLog/Notification lookup) |
| Files: contexts registered in `src/server/files/contexts.ts`, `registerFileAccess` | `src/server/files/access.ts` | FR-41: add `absence-note` context in contexts.ts |
| Notification types: static map `NOTIFICATION_TYPES` | `src/server/notifications/types.ts` | FR-44: add keys only, no runtime API |
| `GET /api/me/children` exists (PARENT, via `listLinksForParent`) | `src/app/api/me/children/route.ts` | FR-3/4/7: reuse `listLinksForParent` as the sole source for the switcher and cookie validation |
| Calendar: `CalendarEvent`/`EventAudience` models + `src/server/calendar/{ical,recurrence}.ts`, but no calendar service/API/pages | `schema.prisma:1270`, `src/server/calendar` | FR-14/35/36 and the calendar part of FR-5 have only partial upstream support (see §3 Q2). `ical.ts` is reusable for FR-33 .ics |
| No Announcement model (only `announcements/audience.ts`) | `src/server/announcements` | FR-13 has no data source (see §3 Q1). `audience.ts` is reusable for FR-36 consent audience resolution |
| No `/my-children`, `/conferences`, `/consent-forms` routes; parent landing is `/dashboard`; student detail is `/students/[id]` | `src/app/(app)` | FR-7/8: new route group; change the post-sign-in redirect for PARENT |
| Validators per feature in `src/lib/validators/*.ts` | — | NFR-7: add `absence-notes.ts`, `conferences.ts`, `consent-forms.ts` |

## 2. Requirement → architectural concern

Concern keys: **DM** data model · **API** endpoint · **UI** page/surface · **SVC** service logic · **JOB** background/maintenance · **AUTH** access boundary · **NOTIF** notification · **INT** integration with existing module · **X** cross-cutting

| Req | Concern | Notes |
|---|---|---|
| FR-1 | DM | 3 enums + 6 models in one migration. `ConsentAudience` reuses `AudienceType`. Index `AbsenceNote(studentId, status, fromDate)`; `ConferenceSlot(eventId, teacherId, startsAt)` unique; `ConsentResponse(formId, studentId)` unique (FR-38) |
| FR-2 | SVC (Zod) | `src/lib/validators/absence-notes.ts`, `conferences.ts`. Span ≤ 30 days and `periodIds` only when `partialDay` use `.superRefine`. The same schema is used by the form and the handler |
| FR-3 | UI + X | Top-bar switcher in `shell.tsx` (PARENT only). Writes the `sh_child` cookie via server action or route; MUI `Select`/`Menu` + `UserAvatar` |
| FR-4 | AUTH + SVC | One `getSelectedChild(parent)` helper (cookie → `ParentStudentLink` check → fallback first child). Called on every parent request. Never trust the cookie alone |
| FR-5 | INT | Parent pages resolve `studentId = searchParams.studentId ?? getSelectedChild()`, and `?studentId` is still access-checked. Target pages: `/grades`, `/assignments`, timetable (`/api/me/timetable` consumer), calendar (if present) (§3 Q5) |
| FR-6 | UI | Same component; renders a name only when there is 1 child |
| FR-7 | UI + API | `/my-children` server page. 1 child → `redirect`. `GET /api/me/children/summary` returns per-child attendance rate (attendance-service term rate), missing count, average grade |
| FR-8 | INT | Post-sign-in redirect for PARENT → `/my-children` (which redirects to the overview for 1 child) |
| FR-9 | INT | Reuse timetable service + SchoolDay/holiday data for "today" in `SchoolSettings.timezone` (NFR-8) |
| FR-10 | INT | Reuse `getStudentAttendance` + term counts; button links to FR-18 form |
| FR-11 | INT | Reuse assignments service (missing = past due, no submission, not exempt) |
| FR-12 | INT | Reuse gradebook service; only visible/returned grades (respect existing visibility rules) |
| FR-13 | INT (gap) | No source. Default: empty-state card with no new model (§3 Q1) |
| FR-14 | INT (gap) | `CalendarEvent` + `EventAudience` query exists at model level. Default: a small read-only query in the overview service (§3 Q2) |
| FR-15 | INT | Teachers from the student's active `Enrollment`→`Course.teacher` + subject. "Message" links to PRD-13 compose with the recipient prefilled |
| FR-16 | SVC | Pending consent responses for the child + open conference events with no booking for the child |
| FR-17 | UI + X | Each card is a separate async server component in `<Suspense>` with a `LoadingSkeleton` fallback. Also drives NFR-2 |
| FR-18 | UI + API | `/my-children/[studentId]/absence/new`. Date window −14/+60 days in school TZ. Period checkboxes come from `Period` (bell schedule). `FileUpload` with context `absence-note` |
| FR-19 | NOTIF | `absence_note.submitted` → homeroom teacher(s) of the student's section + all ADMINs |
| FR-20 | UI + API | `GET /api/absence-notes` scoped by role (parent = linked students). Uses DataTable with standard pagination (NFR-10) |
| FR-21 | UI + API + AUTH | `/attendance/absence-notes` queue. TEACHER limited to homeroom sections, ADMIN sees all. The detail view joins existing `AttendanceRecord`s for the date range |
| FR-22 | API + SVC | `POST /api/absence-notes/:id/review` `{decision, note}`; note required on reject (Zod). Only PENDING notes are reviewable (else 409) |
| FR-23 | SVC + INT | Inside one transaction, update ABSENT records in sessions matching the dates (+ periodIds if partial) to EXCUSED with note `Absence note #<id>`; `audit()` with request. Rate recalculation is automatic because rates are computed on read. **Core shared function:** `noteCovers(note, date, periodId?)` |
| FR-24 | INT | `getRegister` computes approved-note coverage for each student/date/period and pre-fills EXCUSED + badge when the record does not exist yet |
| FR-25 | AUTH + INT | Replace the ADMIN-only guard in `saveRegister` with: ADMIN, or an approved note covers (student, date, period). Use the same coverage function |
| FR-26 | NOTIF | `absence_note.reviewed` → submitting parent (+ other linked parents?), body includes reviewNote |
| FR-27 | INT | Filter `notes.absent` in `saveRegister` with a PENDING/APPROVED coverage lookup (batched, one query per save) |
| FR-28 | UI + API + NOTIF | `/admin/conferences`, `POST/PATCH /api/conferences`. Eligible teachers = teachers of courses with enrolled students in the eligible grade levels. Grade levels are stored on the event (array or join; FR-1 spec decides) |
| FR-29 | UI + API + SVC | `PUT /api/conferences/:id/availability` replaces the teacher's unbooked slots in a transaction and never touches booked slots. Pure function `generateSlots(ranges, slotMinutes)` (unit test FR-46). Blocking: §3 Q7 |
| FR-30 | UI + API + SVC | `/conferences/[id]` for the selected child's teachers. Booking = `updateMany where {id, bookedByParentId: null}`; count 0 → 409 |
| FR-31 | SVC | Pre-checks in the same transaction: no existing slot for (teacher, child); no overlapping slot booked by this parent. Use the exact error message text |
| FR-32 | SVC | Booking/cancel allowed only while `now` is within `[bookingOpensAt, bookingClosesAt]`. Reschedule is client-side cancel + book (no new endpoint) |
| FR-33 | NOTIF + API | `conference.booked`/`cancelled` → parent + teacher. `.ics` via `GET /api/conference-slots/:id/ics` reusing `src/server/calendar/ical.ts` |
| FR-34 | UI | Teacher day view with `@media print` CSS. Reads the teacher's booked slots for the event |
| FR-35 | INT (gap) | No calendar aggregation exists (SH-14 failed). Default: expose `listMyMeetings(user, range)` from the conference service for a future calendar source, and show booked slots on the overview/conference pages (§3 Q2) |
| FR-36 | UI + API + AUTH + NOTIF | `/consent-forms/new`. TEACHER only for COURSE audiences of courses they teach. Audience is resolved to students via `announcements/audience.ts` and then to linked parents. `eventId` is an optional FK to `CalendarEvent` |
| FR-37 | UI + API + SVC | `POST /api/consent-forms/:id/responses`. Signature check: `trim().toLowerCase()` equals the parent's full name (pure function, unit test). Only before `dueAt` |
| FR-38 | DM + SVC | Unique (formId, studentId) upsert; `respondedById` = latest parent. Every create/change → `audit()` with old/new + request |
| FR-39 | UI + API | `GET /api/consent-forms/:id/tracking` (creator/admin), `?format=csv` via `src/server/csv.ts`. `POST …/remind` throttled by a `lastRemindedAt` field on ConsentForm (24 h) → 429 |
| FR-40 | JOB | Pass in dispatch maintenance: forms with `dueAt` in (now, now+48h] not yet reminded → notify non-responders and set a marker (e.g. `autoReminderSentAt`) for idempotency |
| FR-41 | AUTH | `absence-note` context in `files/contexts.ts`: submitting parent, other linked parents, the student's homeroom teacher, ADMIN |
| FR-42 | UI | Nav config in `shell.tsx`. Teacher "Absence notes" only if they are a homeroom teacher (current year) |
| FR-43 | API + AUTH | ~20 route handlers using `withHandler` / `requireRole` / `ok` from `src/server/http.ts`. Thin handlers call `src/server/<feature>/<feature>-service.ts` |
| FR-44 | NOTIF | Add 6 keys + `consent.reminder` (one key covers both the manual and the 48 h reminder) to `NOTIFICATION_TYPES` with the PRD's `defaultEmail` values |
| FR-45 | X (seed) | Extend `prisma/seed.ts`. The consent form needs a seeded CalendarEvent. Tom/Tina must be teachers of Grade 7 courses |
| FR-46 | X (tests) | Unit: `noteCovers`, `generateSlots`, `signatureMatches`. Integration: approval, pre-fill, concurrent booking (`Promise.all` of 2 bookings), suppression. 3 Playwright specs |
| NFR-1 | SVC + DM | Conditional `updateMany` is the guarantee (no app lock). 409 `CONFLICT` "That slot was just taken"; the client refetches slots |
| NFR-2 | X | Suspense per card (FR-17). Each card runs ≤ 2 queries with `select`. Shell + header render first |
| NFR-3 | X | `audit({…, request})` on review, consent respond/change, conference admin edits |
| NFR-4 | UI | MUI v9 + X only; mui-mcp lookups are required per component (the tools are available this session). Notable components: Select/Menu (switcher), Card, DataGrid, DatePicker, Checkbox group, ToggleButton (slots), Dialog |
| NFR-5 | AUTH | Central access helpers: `assertParentOf(user, studentId)`, `assertHomeroomOf(user, studentId)`, `assertConsentOwner(user, form)`. Server pages call them too, not only APIs |
| NFR-6 | X | New services: `src/server/absence-notes/`, `conferences/`, `consent-forms/`, `parent-portal/` (overview, child selection). No moves or renames |
| NFR-7 | X | Validators in `src/lib/validators/`; use logger, not console |
| NFR-8 | X | `@db.Date` for `fromDate`/`toDate`/conference `date`; all windows (−14/+60, today, dueAt−48h) use the existing `schoolToday(now, tz)` |
| NFR-9 | X | Do not build calendar/announcement subsystems (PRD-12/14 scope); use degrade-gracefully defaults |
| NFR-10 | API | List endpoints (`absence-notes`, `consent-forms`, `tracking`, admin `conferences`) use the standard `?page&pageSize≤100&sort&q` |

## 3. Open questions: proposed defaults for `arch-design-system`

| # | Question (from intake) | Proposed default | Reqs |
|---|---|---|---|
| Q1 | Announcements card has no model | Render the card with an `EmptyState` ("No announcements"). Do not add an Announcement model, because it belongs to PRD-12 (NFR-9). Record this as a known gap | FR-13 |
| Q2 | Calendar API/pages missing (SH-14 failed) | Upcoming events: query `CalendarEvent`+`EventAudience` directly in the overview service (read-only, small). My meetings: expose `listMyMeetings` and list booked meetings on the overview/conference pages; full calendar integration is deferred to PRD-14. `ConsentForm.eventId`: optional FK, picked via Autocomplete over existing events | FR-5, FR-14, FR-35, FR-36 |
| Q3 | Shared components at `src/components/<Name>/` | Reuse in place; do not move them (NFR-6) | NFR-6 |
| Q4 | Student route is `/students/[id]` | "View all" links target `/students/[id]?tab=…` where tabs exist, otherwise the feature pages (`/grades?studentId=`, `/assignments?studentId=`) | FR-17 |
| Q5 | Which pages adopt `sh_child` | `/grades`, `/assignments`, `/api/me/timetable` consumers, and new SH-15 pages. Calendar only once it exists | FR-5 |
| Q6 | Reminder notification key | Single key `consent.reminder` (defaultEmail true) for both the manual and the 48 h reminder | FR-39, FR-40, FR-44 |
| Q7 | Blocking slots: schema has no field | Add `blocked Boolean @default(false)` to `ConferenceSlot`. Deleting a slot would lose it on availability regeneration. Note that this is the only deviation from the PRD's "exactly as specified" model (FR-1) | FR-1, FR-29 |

Additional decisions the design must make:
- **Homeroom resolution** (FR-19/21/41/42): student → current-year `SectionMember` → `Section.homeroomTeacherId`. Put this in one shared helper.
- **Throttle/idempotency markers** (FR-39/40): this needs fields not in the PRD model (`lastRemindedAt`, `autoReminderSentAt`). Alternative: query `Notification` rows of type `consent.reminder`. Fields are simpler, so the recommendation is to add them.
- **FR-23 vs FR-24 split**: approval changes only existing ABSENT records. Future or untaken registers rely on load-time coverage. One `noteCovers` function underpins FR-23/24/25/27, and it is the main unit-test target.
- **FR-26 recipients**: the submitting parent is required. Notifying other linked parents is optional (recommended, since FR-41 already grants them read access).
