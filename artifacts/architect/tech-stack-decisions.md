# Tech Stack Decisions: PRD-15 Parent Portal (Child Switcher, Absence Notes, Conference Booking)

Ticket: SH-15 · Phase: architect (arch-research-stack) · Timestamp: 2026-11-10T12:30:00Z · Status: complete

> This file replaces the SH-14 version. The other files in `artifacts/architect/` (`system-design.md`, `requirements-analysis-notes.md`, `api-contracts.json`, `handoff-to-dev-planning.json`, `threat-model-notes.json`) are still from SH-14 until their own sub-tasks rewrite them.

**Base stack (checked against `package.json`).** `artifacts/intake/tech-stack.json` reports `react` at 98% confidence. The workspace matches:

- Next.js 14.2.18 App Router, React 18.3.1, TypeScript strict
- Prisma 5.20.0 on PostgreSQL 16, Zod 3.23.8, react-hook-form 7.53.0, Auth.js 5.0.0-beta.25
- MUI 9.5.0 (material, icons-material, material-nextjs, x-data-grid, x-date-pickers, x-charts), @mui/x-scheduler 9.0.0-beta.15 (theme augmentation only)
- date-fns 3.6.0, date-fns-tz 3.2.0, papaparse, file-type 20.5.0, react-markdown + rehype-sanitize (behind `MarkdownView`)
- Vitest 2.1.1, Testing Library, Playwright 1.47.2

Intake reported no blockers (`blockers: []`, 95% confidence). It left six warnings and seven unresolved questions. ADR-11 through ADR-13 cover them.

---

## ADR-1: Keep the existing stack and add no new dependencies

**Context.** NFR-6 says to reuse what exists, with no re-scaffolding. NFR-7 requires lint, typecheck and tests to stay green. NFR-9 limits the work to one forge run. Every PRD-15 feature is covered by something already installed:

- **Forms:** RHF + Zod
- **Dates:** date-fns-tz
- **CSV:** `src/server/csv.ts` / papaparse
- **.ics:** `src/server/calendar/ical.ts`
- **Markdown:** `MarkdownView` / `MarkdownEditor`
- **Uploads:** `FileUpload` + `file-type`
- **Grids:** MUI X DataGrid via `DataTable`
- **Date inputs:** MUI X DatePicker

**Decision.** No new runtime or dev dependencies. `package.json` stays unchanged.

**Consequences.** There is no new supply-chain surface and no lockfile churn. If dev-planning proposes a package, it needs a new ADR.

## ADR-2: UI is MUI only, and every component is looked up in mui-mcp first

**Context.** NFR-4 requires MUI v9 and MUI X only. Banned libraries are never imported. Toasts go through `useToast()`, confirmations through `Dialog`/`ConfirmDialog`, pickers through `Autocomplete`. The mui-mcp server is connected in this session (`useMuiDocs`, `fetchDocs`).

**Decision.** Map each new UI surface to MUI components:

| Surface | Requirements | MUI components |
| --- | --- | --- |
| Child switcher | FR-3, FR-6 | `Select` or `Menu`, with `UserAvatar` |
| Overview cards | FR-9–FR-17 | `Card`, `List`, `Chip`, `LoadingSkeleton` |
| Absence form | FR-18 | `DatePicker`, `RadioGroup`, `Checkbox` group, `FileUpload` |
| Review queue | FR-21, FR-22 | `DataTable`, with `Dialog` for approve/reject |
| Slot buttons | FR-30 | `ToggleButton` or `Button` grid |
| Day view | FR-34 | `Table` with print CSS through `sx` and `@media print` |
| Consent tracking | FR-39 | `DataTable` |
| Signature field | FR-37 | `TextField` |

Developers must call `useMuiDocs` and `fetchDocs` before using each component. If the MCP is unreachable at dev time, that is a blocker, not something to work around.

**Consequences.** QA's banned-import grep stays at zero hits. Printing (FR-34) uses `@media print` styles only, with no print library.

## ADR-3: Data model is one additive Prisma migration, plus three flagged extra columns

**Context.** FR-1 and FR-2 define the enums and models, and reuse `AudienceType` for consent. Consent audiences are limited to GRADE_LEVEL, SECTION and COURSE. Three requirements need persisted state that the PRD field list does not name:

- **FR-29:** block individual slots. Deleting a slot would not work, because the next availability regeneration would recreate it.
- **FR-39:** "Remind non-responders" is limited to once per 24 h. `src/server/rate-limit.ts` is in-memory per process (its own `ponytail:` note says so), so the limit would reset on every deploy or restart.
- **FR-40:** the 48 h reminder must go out once per form.

**Decision.**
- Add one migration `…_prd15_parent_portal` with the enums and models as specified. Date-only fields use `@db.Date` (NFR-8).
- The three extra columns:
  - `ConferenceSlot.blocked Boolean @default(false)` (FR-29)
  - `ConsentForm.lastRemindedAt DateTime?` (FR-39)
  - `ConsentForm.dueReminderSentAt DateTime?` (FR-40)

  Both reminders claim their slot atomically with `updateMany({ where: { id, <col>: null | lt cutoff } })` and treat `count === 0` as "already done". This is the same pattern as `CalendarEvent.rsvpReminderSentAt` (D-1).
- Use one `ConsentResponse` per (formId, studentId) via `@@unique` (FR-38). Changes update the row in place, and each change is audited.
- Zod schemas in `src/lib/validators/<feature>.ts` enforce the FR-2 limits: span ≤ 30 days, details ≤ 1,000 chars, slotMinutes 5–60, parentNote ≤ 500 chars. Forms and handlers share these schemas (NFR-7).

**Consequences.** The extra columns go beyond "exactly as specified". `system-design.md` must list them as a deviation. If the PRD's own model already has an equivalent field, use that field and drop the extra column.

## ADR-4: Conference booking uses a conditional UPDATE plus a partial unique index

**Context.** NFR-1 requires that exactly one of two concurrent bookings succeeds. The loser gets 409 `That slot was just taken`. FR-31 allows one slot per teacher per child and no overlapping bookings across teachers. FR-30 requires the booking to be atomic.

**Decision.**
1. Book with `prisma.conferenceSlot.updateMany({ where: { id, bookedByParentId: null, blocked: false }, data: {...} })`. If `count === 0`, throw `AppError('CONFLICT', 'That slot was just taken')`. The client then refetches the slots.
2. Enforce "one per teacher per child" in the database: a raw-SQL partial unique index in the migration on `(eventId, teacherId, bookedForStudentId) WHERE bookedForStudentId IS NOT NULL`. A P2002 error maps to a 409 with the FR-31 message. This follows the attendance ADR-3 precedent of a partial unique index plus P2002 handling.
3. Check for overlaps with the parent's other bookings at that time inside the same `$transaction` before the conditional update. It returns `You already have a meeting with <teacher> at <time>`.

**Consequences.** There is no advisory lock and no SERIALIZABLE isolation. The FR-46 integration test fires two `Promise.all` bookings and asserts exactly one success. There is a small window in which one parent could double-book overlapping slots with two different teachers in two tabs at once. That is acceptable: it is the same parent, and no data is corrupted.

## ADR-5: Child selection uses an httpOnly cookie that is validated on every request

**Context.** FR-3 to FR-6 require a selection stored in cookie `sh_child`, validated against `ParentStudentLink` on every request, falling back to the first child, with `?studentId=` as an override.

**Decision.**
- Create one server helper, `getSelectedChild(user, searchParams?)`, in `src/server/parent/selected-child.ts`, wrapped in React `cache()`.
- It resolves the child in this order: `?studentId=` if linked, then the `sh_child` cookie if linked, then the first linked child ordered by firstName.
- It reads the cookie with `cookies()` from `next/headers`.
- Writes go through one small route handler that sets the cookie with `httpOnly`, `sameSite=lax`, `path=/` and a 1-year maxAge, then calls `router.refresh()`. That handler is the existing `withHandler` pattern and gets the existing NFR-8 same-origin check in middleware.

**Consequences.** The cookie value is untrusted input. Every consumer gets it through the helper and never reads the cookie directly (NFR-5). The switcher lives in `shell.tsx`'s top bar.

## ADR-6: The child overview is built from streaming server components

**Context.** NFR-2 requires first paint under 1 s and the full page under 2 s. FR-17 requires each card to load independently through Suspense. FR-8 makes this the parent landing page.

**Decision.**
- `/my-children/[studentId]` is a server component. It calls `assertCanViewStudent` once, then renders eight async card components (FR-9–FR-16). Each card is wrapped in `<Suspense fallback={<LoadingSkeleton/>}>` and runs its own service query.
- No client data-fetching library is used. `GET /api/students/:id/overview` (FR-43) reuses the same service functions for API consumers.
- Post-sign-in redirect for PARENT → `/my-children` (FR-8).

**Consequences.** Slow cards such as grades do not block fast ones. Each card query must stay index-backed. `AttendanceRecord(studentId, createdAt)` and `CalendarEvent(startAt, endAt)` indexes already exist.

## ADR-7: Absence coverage is one pure module that attendance-service uses in three places

**Context.**
- FR-23: approval converts ABSENT or missing records to EXCUSED.
- FR-24: future registers are pre-filled.
- FR-25: teachers may mark EXCUSED only when a note covers the student. Today `attendance-service.ts:219` restricts EXCUSED to ADMIN.
- FR-27: absence notifications are suppressed.
- FR-46 asks for unit tests of whole-day, partial-period and multi-day matching.

**Decision.**
- Add a pure function `coversRecord(note, { date, periodId })` in `src/server/absence-notes/absence-coverage.ts`, with no Prisma import so it can be unit-tested.
- `absence-notes-service.ts` loads the relevant notes, and attendance-service uses the function at three points:
  1. `getRegister`: pre-fill EXCUSED and show a badge.
  2. `saveRegister` line 219: replace the ADMIN-only check with "ADMIN, or an APPROVED note covers the record".
  3. Before `notifyStudentAndParents` (~line 299): drop `attendance.absent` for students covered by a PENDING or APPROVED note.
- Approval runs in one `$transaction`. It updates matching ABSENT records with an `updateMany`, and creates missing records for sessions that already exist. Dates with no session yet are handled by the FR-24 pre-fill.
- After commit, call `audit({ request })` so the IP is stored (NFR-3).

**Consequences.** The rate recalculation needs no code, because `attendanceRate()` reads the records. Daily-homeroom sessions have no `periodId`, so whole-day and partial matching must treat a null `periodId` as matching any note that covers that date.

## ADR-8: Dates and time zones reuse the existing helpers

**Context.** NFR-8 requires UTC storage and school-timezone rules. Several features depend on this:

- FR-18: absence dates from 14 days back to 60 days ahead
- FR-9: what counts as "today"
- FR-32: the booking window
- FR-40: the reminder 48 h before the due date

**Decision.** Use `schoolToday`, `addDays` and `daysBetween` from `attendance-rules.ts` and `date-fns-tz`, with the time zone from `SchoolSettings.timezone`. Generate slots (FR-29) with a pure `generateSlots(ranges, slotMinutes)` function in `conference-slots.ts`, which FR-46 also unit-tests.

**Consequences.** No new date helpers. Pure functions keep the unit tests free of timezone flakiness.

## ADR-9: Files, notifications and .ics extend the existing registries

**Context.** FR-18 and FR-41 add the `absence-note` file context. FR-19, FR-26, FR-28, FR-33, FR-36 and FR-44 add notification types. FR-33 needs an .ics attachment link.

**Decision.**
- **Files:** add an `absenceNoteResolver` to `src/server/files/contexts.ts`. It allows any linked parent (including the submitter), the homeroom teacher of the student's section, and ADMIN. Uploads reuse `FileUpload` and `files-service` validation, limited to PDF, JPG and PNG checked by `file-type` magic bytes.
- **Notifications:** add these keys to `NOTIFICATION_TYPES` in `types.ts`, then send through the existing `notify()` / `notifyStudentAndParents()`:

  | Key | Default email |
  | --- | --- |
  | `absence_note.submitted` | false |
  | `absence_note.reviewed` | true |
  | `conference.slots_requested` | – |
  | `conference.booked` | – |
  | `conference.cancelled` | – |
  | `consent.requested` | true |
  | `consent.reminder` | true |

- **.ics:** build it with the existing `buildCalendar` / `vevent` from `src/server/calendar/ical.ts`. Serve it from an authenticated GET per booked slot. The notification links to that URL.

**Consequences.** There is no attachment pipeline. Email links to the .ics URL, which matches FR-33's "attachment link" wording.

## ADR-10: Scheduled work goes in the existing cron route

**Context.** FR-40 needs a maintenance run. The only scheduler is `POST /api/internal/email/dispatch`, which is protected by `CRON_SECRET` and already runs assignment reminders and quiz maintenance in isolated try-blocks.

**Decision.** Add a `sendConsentDueReminders(now)` call to that route as another isolated try-block. It is idempotent through the `dueReminderSentAt` claim (ADR-3).

**Consequences.** No new cron, worker or script. Reminder precision is limited by the cron interval.

## ADR-11: Unavailable upstream data degrades gracefully

**Context.**
- FR-13: the PRD-12 `Announcement` model is missing. Only `src/server/announcements/audience.ts` exists.
- FR-5, FR-14, FR-35: SH-14's dev phase failed. The `CalendarEvent` and `EventAudience` models exist, but there are no calendar pages or API.
- Building either one would violate NFR-9, which says not to take on another PRD's scope.

**Decision.**
- **FR-13:** render an `EmptyState` ("No announcements") behind a single service function that returns `[]`. Do not add an Announcement model.
- **FR-14:** query `CalendarEvent` directly with the existing `audienceWhereForUser(user, { studentIds: [child] })` and return the next 5. Expand recurrence with `src/server/calendar/recurrence.ts`.
- **FR-35:** render booked slots inside the overview's Upcoming events and Action items cards as "My meetings" items. There is no calendar page to add them to.
- **FR-5:** the calendar `studentId` filter is not implemented, because there is no calendar page.
- **ConsentForm.eventId:** an optional FK to `CalendarEvent`, which exists.

**Consequences.** FR-13 and FR-35 are delivered partially. They become complete without schema work once PRD-12 and PRD-14 land. `system-design.md` should record this.

## ADR-12: Answers to intake's open questions

**Context.** Intake forwarded seven unresolved questions. No user is available to answer them.

**Decision.**

| # | Question | Decision |
| --- | --- | --- |
| 1 | Announcements | See ADR-11 |
| 2 | Calendar | See ADR-11 |
| 3 | Shared component location | Reuse components where they are, under `src/components/<Name>/`. Do not move them (NFR-6). |
| 4 | Student detail route | `/students/[id]` is the target for "View all" links, including `/students/[id]/attendance`. |
| 5 | Pages that adopt the `sh_child` default (FR-5) | The existing `/assignments`, `/grades` and `/api/me/timetable` consumers, plus the new `/my-children/*`, `/conferences/[id]` and `/consent-forms` pages. |
| 6 | Reminder notification key | `consent.reminder` for both the 48 h reminder and the manual reminder (FR-44). |
| 7 | Blocked slots (FR-29) | `ConferenceSlot.blocked` column (ADR-3). |

**Consequences.** All seven are recorded as assumptions. None blocks the work.

## ADR-13: Access control and tests follow the existing patterns

**Context.** NFR-5 requires server-side access control on every handler. NFR-7 sets the quality gates. FR-46 lists the required tests.

**Decision.**
- **Access control:**
  - Every handler uses `withHandler` and `requireRole`.
  - Parent and child scoping uses `assertCanViewStudent` / `getAccessibleStudentIds`.
  - Homeroom scoping checks section membership against `Section` (teacher's own section).
  - Consent tracking is limited to the form's creator and ADMIN.
  - Teachers may target only courses they manage (`canTargetAudience`).
- **Tests:**
  - Unit tests in Vitest cover the pure modules: `absence-coverage`, `conference-slots`, and signature matching (`trim().toLowerCase()` equality).
  - Integration tests in Vitest against the database cover approval/pre-fill, concurrent booking and notification suppression.
  - Three Playwright specs cover the FR-46 flows.
- Use `logger`, never `console.log`.

**Consequences.** No new test tooling. Seed data (FR-45) extends `prisma/seed.ts` in place.
