# UI Verification Report — SH-11 (PRD-11 Gradebook, Grading Scales & Report Cards)

- **Ticket:** SH-11
- **Timestamp:** 2026-11-09T15:23:52Z
- **Status:** complete
- **Result:** 34 findings across 31 UI-facing requirements: **32 PASS, 2 FAIL, 0 BLOCKED**

> This file replaces the stale SH-10 report. `ui-verification-report.json` has the same findings in machine-readable form, and `uiv-raw.json` has the raw probe output.

## Headline

Every SH-11 surface rendered and behaved as specified. That covers the gradebook grid, settings, dialogs, column menu, CSV export, student/parent grades, the admin and homeroom report-card flows, the print views and access control. The FR-15 golden case renders **78.0% C+**.

Two visual defects need fixing:

| ID | Severity | Surface | Problem | Suggested fix |
|---|---|---|---|---|
| **UIV-1** | moderate | Report card on-screen view at 375 px (`/report-cards/[id]/print`) | The Courses table is wider than the card. The Grade and Comment columns spill past the card border and the page scrolls horizontally. Students and parents open this page from their phones. A4 printing is unaffected. | Wrap the table in `TableContainer` (`overflowX: auto`) or stack the columns below `sm` in `ReportCardDocument.tsx` |
| **UIV-2** | minor | Gradebook settings → Grading scale | The Select renders **blank** when the course uses the school default (`scaleId ''`). The "School default (Standard A–F)" option exists but isn't displayed, because MUI Select hides an empty value without `displayEmpty`. | `slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}` in `GradebookSettingsClient.tsx` |

## Minor observations

- **UIV-3 (a11y):** the invalid "Weights total 90 / 100" chip is pale red on pale red and nearly unreadable. axe reports color-contrast (serious) ×2. The red helper text next to Save still explains the problem.
- **UIV-4 (a11y/layout):** at 375 px, the expanded `/grades` item table puts % and Comment off-screen in a scroll region that can't take keyboard focus. axe reports scrollable-region-focusable (serious).
- **UIV-5:** axe reports empty-table-header (minor) on the DataGrids. This is the same pattern seen in SH-10.
- **UIV-6 (not exercised in the UI; QA tests cover them):**
  - arrow-key cell navigation
  - a quiz-synced cell opening its attempt
  - virtualisation at 60×120 and the NFR-2 timings
  - DRAFT-only regeneration (FR-31)
  - the roster's grade-level filter
  - the `grade.posted` notification
  - the green (≥80) card colour
- **ENV-1:** the dev DB's current year (2026-2027) has **no terms**, so the feature is unusable in dev until an admin adds them. In that state the gradebook shows a clear info Alert. Verification used a temporary tagged term.
- **ENV-2 (for QA/dev, not UI):** 9 orphaned `TermGradeOverride` rows predate this phase. Their courses were deleted, but the rows remain because the model has no FK to Course and `tests/e2e/report-cards.spec.ts` cleanup doesn't delete overrides. They were left in place.

## Method

- Production build (`npm run build`, exit 0) served by `next start -p 3300` against Postgres :5433. The :3000/:3001 servers were left alone.
- Throwaway Playwright driver `/tmp/uiv-sh11/driver.cjs`, outside the repo, with tagged fixtures `uiv-sh11`:
  - users: an admin, a homeroom teacher, 2 section students, an outsider student, and a parent linked to both students
  - courses: UIV Maths (Homework 40 / Exams 60, with manual items, a hidden item and a late synced assignment) and UIV English (no categories)
  - a temporary term
- Viewports: teacher/admin at 1280×800, student/parent at 375×667, plus cross-checks at the other width. Print media was emulated and PDFs were rendered to check A4 size and page count.
- DB state was checked after each mutation.
- The nav probe `/tmp/uiv-sh11/nav.cjs` confirmed sidebar entries per role.
- All fixtures were removed (verified: 0 tagged users, courses, terms or sections remain).
- The only console errors were the expected 404s from the access-denial checks.
- `figma-readiness.json` does not exist, so the comparison is against `requirements.json` only.

## Findings

| Req | Surface | Verdict | Notes |
|---|---|---|---|
| FR-2 | Assignment and quiz editor category select | PASS | None / Homework / Exams. The saved value displays. |
| FR-9 | Synced vs manual cells | PASS | Synced cells aren't editable. The API rejects a synced score edit (400 "Only the comment can be changed here…"). |
| FR-14 | Letter-only override | PASS | `78.0% B *`. Percent kept, letter B, comment saved. |
| FR-15 | Golden case | PASS | 18/20 + 9/10 (HW 40%) and 70/100 (Exams 60%) give 90.0 / 70.0 → **78.0% C+**. The student view shows the same percent. |
| FR-16 | `/admin/grading-scales` | PASS | Default chip, 12-band editor. Inline errors "Letters must be unique" and "Must be lower than the band above". Create and delete work. Deleting the default is disabled. Admin nav entries are present. |
| FR-17 | Gradebook settings | **FAIL** | The live weight sum works, Save is disabled at 90, and the API returns 400. **UIV-2:** the scale select is blank. UIV-3: low-contrast chip. |
| FR-18 | Gradebook grid | PASS | Category column groups and Averages group. Headers show icon, title, due date and /max. Hidden items are dimmed with an eye-off icon. Bold Term column, sorted by last name, no pinned columns. The grid scrolls horizontally at 375 and the page does not. |
| FR-19 | Cell rendering | PASS | Score, `EX`, red bold `M`, `—`, and a clock icon on the late synced score. |
| FR-20 | Keyboard editing | PASS | Digits+Enter, E, M and Delete each save with a PUT. 6 `grade.update` audit rows. Out-of-range input gives a red outline and a toast, and nothing is saved. |
| FR-21 | Synced cell click | PASS | Opens `/assignments/<id>/grade?studentId=…`. |
| FR-22 | Add manual item | PASS | Title, Category, Max points, Date, Term. Required validation works. The new column appears right away. |
| FR-23 | Override dialog | PASS | Percent, Letter, Teacher comment. Saving shows a toast and `*` in the Term cell. |
| FR-24 | Column menu | PASS | Hide/Show (eye-off icon, `isVisible` toggled), Set ungraded to missing (→ M, term 32.0% F, correct), Item statistics (avg/median/high/low). |
| FR-25 | Export CSV | PASS | `text/csv` attachment that matches the grid, including EX, M and the override letter. |
| FR-26 | Student Grades tab | PASS | Course cards with red (50.0 F) and amber (78.0 B) chips. The expanded view shows category subtotals and the item table. The hidden item is absent. (UIV-4) |
| FR-27 | `/grades` + nav | PASS | Parent child selector switches between children. The "Grades" nav entry is present for STUDENT and PARENT at 1280 and 375. |
| FR-28 | Course Grades tab (student) | PASS | Only that course's card. No Gradebook or Attendance tabs. |
| FR-29 | Admin report-cards roster | PASS | Term, grade-level and section filters. Status chips and warning text. Count buttons. axe clean. |
| FR-30 | Generate drafts / snapshot | PASS | All required fields render, including attendance and the scale legend. No logo because `logoUrl` is null. |
| FR-31 | Regeneration | PASS | Confirm copy and published snapshots checked. Draft refresh after grade edits wasn't re-driven in the UI. |
| FR-32 | Review page | PASS | Homeroom teacher can edit only the homeroom comment. Admin can edit both. Saves persist. The teacher has no publish controls. |
| FR-33 | `/report-cards` homeroom list | PASS | TEACHER nav entry. Lists section drafts with warnings. |
| FR-34 | Publish / Unpublish | PASS | Single and bulk publish. Unpublish requires a reason and writes an audit row. Notifications go to students and the parent. |
| FR-35 | Print views | PASS | Letterhead, tables, signature lines. Chrome and the print button are hidden under print media. A4 portrait, 1 page per card. Print all: 2 pages with a page break. |
| FR-35 | On-screen card at 375 | **FAIL** | **UIV-1:** the table overflows the card and the page. |
| FR-36 | Student Report cards tab | PASS | Draft hidden ("No report cards yet"). Once published, listed with a link to the print view. |
| FR-37 | Access control | PASS | Own draft → 404. Outsider → 404 on the page and the API. Parent and teacher allowed. |
| FR-42 | Student grades API | PASS | Hidden item absent from the API and UI. The outsider gets 404. |
| NFR-5 | Privacy | PASS | Same evidence as FR-37 and FR-42. |
| NFR-7 | MUI-only UI | PASS | All surfaces use MUI components. No raw unstyled HTML seen. |
| NFR-8 | DataGrid MIT tier | PASS | Column groups and editing only. No pinned columns, no Pro watermark. |
| NFR-11 | Print layout | PASS | A4 portrait PDFs: `screenshots/parent-report-card.pdf` and `screenshots/print-all.pdf`. |
| FR-26 | `/grades` table at 375 | PASS | Minor observation UIV-4 (scroll region not keyboard-focusable). |
| FR-18 | Gradebook with no terms | PASS | ENV-1: info Alert instead of a crash. |

## Evidence

The screenshots are in `screenshots/`:

- teacher: `teacher-gradebook-*`, `teacher-assignment-editor-category-1280`, `teacher-quiz-editor-category-1280`, `teacher-report-card*`
- admin: `admin-grading-scale*`, `admin-report-cards-*`, `admin-report-card-*`
- student: `student-grades*`, `student-course-grades-375`, `student-tab-*`, `student-report-card-print-375`
- parent: `parent-grades*`, `parent-report-card-print-{375,1280}`
- other: `outsider-report-card-375`, `nav-{student,parent}-{1280,375}`
- PDFs: `parent-report-card.pdf`, `print-all.pdf`
