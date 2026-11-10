# Dev Log — SH-15 (PRD-15 Parent Portal)

> Before this run, this file held SH-14's log and `task-completion-markers.json` held SH-14's markers. Both are replaced for SH-15, following the precedent from earlier tickets. `dev-rerun-count.json` was left untouched because the engine owns it.

## Iteration 1 (2026-11-10)

All 27 tasks were implemented in one iteration, in dependency order. Every file in `file-ownership-matrix.json` exists at its exact path. No dependencies were added (ADR-1).

### Verification
| Gate | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| Unit tests (FR-46) | 11/11 new tests pass: coverage, slots, signature |
| SH-15 integration tests (local DB, `TEST_DATABASE_URL`) | 7/7 pass: approval, pre-fill, suppression, concurrent booking, one-per-teacher |
| `npm run build` | succeeds |
| SH-15 Playwright specs | 4/4 pass, run with `PORT=3100 APP_URL=http://localhost:3100` because another process holds :3000 |
| `npm run db:seed` | runs, and runs again idempotently |

The migration `20261114000000_prd15_parent_portal` was generated with `prisma migrate diff`; it drops nothing that already exists. The raw-SQL partial unique index is appended to it. The migration is applied (`migrate deploy`) and the Prisma client is regenerated. The mui-mcp lookup (NFR-4) worked: `useMuiDocs` returned docs for @mui/material@9.5.0.

### Failures that already existed (not caused by SH-15)
- **`attendance-qa: FR-22 A → P → A`** fails on the pre-SH-15 baseline. I checked this with `git stash`. It is out of SH-15 scope.
- **Teacher re-saving an EXCUSED row an admin set** also failed on the baseline. It is now fixed, as part of the FR-25 EXCUSED rule change.
- **The full parallel `vitest run` against the shared DB** is flaky in existing suites: attendance-qa, email-dispatch and assignments-qa. The same failures happen with the SH-15 tests excluded.
- **Unrelated unit tests** in `useToast`, `auth-forms` and `lockout` (module resolution) fail independently of this ticket.
- **`dashboard.spec.ts`** fails on CSP/hydration timing, the known QA blocker 1. With a short wait, admin `/dashboard` renders the heading and has 0 serious/critical axe violations.

### Implementation notes and deviations
- **`AbsenceReason` values.** The PRD's exact values were not available, so the enum is `ILLNESS, MEDICAL_APPOINTMENT, FAMILY, RELIGIOUS, OTHER`.
- **Eligible grade levels.** `ConferenceEvent` stores them as `gradeLevelIds String[]`. `ConferenceSlot.bookedAt` is an extra audit column.
- **Absence-note date window (−14/+60).** `absenceNoteSchemaFor(today)` is a factory used by the form. The service re-checks the window with `schoolToday()`.
- **Lazy import of `files-service`.** `absence-notes-service` imports it lazily, so importers of attendance-service (tests and scripts) don't load env/storage. `contexts.ts` imports `homeroomTeacherOf` lazily to avoid a cycle.
- **FR-25 EXCUSED rule.** A teacher may mark EXCUSED when an APPROVED note covers the record. A teacher may also re-save a row that is already EXCUSED unchanged. Anything else returns 403 `NO_APPROVED_NOTE`.
- **Nav "Absence notes" for parents.** It points at `/attendance/absence-notes`, which redirects a parent to the selected child's list. A teacher sees the entry only with a current-year homeroom section.
- **Simple lists use server-rendered MUI `Table`.** These are the parent absence list, `/conferences` and `/consent-forms`. `DataTable` needs client-side column functions, and the matrix gives these routes only a `page.tsx`. The review queue, admin conferences and consent tracking use `DataTable`.
- **Pagination.** Parent consent lists and tracking rows are filtered and paginated in memory, marked with a `ponytail:` comment. A family sees few forms, and tracking is bounded by the audience size.
- **Booking notifications.** `conference.booked` links to `/conferences/:id`, and its body carries the `/api/conference-slots/:id/ics` link. A notification link pointing at a download would be odd.
- **Teachers card "Message" link.** It uses `/messages?to=<id>`. `/messages` has no recipient prefill yet, so this is a ponytail note and a follow-up.
- **Remind throttle.** The 429 response carries `Retry-After`, set in the remind route.
- **Seed (FR-45).** Conference event, slots, the Science Museum calendar event and the consent form are always seeded. Absence notes, bookings and consent responses need Grade 7 students with linked parents. Those come from other seeds and are absent from the current local DB, so these parts are skipped with a log, matching the existing seed convention of never creating another PRD's data.
- **E2E specs** build their own fixtures, like `attendance.spec.ts`, so they don't depend on seed data.
- **Partial by design (ADR-11).**
  - FR-13: the Announcements card is an EmptyState.
  - FR-35: "My meetings" appear only in the overview cards.
  - FR-5: there is no calendar `studentId` filter.

### Checklist
- TASK-1: Prisma models + migration 20261114000000_prd15_parent_portal — ✓ complete
- TASK-2: Zod validators (absence-notes, conferences, consent-forms) — ✓ complete
- TASK-3: pure helpers + FR-46 unit tests — ✓ complete
- TASK-4: notification types, absence-note file context, upload restriction — ✓ complete
- TASK-5: getSelectedChild + POST /api/me/selected-child — ✓ complete
- TASK-6: ChildSwitcher, shell, layout, navigation — ✓ complete
- TASK-7: absence-notes-service — ✓ complete
- TASK-8: absence notes API — ✓ complete
- TASK-9: attendance integration (pre-fill, EXCUSED rule, absent suppression, badge) — ✓ complete
- TASK-10: parent absence form + list — ✓ complete
- TASK-11: absence-note review queue — ✓ complete
- TASK-12: conferences-service — ✓ complete
- TASK-13: conferences API — ✓ complete
- TASK-14: admin conferences UI — ✓ complete
- TASK-15: conference list, availability, printable day view — ✓ complete
- TASK-16: parent booking page — ✓ complete
- TASK-17: consent-forms-service + cron wiring — ✓ complete
- TASK-18: consent forms API — ✓ complete
- TASK-19: consent list + create UI — ✓ complete
- TASK-20: consent detail/respond + tracking UI — ✓ complete
- TASK-21: overview-service — ✓ complete
- TASK-22: overview API — ✓ complete
- TASK-23: overview UI (/my-children, streaming cards, dashboard redirect) — ✓ complete
- TASK-24: sh_child default on /assignments, /grades, /api/me/timetable — ✓ complete
- TASK-25: seed (parent portal) — ✓ complete
- TASK-26: integration tests (approval, pre-fill, suppression, concurrent booking) — ✓ complete
- TASK-27: Playwright specs (absence → approve → EXCUSED; book slot; sign consent) — ✓ complete

### Blockers
None.
