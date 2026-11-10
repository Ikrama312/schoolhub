# File Structure — SH-15 (PRD-15 Parent Portal)

Phase: dev-planning · Ticket: SH-15 · Generated 2026-11-10T14:00:00Z

Planned tree of every file SH-15 creates or modifies. Each leaf is tagged `[OPERATION TASK-N]`; the exact list is `file-ownership-matrix.json`. Unlisted existing files are untouched (NFR-6: no moves, renames or re-scaffolding; ADR-1: `package.json` unchanged).

```
schoolhub/
├── prisma/
│   ├── migrations/
│   │   └── 20261114000000_prd15_parent_portal/
│   │       └── migration.sql  [CREATE TASK-1]
│   ├── schema.prisma  [MODIFY TASK-1]
│   └── seed.ts  [MODIFY TASK-25]
├── src/
│   ├── app/
│   │   ├── (app)/
│   │   │   ├── admin/
│   │   │   │   └── conferences/
│   │   │   │       ├── ConferenceEventsClient.tsx  [CREATE TASK-14]
│   │   │   │       └── page.tsx  [CREATE TASK-14]
│   │   │   ├── assignments/
│   │   │   │   ├── AssignmentList.tsx  [MODIFY TASK-24]
│   │   │   │   └── page.tsx  [MODIFY TASK-24]
│   │   │   ├── attendance/
│   │   │   │   ├── absence-notes/
│   │   │   │   │   ├── AbsenceNotesReviewClient.tsx  [CREATE TASK-11]
│   │   │   │   │   └── page.tsx  [CREATE TASK-11]
│   │   │   │   └── take/
│   │   │   │       └── RegisterForm.tsx  [MODIFY TASK-9]
│   │   │   ├── conferences/
│   │   │   │   ├── [id]/
│   │   │   │   │   ├── BookingClient.tsx  [CREATE TASK-16]
│   │   │   │   │   ├── availability/
│   │   │   │   │   │   ├── AvailabilityClient.tsx  [CREATE TASK-15]
│   │   │   │   │   │   └── page.tsx  [CREATE TASK-15]
│   │   │   │   │   ├── day/
│   │   │   │   │   │   └── page.tsx  [CREATE TASK-15]
│   │   │   │   │   └── page.tsx  [CREATE TASK-16]
│   │   │   │   └── page.tsx  [CREATE TASK-15]
│   │   │   ├── consent-forms/
│   │   │   │   ├── [id]/
│   │   │   │   │   ├── ConsentResponseForm.tsx  [CREATE TASK-20]
│   │   │   │   │   ├── page.tsx  [CREATE TASK-20]
│   │   │   │   │   └── tracking/
│   │   │   │   │       ├── ConsentTrackingClient.tsx  [CREATE TASK-20]
│   │   │   │   │       └── page.tsx  [CREATE TASK-20]
│   │   │   │   ├── new/
│   │   │   │   │   ├── ConsentFormForm.tsx  [CREATE TASK-19]
│   │   │   │   │   └── page.tsx  [CREATE TASK-19]
│   │   │   │   └── page.tsx  [CREATE TASK-19]
│   │   │   ├── dashboard/
│   │   │   │   └── page.tsx  [MODIFY TASK-23]
│   │   │   ├── grades/
│   │   │   │   ├── GradesClient.tsx  [MODIFY TASK-24]
│   │   │   │   └── page.tsx  [MODIFY TASK-24]
│   │   │   ├── layout.tsx  [MODIFY TASK-6]
│   │   │   ├── my-children/
│   │   │   │   ├── [studentId]/
│   │   │   │   │   ├── OverviewCards.tsx  [CREATE TASK-23]
│   │   │   │   │   ├── absence/
│   │   │   │   │   │   ├── new/
│   │   │   │   │   │   │   ├── AbsenceNoteForm.tsx  [CREATE TASK-10]
│   │   │   │   │   │   │   └── page.tsx  [CREATE TASK-10]
│   │   │   │   │   │   └── page.tsx  [CREATE TASK-10]
│   │   │   │   │   └── page.tsx  [CREATE TASK-23]
│   │   │   │   └── page.tsx  [CREATE TASK-23]
│   │   │   └── shell.tsx  [MODIFY TASK-6]
│   │   └── api/
│   │       ├── absence-notes/
│   │       │   ├── [id]/
│   │       │   │   ├── review/
│   │       │   │   │   └── route.ts  [CREATE TASK-8]
│   │       │   │   └── route.ts  [CREATE TASK-8]
│   │       │   └── route.ts  [CREATE TASK-8]
│   │       ├── conference-slots/
│   │       │   └── [id]/
│   │       │       ├── book/
│   │       │       │   └── route.ts  [CREATE TASK-13]
│   │       │       ├── cancel/
│   │       │       │   └── route.ts  [CREATE TASK-13]
│   │       │       ├── ics/
│   │       │       │   └── route.ts  [CREATE TASK-13]
│   │       │       └── route.ts  [CREATE TASK-13]
│   │       ├── conferences/
│   │       │   ├── [id]/
│   │       │   │   ├── availability/
│   │       │   │   │   └── route.ts  [CREATE TASK-13]
│   │       │   │   ├── route.ts  [CREATE TASK-13]
│   │       │   │   └── slots/
│   │       │   │       └── route.ts  [CREATE TASK-13]
│   │       │   └── route.ts  [CREATE TASK-13]
│   │       ├── consent-forms/
│   │       │   ├── [id]/
│   │       │   │   ├── remind/
│   │       │   │   │   └── route.ts  [CREATE TASK-18]
│   │       │   │   ├── responses/
│   │       │   │   │   └── route.ts  [CREATE TASK-18]
│   │       │   │   ├── route.ts  [CREATE TASK-18]
│   │       │   │   └── tracking/
│   │       │   │       └── route.ts  [CREATE TASK-18]
│   │       │   └── route.ts  [CREATE TASK-18]
│   │       ├── internal/
│   │       │   └── email/
│   │       │       └── dispatch/
│   │       │           └── route.ts  [MODIFY TASK-17]
│   │       ├── me/
│   │       │   ├── children/
│   │       │   │   └── summary/
│   │       │   │       └── route.ts  [CREATE TASK-22]
│   │       │   ├── selected-child/
│   │       │   │   └── route.ts  [CREATE TASK-5]
│   │       │   └── timetable/
│   │       │       └── route.ts  [MODIFY TASK-24]
│   │       └── students/
│   │           └── [id]/
│   │               └── overview/
│   │                   └── route.ts  [CREATE TASK-22]
│   ├── components/
│   │   └── ChildSwitcher/
│   │       └── ChildSwitcher.tsx  [CREATE TASK-6]
│   ├── config/
│   │   └── navigation.ts  [MODIFY TASK-6]
│   ├── lib/
│   │   └── validators/
│   │       ├── absence-notes.ts  [CREATE TASK-2]
│   │       ├── attendance.ts  [MODIFY TASK-9]
│   │       ├── conferences.ts  [CREATE TASK-2]
│   │       └── consent-forms.ts  [CREATE TASK-2]
│   └── server/
│       ├── absence-notes/
│       │   ├── absence-coverage.ts  [CREATE TASK-3]
│       │   └── absence-notes-service.ts  [CREATE TASK-7]
│       ├── attendance/
│       │   └── attendance-service.ts  [MODIFY TASK-9]
│       ├── conferences/
│       │   ├── conference-slots.ts  [CREATE TASK-3]
│       │   └── conferences-service.ts  [CREATE TASK-12]
│       ├── consent-forms/
│       │   ├── consent-forms-service.ts  [CREATE TASK-17]
│       │   └── signature.ts  [CREATE TASK-3]
│       ├── files/
│       │   ├── contexts.ts  [MODIFY TASK-4]
│       │   └── validate.ts  [MODIFY TASK-4]
│       ├── notifications/
│       │   └── types.ts  [MODIFY TASK-4]
│       └── parent/
│           ├── overview-service.ts  [CREATE TASK-21]
│           └── selected-child.ts  [CREATE TASK-5]
└── tests/
    ├── e2e/
    │   ├── absence-notes.spec.ts  [CREATE TASK-27]
    │   ├── conferences.spec.ts  [CREATE TASK-27]
    │   └── consent-forms.spec.ts  [CREATE TASK-27]
    ├── integration/
    │   ├── absence-notes/
    │   │   └── absence-approval.test.ts  [CREATE TASK-26]
    │   └── conferences/
    │       └── concurrent-booking.test.ts  [CREATE TASK-26]
    └── unit/
        ├── absence-notes/
        │   └── absence-coverage.test.ts  [CREATE TASK-3]
        ├── conferences/
        │   └── conference-slots.test.ts  [CREATE TASK-3]
        └── consent-forms/
            └── signature.test.ts  [CREATE TASK-3]
```

## Notes

- 63 files created, 18 modified, 0 deleted.
- New server modules follow `src/server/<feature>/<feature>-service.ts`; pure helpers (`absence-coverage.ts`, `conference-slots.ts`, `signature.ts`) have no Prisma import so the FR-46 unit tests stay DB-free.
- Route handlers live under `src/app/api/**/route.ts` (base path `/api`, not `/api/v1`).
- `src/components/ChildSwitcher/` follows the existing `src/components/<Name>/` convention (ADR-12 #3).
- `POST /api/files` needs no route change: the `absence-note` context is added through `files/contexts.ts` (access) and `files/validate.ts` (PDF/JPG/PNG only).
- `/api/attendance/register` GET/PUT need no route change: the new EXCUSED pre-fill, rule and notification suppression all live in `attendance-service.ts`.
- Partial by design (ADR-11): FR-13 Announcements card is an EmptyState; FR-35 'My meetings' appear only in overview cards; no calendar `studentId` filter (FR-5).
