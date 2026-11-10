# System Design: PRD-15 Parent Portal (Child Switcher, Absence Notes, Conference Booking, Consent Forms)

Ticket: SH-15 · Phase: architect (arch-design-system) · Timestamp: 2026-11-10T13:00:00Z · Status: complete

Inputs: `artifacts/intake/requirements.json` (FR-1 to FR-46, NFR-1 to NFR-10), `artifacts/intake/handoff-to-architect.json`, `artifacts/architect/tech-stack-decisions.md` (ADR-1 to ADR-13), `artifacts/architect/requirements-analysis-notes.md`.

> This file replaces the SH-14 version. `api-contracts.json`, `handoff-to-dev-planning.json` and `threat-model-notes.json` are still from SH-14 until `arch-api-contracts` rewrites them.

---

## 1. Overview

SH-15 adds a parent portal to the existing Next.js 14 / Prisma / MUI v9 brownfield app. It has five parts:

1. **Child context:** the `sh_child` cookie, a top-bar switcher, and a default student on parent pages (FR-3 to FR-6).
2. **Child overview:** `/my-children` and `/my-children/[studentId]`, built from eight streaming cards (FR-7 to FR-17).
3. **Absence notes:** parents submit notes, teachers and admins review them, and approved notes connect to attendance (FR-18 to FR-27, FR-41).
4. **Parent–teacher conferences:** admins create events, teachers set availability, and parents book slots atomically (FR-28 to FR-35).
5. **Consent forms:** staff create forms, parents respond with a typed signature, and creators track responses and send reminders (FR-36 to FR-40).

All five use the existing building blocks:

- `withHandler`, `requireRole` and `ok`/`AppError` from `src/server/http.ts`
- `assertCanViewStudent` and `getAccessibleStudentIds` from `src/server/auth/student-access.ts`
- `audit()` and `notify()` / `notifyStudentAndParents()`
- The file contexts registry
- The audience helpers in `src/server/announcements/audience.ts`
- `attendance-rules.ts` (`schoolToday`, `attendanceRate`)
- `src/server/calendar/ical.ts`
- The cron route `/api/internal/email/dispatch`

The design adds **no new dependencies** (ADR-1) and moves or renames nothing (NFR-6).

### Blockers and warnings from intake

`handoff-to-architect.json` reports **`blockers: []`** at 95% confidence. Its warnings and the seven unresolved questions are settled as follows. Each is an assumption, not a blocker.

| Intake warning / question | Design decision | Reqs |
|---|---|---|
| PRD-12 Announcement model absent | The Announcements card renders an `EmptyState`. `listUnreadAnnouncements()` returns `[]`. **FR-13 is partial.** | FR-13 |
| SH-14 calendar has no API or pages | Upcoming events queries `CalendarEvent` directly through `audienceWhereForUser`. "My meetings" appear as overview items. There is no calendar `studentId` filter, because no calendar page exists. **FR-14 is complete. FR-35 and the calendar part of FR-5 are partial.** | FR-5, FR-14, FR-35 |
| Shared components live under `src/components/<Name>/` | Reuse them in place. | NFR-6 |
| Student detail route is `/students/[id]` | "View all" links point to `/students/[id]` tabs, `/assignments?studentId=` and `/grades?studentId=`. | FR-17 |
| Which pages adopt `sh_child` | `/assignments`, `/grades`, `/api/me/timetable`, and all new SH-15 parent pages. | FR-5 |
| Reminder notification key | One key, `consent.reminder`, for both the manual and the 48 h reminder. | FR-44 |
| `attendance-service.ts:219` allows EXCUSED for ADMIN only | Replace the check: ADMIN, or an APPROVED note covers the record. | FR-25 |
| Blocked slots | Add a `ConferenceSlot.blocked` column. | FR-29 |

### Deviations from "exactly as specified" (FR-1)

The design adds three columns that the PRD does not list (ADR-3):

| Column | Reqs | Purpose |
|---|---|---|
| `ConferenceSlot.blocked Boolean @default(false)` | FR-29 | A blocked slot survives availability regeneration. |
| `ConsentForm.lastRemindedAt DateTime?` | FR-39 | 24 h throttle that holds across processes. |
| `ConsentForm.dueReminderSentAt DateTime?` | FR-40 | Makes the 48 h reminder idempotent. |

The migration also adds a raw-SQL partial unique index on `ConferenceSlot(eventId, teacherId, bookedForStudentId) WHERE bookedForStudentId IS NOT NULL` (FR-31, ADR-4). If the PRD's model already has an equivalent field, use it and drop the extra column.

---

## 2. Component Breakdown

### 2.1 Data layer: one additive migration `…_prd15_parent_portal` (FR-1, FR-2, NFR-8)

| Model / enum | Key fields and constraints | Reqs |
|---|---|---|
| `enum AbsenceNoteStatus`, `AbsenceReason`, `ConsentResponseValue` | As specified in the PRD | FR-1 |
| `AbsenceNote` | `studentId`, `submittedById`, `fromDate`/`toDate @db.Date`, `partialDay`, `periodIds String[]`, `reason`, `details`, `fileId?`, `status`, `reviewedById?`, `reviewNote?`, `reviewedAt?`. Index `(studentId, status, fromDate)` | FR-1, FR-18, FR-22 |
| `ConferenceEvent` | `title`, `date @db.Date`, `bookingOpensAt`, `bookingClosesAt`, `slotMinutes` (5–60), eligible grade levels, `createdById` | FR-1, FR-28 |
| `ConferenceSlot` | `eventId`, `teacherId`, `startsAt`, `endsAt`, `location?`, `bookedByParentId?`, `bookedForStudentId?`, `parentNote?` (≤ 500), **`blocked`**. Unique `(eventId, teacherId, startsAt)`, plus the partial unique index above | FR-1, FR-29 to FR-31 |
| `ConsentForm` | `title`, `description` (Markdown), `dueAt`, `eventId?` FK to `CalendarEvent`, `createdById`, **`lastRemindedAt?`**, **`dueReminderSentAt?`** | FR-1, FR-36, FR-39, FR-40 |
| `ConsentAudience` | `formId`, `type AudienceType` (GRADE_LEVEL, SECTION or COURSE, enforced in Zod), `refId` | FR-1, FR-36 |
| `ConsentResponse` | `formId`, `studentId`, `respondedById`, `value`, `signature`, `comment?`. `@@unique([formId, studentId])` | FR-1, FR-38 |

Validators live in `src/lib/validators/{absence-notes,conferences,consent-forms}.ts`. Forms and handlers share the same Zod schemas, which enforce the FR-2 limits with `.superRefine`. They also enforce the −14/+60 day window (FR-18) and the rule that a reject requires a note (FR-22). (NFR-7)

### 2.2 Server modules (NFR-6: `src/server/<feature>/`)

| Module | Responsibilities | Reqs |
|---|---|---|
| `src/server/parent/selected-child.ts` | `getSelectedChild(user, searchParams?)`, wrapped in React `cache()`. It resolves in this order: a linked `?studentId=`, then a linked `sh_child` cookie, then the first linked child (`listLinksForParent`). `setSelectedChildCookie(studentId)` validates the link before it writes the cookie (`httpOnly`, `sameSite=lax`, 1 year). | FR-3 to FR-6 |
| `src/server/parent/overview-service.ts` | One function per card: `getToday`, `getAttendanceSummary`, `getAssignmentsSummary`, `getRecentGrades`, `listUnreadAnnouncements` (returns `[]`), `getUpcomingEvents` (next 5, `CalendarEvent` plus booked meetings), `getTeachers`, `getActionItems` (pending consent plus open conferences). `getChildrenSummary(parent)` builds the `/my-children` cards. Every function reuses the existing timetable, attendance, assignments and gradebook services. | FR-7, FR-9 to FR-16, FR-35 |
| `src/server/absence-notes/absence-coverage.ts` | **Pure, no Prisma.** `coversRecord(note, { date, periodId })`. A whole-day note covers every period on each date in range. A partial note covers only its `periodIds`. A record with a null `periodId` (daily homeroom) is covered by any note for that date. | FR-23 to FR-25, FR-27, FR-46 |
| `src/server/absence-notes/absence-notes-service.ts` | `submit` (sets PENDING, then `notify('absence_note.submitted')` to the homeroom teacher and ADMINs), `list` (scoped by role, paginated), `getForReview` (joins existing `AttendanceRecord`s), `review` (see §3.2), `findCovering(studentIds, dateRange, statuses)` for attendance-service, `homeroomTeacherOf(studentId)`. | FR-18 to FR-23, FR-26, FR-41 |
| `src/server/attendance/attendance-service.ts` (changed in place) | `getRegister`: pre-fill EXCUSED and set `noteId`/`excusable` for each student covered by an APPROVED note. `saveRegister:219`: allow EXCUSED for ADMIN, or when an APPROVED note covers the record. `~:299`: before `notifyStudentAndParents`, drop `attendance.absent` for students covered by a PENDING or APPROVED note. | FR-24, FR-25, FR-27 |
| `src/server/conferences/conference-slots.ts` | **Pure.** `generateSlots(ranges, slotMinutes)` and `overlaps(a, b)`. | FR-29, FR-31, FR-46 |
| `src/server/conferences/conferences-service.ts` | `createEvent`/`updateEvent` (ADMIN), which notifies eligible teachers with `conference.slots_requested`. `setAvailability` uses one transaction to delete the teacher's unbooked, unblocked slots and insert the newly generated ones. Booked and blocked slots are never touched. `setSlotBlocked`, `removeSlot` (unbooked only), `listBookable(event, child)`, `book` and `cancel` (§3.3), `teacherDay(event, teacher)`, `listMyMeetings(user, range)`, `slotIcs(slot, user)`. | FR-28 to FR-35 |
| `src/server/consent-forms/consent-forms-service.ts` | `create`: checks `canTargetAudience` for each audience row, then notifies parents of the resolved audience students with `consent.requested`. Also `listForParent`, `respond` (§3.4), `tracking` (JSON or CSV through `src/server/csv.ts`), `remind` (24 h claim on `lastRemindedAt`, else 429), and `sendConsentDueReminders(now)` (claims `dueReminderSentAt`). | FR-36 to FR-40 |
| `src/server/consent-forms/signature.ts` | **Pure.** `signatureMatches(typed, fullName)` compares both values after `trim().toLowerCase()`. | FR-37, FR-46 |
| `src/server/files/contexts.ts` (extended) | `absence-note` resolver grants read access to any linked parent, the homeroom teacher and ADMIN. Uploads allow PDF, JPG and PNG, checked with `file-type`. | FR-18, FR-41 |
| `src/server/notifications/types.ts` (extended) | `absence_note.submitted` (email false), `absence_note.reviewed` (true), `conference.slots_requested`, `conference.booked`, `conference.cancelled`, `consent.requested` (true), `consent.reminder` (true) | FR-19, FR-26, FR-28, FR-33, FR-36, FR-40, FR-44 |
| `src/app/api/internal/email/dispatch` (extended) | Adds an isolated try-block that calls `sendConsentDueReminders(now)`. | FR-40 |

**Access helpers (NFR-5).** Every page and handler calls one of these:

- `assertCanViewStudent`, for parent-to-child scoping
- `assertHomeroomOrAdmin(user, studentId)`, in absence-notes-service, built on `Section.homeroomTeacherId` for the current-year `SectionMember`
- `assertConsentOwnerOrAdmin(user, form)`
- `requireRole`

The `sh_child` cookie is never read except through `getSelectedChild`.

### 2.3 API layer (FR-43)

Route handlers are thin. They use `withHandler`, then Zod parse, then a service call, then `ok()`, all under `src/app/api/`. Every list endpoint supports `?page&pageSize≤100&sort&q` (NFR-10).

| Area | Routes | Roles | Reqs |
|---|---|---|---|
| Child context | `POST /api/me/selected-child` | PARENT | FR-3, FR-4 |
| Parent summaries | `GET /api/me/children/summary`, `GET /api/students/:id/overview` | PARENT (linked), staff via `assertCanViewStudent` | FR-7, FR-9 to FR-16 |
| Absence notes | `GET/POST /api/absence-notes`, `GET /api/absence-notes/:id`, `POST /api/absence-notes/:id/review` | PARENT (own children), TEACHER (homeroom), ADMIN | FR-18 to FR-23, FR-26 |
| Conferences | `GET/POST /api/conferences`, `GET/PATCH /api/conferences/:id`, `PUT /api/conferences/:id/availability`, `GET /api/conferences/:id/slots`, `PATCH/DELETE /api/conference-slots/:id`, `POST /api/conference-slots/:id/book`, `POST /api/conference-slots/:id/cancel`, `GET /api/conference-slots/:id/ics` | ADMIN (events), TEACHER (own availability), PARENT (book and cancel for the selected or linked child) | FR-28 to FR-34 |
| Consent forms | `GET/POST /api/consent-forms`, `GET /api/consent-forms/:id`, `POST /api/consent-forms/:id/responses`, `GET /api/consent-forms/:id/tracking[?format=csv]`, `POST /api/consent-forms/:id/remind` | ADMIN, TEACHER (managed courses), PARENT (respond) | FR-36 to FR-39 |

`arch-api-contracts` will write the exact request and response schemas.

### 2.4 UI layer (NFR-4: MUI v9 only, with an mui-mcp lookup per component)

| Route / surface | Kind | Key components | Reqs |
|---|---|---|---|
| `shell.tsx` top bar: `ChildSwitcher` | client | `Select`/`Menu` + `UserAvatar`. With one child it shows a name only. Changing the child POSTs to the selected-child route, then calls `router.refresh()`. | FR-3, FR-6 |
| `src/config/navigation.ts` | config | Parent: My children, Absence notes, Conferences, Consent forms. Teacher: Absence notes (only if homeroom, via a `homeroom` flag passed like `safeguardingLead`) and Conferences. Admin: Conferences, Consent forms, Absence notes. | FR-42 |
| `/dashboard` | server | If the role is PARENT, `redirect('/my-children')`. | FR-8 |
| `/my-children` | server | With one child, `redirect` to the overview. Otherwise show summary `Card`s. | FR-7 |
| `/my-children/[studentId]` | server, streaming | 8 async cards, each in `<Suspense fallback={<LoadingSkeleton/>}>` with a "View all" link | FR-9 to FR-17, NFR-2 |
| `/my-children/[studentId]/absence/new` | client form | RHF + Zod, `DatePicker`, `RadioGroup` (whole day or periods), a `Checkbox` group from `Period`, `FileUpload` (`absence-note`) | FR-18 |
| `/my-children/[studentId]/absence` (parent list) | server + `DataTable` | Status `Chip` | FR-20 |
| `/attendance/absence-notes` | server + `DataTable` | Status and date filters. The detail `Dialog` shows the note, the document link, existing records, and Approve/Reject (reject requires a note). | FR-21, FR-22 |
| Attendance register (existing) | changed | EXCUSED pre-fill + an "Absence note" `Chip` badge. The EXCUSED option is enabled per `excusable`. | FR-24, FR-25 |
| `/admin/conferences` (list, plus new/edit form) | server + client form | `DataTable`, `DatePicker`/`DateTimePicker`, `Autocomplete` (grade levels) | FR-28 |
| `/conferences/[id]/availability` | client | Time-range rows, location `TextField`, a slot list with remove and block `IconButton`s | FR-29 |
| `/conferences/[id]` (parent) | client | One section per teacher of the child, with `Button`/`ToggleButton` slot buttons and an optional note `Dialog`. A 409 shows a toast and refetches. The parent's own booking has Cancel. | FR-30 to FR-32, NFR-1 |
| `/conferences/[id]/day` (teacher) | server | `Table` of booked slots, with `@media print` through `sx` | FR-34 |
| `/conferences` | server | Event list for each role | FR-42 |
| `/consent-forms`, `/consent-forms/new`, `/consent-forms/[id]` | server + client form | `MarkdownEditor`/`MarkdownView`, an audience picker reusing the announcements audience UI pattern, an `Autocomplete` event link, a respond form (`RadioGroup` + signature `TextField` + comment) | FR-36 to FR-38 |
| `/consent-forms/[id]/tracking` | server + `DataTable` | Status filter, CSV export link, "Remind non-responders" `Button` (409 or 429 produces a toast) | FR-39 |

Toasts go through `useToast()` and confirmations through `ConfirmDialog`/`Dialog`. Nothing is imported from the banned list.

---

## 3. Data Flow

### 3.1 Child selection (FR-3 to FR-6)

```
Switcher change → POST /api/me/selected-child {studentId}
  → assert ParentStudentLink → Set-Cookie sh_child (httpOnly) → router.refresh()
Any parent page → getSelectedChild(user, searchParams)
  → ?studentId (if linked) ▸ cookie (if linked) ▸ first linked child
```

The cookie is untrusted. A stale or tampered value falls back to the first child and never errors.

### 3.2 Absence note lifecycle (FR-18 to FR-27)

```
Parent form ─(Zod)→ POST /api/absence-notes
  → assertCanViewStudent → create PENDING (+fileId, context absence-note)
  → notify(absence_note.submitted → homeroom teacher + ADMINs)

Reviewer → POST /api/absence-notes/:id/review {decision, note}
  → assertHomeroomOrAdmin → $transaction:
       updateMany AbsenceNote where {id, status: PENDING} (count 0 → 409)
       if APPROVED: load sessions in [fromDate,toDate] for student's sections;
                    for each covered (date, periodId) via coversRecord:
                      existing ABSENT record → EXCUSED, note "Absence note #<id>"
                      session exists, no record → create EXCUSED record
  → after commit: audit({ request }) (IP, NFR-3); notify(absence_note.reviewed → linked parents, incl. reviewNote)

Register load (getRegister) → findCovering(APPROVED) → pre-fill EXCUSED + badge (future dates, FR-24)
Register save (saveRegister) → EXCUSED allowed if ADMIN or APPROVED note covers (FR-25)
                             → absent notifications filtered by PENDING|APPROVED coverage (FR-27)
```

Attendance rates recalculate without new code, because `attendanceRate()` counts records when it reads them (FR-23). A rejected note changes no records.

### 3.3 Conference booking (FR-28 to FR-33, NFR-1)

```
Admin creates event → notify(conference.slots_requested → teachers of eligible grade levels)
Teacher PUT availability {ranges, location} → generateSlots → $transaction(delete unbooked&unblocked, insert new)
Parent POST /api/conference-slots/:id/book {studentId, note?}
  → assertCanViewStudent; now within [bookingOpensAt, bookingClosesAt] else 422
  → $transaction:
       overlap check vs parent's other booked slots at that time → 409 "You already have a meeting with <teacher> at <time>"
       updateMany where {id, bookedByParentId: null, blocked: false} → count 0 → 409 "That slot was just taken"
       P2002 on (eventId, teacherId, bookedForStudentId) → 409 (one per teacher per child)
  → notify(conference.booked → parent + teacher, link /api/conference-slots/:id/ics)
Cancel → before bookingClosesAt; clear booking fields → notify(conference.cancelled)
Reschedule = cancel + book (client-side, FR-32)
```

### 3.4 Consent forms (FR-36 to FR-40)

```
Create → canTargetAudience per row → insert form+audiences → resolve audience students → linked parents
       → notify(consent.requested)
Respond POST …/responses {studentId, value, signature, comment?}
  → assertCanViewStudent; now < dueAt else 422; signatureMatches(signature, parent full name) else 422
  → upsert by (formId, studentId) → audit({ before, after, request })
Tracking → audience students × responses → Granted/Declined/No response; ?format=csv
Remind → updateMany where {id, lastRemindedAt null|< now-24h} count 0 → 429 → notify(consent.reminder → non-responders)
Cron dispatch → forms with dueAt in (now, now+48h], dueReminderSentAt null → claim → notify(consent.reminder)
```

### 3.5 Overview rendering (FR-7 to FR-17, NFR-2)

The server page calls `assertCanViewStudent` once. The header and switcher paint first. The eight cards then stream independently, each doing one or two indexed `select` queries in `overview-service`. `GET /api/students/:id/overview` calls the same functions for API consumers. All "today", window and due-date evaluation uses `schoolToday(now, SchoolSettings.timezone)` (NFR-8).

---

## 4. Testing and seed data (FR-45, FR-46, NFR-7)

- **Unit tests (Vitest):**
  - `absence-coverage`: whole day, partial periods, multi-day, and a null `periodId`
  - `conference-slots`: generation at range boundaries, `slotMinutes` 5 and 60, and overlap
  - `signature`: case and whitespace
- **Integration tests (Vitest + DB):**
  - Approval converts ABSENT to EXCUSED and leaves PRESENT untouched.
  - Future-register pre-fill.
  - Two concurrent `book` calls run through `Promise.all`: exactly one succeeds and the other gets 409.
  - `attendance.absent` is suppressed while a PENDING note covers the student.
- **Playwright:**
  - Absence note, then approve, then the register shows EXCUSED.
  - Book a conference slot.
  - Sign a consent form.
- **Seed:** extend `prisma/seed.ts` in place:
  - Grade 7: one PENDING and one APPROVED absence note.
  - "Autumn conferences" 3 weeks out, with Tom and Tina slots 15:00–17:00 at 10 minutes each, two of them booked.
  - "Science Museum Trip" consent form due in 10 days, linked to a seeded `CalendarEvent`, with about 40% of responses in.
- **Gates:** `npm run lint && npm run typecheck && npm run test`. Use `logger`, never `console.log`.

---

## 5. Requirements Traceability

| Req | Design element |
|---|---|
| FR-1 | §2.1 migration `…_prd15_parent_portal`, 3 enums and 6 models, 3 flagged extra columns |
| FR-2 | §2.1 Zod validators `src/lib/validators/*` with `.superRefine` |
| FR-3 | §2.2 `selected-child.ts`; §2.4 `ChildSwitcher`; `POST /api/me/selected-child` |
| FR-4 | §3.1 `getSelectedChild` link validation and fallback |
| FR-5 | §2.2 `getSelectedChild` used by `/assignments`, `/grades`, `/api/me/timetable` and new pages (calendar filter partial, ADR-11) |
| FR-6 | §2.4 `ChildSwitcher` single-child mode |
| FR-7 | §2.4 `/my-children`; `getChildrenSummary`; `GET /api/me/children/summary` |
| FR-8 | §2.4 `/dashboard` redirects PARENT to `/my-children` |
| FR-9 | `overview-service.getToday` (timetable + SchoolDay holidays) |
| FR-10 | `overview-service.getAttendanceSummary` + link to the absence form |
| FR-11 | `overview-service.getAssignmentsSummary` |
| FR-12 | `overview-service.getRecentGrades` (visibility rules respected) |
| FR-13 | `listUnreadAnnouncements` returns `[]` and the card shows an `EmptyState` (**partial**, PRD-12 absent) |
| FR-14 | `overview-service.getUpcomingEvents` (`CalendarEvent` via `audienceWhereForUser` + recurrence) |
| FR-15 | `overview-service.getTeachers` + Message link (PRD-13 compose) |
| FR-16 | `overview-service.getActionItems` |
| FR-17 | §3.5 Suspense per card + "View all" links |
| FR-18 | §2.4 absence form; `absence-notes-service.submit`; `absence-note` file context |
| FR-19 | §3.2 `notify(absence_note.submitted)` to homeroom teacher + ADMINs |
| FR-20 | §2.4 parent absence list; `GET /api/absence-notes` |
| FR-21 | §2.4 `/attendance/absence-notes`; `getForReview`; `assertHomeroomOrAdmin` |
| FR-22 | §3.2 `POST /api/absence-notes/:id/review`, PENDING-only conditional update |
| FR-23 | §3.2 approval transaction + `coversRecord` + `audit` |
| FR-24 | §2.2 `getRegister` pre-fill + badge |
| FR-25 | §2.2 `saveRegister:219` EXCUSED rule |
| FR-26 | §3.2 `notify(absence_note.reviewed)` with reviewNote |
| FR-27 | §2.2 attendance-service notification filter (~:299) |
| FR-28 | §2.4 `/admin/conferences`; `createEvent`/`updateEvent`; `conference.slots_requested` |
| FR-29 | §2.4 availability page; `setAvailability`, `generateSlots`, `blocked` column |
| FR-30 | §3.3 conditional `updateMany` booking; `/conferences/[id]` |
| FR-31 | §3.3 overlap check + partial unique index |
| FR-32 | §3.3 booking-window guard; cancel; reschedule = cancel + book |
| FR-33 | §3.3 `conference.booked`/`cancelled` + `GET /api/conference-slots/:id/ics` (`ical.ts`) |
| FR-34 | §2.4 `/conferences/[id]/day`, print CSS |
| FR-35 | `listMyMeetings`, shown as "My meetings" in overview Upcoming events and Action items (**partial**, no PRD-14 calendar page) |
| FR-36 | §3.4 create + `canTargetAudience` + `consent.requested`; `/consent-forms/new` |
| FR-37 | §3.4 respond + `signatureMatches`; overview Action items; `/consent-forms` |
| FR-38 | `ConsentResponse @@unique(formId, studentId)` upsert + `audit` |
| FR-39 | §3.4 tracking/CSV; remind with a `lastRemindedAt` 24 h claim |
| FR-40 | §3.4 `sendConsentDueReminders` in the dispatch cron; `dueReminderSentAt` |
| FR-41 | §2.2 `absence-note` resolver in `files/contexts.ts` |
| FR-42 | §2.4 `src/config/navigation.ts` entries + homeroom flag |
| FR-43 | §2.3 route table, `withHandler`/`requireRole`, standard shapes |
| FR-44 | §2.2 `NOTIFICATION_TYPES` additions incl. `consent.reminder` |
| FR-45 | §4 seed extensions |
| FR-46 | §4 unit, integration and Playwright tests |
| NFR-1 | §3.3 conditional update → 409 "That slot was just taken" + client refetch |
| NFR-2 | §3.5 streaming cards, indexed `select` queries |
| NFR-3 | `audit({ request })` on review, consent respond/change, conference admin edits |
| NFR-4 | §2.4 MUI-only component map, with an mui-mcp lookup required per component |
| NFR-5 | §2.2 access helpers on every page and handler; cookie only via `getSelectedChild` |
| NFR-6 | §2.2 new `src/server/<feature>/` modules; existing files extended in place |
| NFR-7 | §2.1 shared Zod validators; §4 gates; `logger` |
| NFR-8 | `@db.Date` fields; `schoolToday` + `SchoolSettings.timezone` for all date rules |
| NFR-9 | No Announcement or calendar subsystem built; FR-13, FR-35 and FR-5 calendar part degrade (ADR-11) |
| NFR-10 | §2.3 list endpoints use standard pagination, sort and `q` |
