# UI Verification Report: SH-15 (PRD-15 Parent Portal: Child Switcher, Absence Notes & Conference Booking)

- **Ticket:** SH-15
- **Status:** complete
- **Result:** 38 findings: **31 PASS, 5 FAIL, 2 BLOCKED**

> This replaces the SH-14 report. The SH-13 and SH-14 evidence folders (`screenshots/`, `screenshots-sh14/`, `uiv-raw-sh14.log`) are left as they were. SH-15 evidence is in `screenshots-sh15/` and `uiv-raw-sh15.log`. `ui-verification-report.json` has the same findings in machine-readable form.

## Headline

Every SH-15 screen renders with MUI and the app theme, and the three PRD flows work in a real browser:

- absence note → approve → register shows EXCUSED with an "Absence note" badge
- parent books a conference slot with a note
- parent signs a consent form, including the signature-mismatch error

**One defect needs a fix before release: dates and times are shown in the wrong timezone (NFR-8).** Many SH-15 components format with `toLocaleString`/`toLocaleTimeString`, which use the browser's or server's timezone instead of `SchoolSettings.timezone`. Two places show it clearly:

- **Teacher availability (FR-29).** The saved range reads 03:00 PM–05:00 PM, but the slots are listed as **01:00–03:00** (`AvailabilityClient.tsx:25`).
- **Consent due date.** The seeded form is due 19 Nov 23:59 school time. It displays as **"Due 11/20/2026, 9:59:00 AM"**, which is the wrong day.

The fix is mechanical: switch to the existing `formatInSchoolTz` from `src/lib/dates`, which `day/page.tsx` and the services already use. Affected lines:

- `conferences/[id]/availability/AvailabilityClient.tsx:25`
- `conferences/[id]/page.tsx:26`
- `consent-forms/page.tsx:18`
- `consent-forms/[id]/page.tsx:23,36`
- `consent-forms/[id]/ConsentResponseForm.tsx:60`
- `consent-forms/[id]/tracking/page.tsx:18`
- `consent-forms/[id]/tracking/ConsentTrackingClient.tsx:104,127`
- `attendance/absence-notes/AbsenceNotesReviewClient.tsx:149,194`
- `my-children/[studentId]/OverviewCards.tsx:35-36`

The other three FAILs are the partial items ADR-11 already accepted: FR-5 (the calendar filter part), FR-13 (Announcements) and FR-35 (My meetings in the calendar).

## How it was rendered

- **Server.** I used `next dev` on :3201 with Chromium through Playwright, at 1280 px and 390 px.
  - The production build (`next build` and `next start` on :3200) serves pages, but **nothing hydrates**. `next.config.js` sends `script-src 'self'` with no nonce, so Next's inline bootstrap scripts are blocked. This config dates from the project-startup commit, not SH-15, and is the same issue as the known QA blocker 1.
  - I didn't use the shared servers: :3000 returns 500 and :3001 hangs.
- **Signed-in sweep.** As parent, teacher and admin, I signed in through the credentials callback and visited every SH-15 route, recording status, URL, headings, console errors and a full-page screenshot.
  - For the multi-child cases, a second `ParentStudentLink` was **added temporarily and deleted afterwards**.
- **E2E flows.** The 3 SH-15 e2e specs ran against :3201 with screenshots on. All 4 tests passed, and the end-of-flow screenshots are in `screenshots-sh15/e2e/`. These specs build their own fixtures, because the local DB has no student profiles, enrollments, bell periods or Grade 7 parents.
- **Design reference.** There is no `figma-readiness.json`, so the PRD text was the only reference.

## Findings

| Req | Surface | Verdict | Notes |
|---|---|---|---|
| FR-3 | Child switcher (2+ children) | PASS | A Select with avatar and first name. Switching to Sara moved to her overview and set `sh_child`. |
| FR-4 | Invalid `sh_child` fallback | PASS | `sh_child=bogus-id` falls back to the first child with no error. |
| FR-5 | Default child on `/assignments` and `/grades`, plus calendar filter | FAIL | `/assignments` and `/grades` follow the selected child, and `/grades` showed Sara after the switch. There is no calendar filter, because PRD-14 has no UI (ADR-11 partial). |
| FR-6 | One-child top bar | PASS | Avatar and name only, with no dropdown. |
| FR-7 | `/my-children` | PASS | With one child it redirects. With two it shows cards with attendance, missing work and average, at 1280 px and 390 px. |
| FR-8 | Parent landing | PASS | `/dashboard` goes to the child overview. |
| FR-9 | Today card | PASS | Empty state only. The child has no timetable, so the holiday and schedule variants were not seen. |
| FR-10 | Attendance card | PASS | Shows the rate, absences, lates, "Report an absence" and View all. The last-5 list was not seen because there is no data. |
| FR-11 | Assignments card | PASS | Empty state only. |
| FR-12 | Recent grades card | PASS | Empty state only. |
| FR-13 | Announcements card | FAIL | It is always an EmptyState with no View all link (ADR-11 partial). |
| FR-14 | Upcoming events card | PASS | Empty state with a Conferences link. |
| FR-15 | Teachers card | PASS | Empty state. The Message button was not seen because the child has no enrollments. |
| FR-16 | Action items card | PASS | Empty state with a Consent forms link. |
| FR-17 | Overview layout and links | PASS | 8 cards: 2 columns at 1280 px and 1 column at 390 px, with no clipping. 7 of the 8 have a footer link. |
| FR-18 | Absence form fields | PASS | Date pickers default to school-today. Also present: Whole day / Specific periods, Reason, Details 0/1000, and the attach button. The e2e submitted through this form. |
| FR-18 | Absence form period checkboxes | BLOCKED | The DB has 0 bell periods, so "Specific periods" shows a bare "Periods" label. Minor: there's no hint when no periods exist. |
| FR-20 | Parent absence-note list | PASS | Empty state, then a row with an orange **Pending** chip and a success toast after the e2e submit. The nav entry redirects here. |
| FR-21 | Review queue | PASS | The admin DataTable has Status, From and To filters and search. The homeroom Review → Approve flow passed in e2e. A teacher with no homeroom gets `/forbidden`, which is correct. Minor: the empty-grid overlay is clipped, and the date filters are native inputs. |
| FR-22 | Approve / Reject | PASS | Approve was shown by the e2e. Reject was not exercised in the UI; QA unit tests cover it. |
| FR-24 | Register badge and EXCUSED pre-fill | PASS | The "Absence note" chip shows, E is selected, and the summary reads Excused 1. |
| FR-25 | Teacher EXCUSED toggle | PASS | E is enabled and pressed when an approved note covers the student. |
| FR-28 | `/admin/conferences` and New event dialog | PASS | The row shows Grade 7, an Open chip, and Edit and Bookings. The dialog has every PRD field. |
| FR-29 | Teacher availability | **FAIL** | The layout and controls are fine. **The slot times show in the browser timezone**: range 3–5 PM, slots 01:00–03:00. |
| FR-30 | Parent booking page | PASS | Time buttons, the confirm dialog with a note, and "Booked for Bea: 15:00–15:10". The seeded event returns 404 for the local parent (child not in Grade 7), which is correct. Minor: a faint grey shape remains from the dialog's exit transition. |
| FR-31 | Overlap error in booking UI | BLOCKED | No fixture can trigger it in the UI. The exact message text is asserted by QA integration tests. |
| FR-32 | Cancel booking | PASS | The "Cancel booking" button is shown but was not clicked. |
| FR-33 | Add to calendar (.ics) | PASS | The link is shown next to the booking. |
| FR-34 | Teacher day view | PASS | Heading, a Print / Save as PDF button, and "No bookings yet." The populated list was not seen. |
| FR-35 | Calendar "My meetings" | FAIL | Not built, because there is no calendar UI (ADR-11 partial). |
| FR-36 | `/consent-forms/new` | PASS | Markdown Write/Preview, Respond by, linked event, and audience: Course for a teacher, Grade level for an admin. |
| FR-37 | Consent list, detail and signing | PASS | List empty state. In e2e the markdown renders, a mismatched signature shows an error toast, and a matching one shows "Consent granted by Polly Parent". |
| FR-38 | Change response | PASS | The button appears after responding. |
| FR-39 | Consent tracking | PASS | Count chips, Status filter, Export CSV, Remind (disabled when there are 0 rows), and the expected columns. Minor: the empty overlay is clipped. |
| FR-42 | Navigation per role | PASS | Parent, homeroom teacher, plain teacher and admin each see the PRD's entries. |
| NFR-2 | Overview paint | PASS | Informal check only: every card painted on a warm dev server. This is not a production timing. |
| NFR-4 | MUI-only look | PASS | Consistent MUI theme throughout. The only exception is the native date inputs on the review-queue filters. |
| NFR-8 | School-timezone display | **FAIL** | About 10 components use browser- or server-local time. The consent due date shows the wrong day. See the headline for the file list. |

## Minor visual notes (not blocking)

- **Empty DataGrid overlay is clipped.** On the review queue and consent tracking, an empty grid shows only the top of the inbox icon, and the "No results" text is hidden. This looks like the shared `DataTable`.
- **Some avatars have no background.** `UserAvatar` sometimes renders initials with no background colour (`MM`, `PP` and `TT`).
- **Blank Periods group.** With no bell periods, "Specific periods" shows an empty Periods group with no explanation.
- **Seed creator (QA note).** The seeded "Science Museum Trip" is created by a teacher with a Grade-level audience, which the UI wouldn't allow that teacher to create.

## Recommended next step

Re-run Dev for the NFR-8 timezone fix. It is a small, mechanical change across the files listed above. Then re-check `/conferences/[id]/availability` and `/consent-forms` here.
