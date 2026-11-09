# UI Verification Report — SH-10 (PRD-10 Quizzes & Online Exams)

- **Status:** complete
- **Timestamp:** 2026-11-09T08:24:01Z
- **Findings:** 25 across 23 UI-facing requirements: **24 PASS / 1 FAIL / 0 BLOCKED**
- **Design reference:** none (`figma-readiness.json` does not exist). Surfaces were checked against `requirements.json` only.

> This file replaces the stale SH-9 report. All screenshots in `screenshots/` are from this SH-10 run.

## Headline

The feature renders and works end to end in a production build. A teacher builds a quiz; a student takes it (going offline and reloading mid-attempt), submits it and sees the result; the teacher grades the essay; analytics and the parent view render.

**One UI defect blocks a clean pass (UIV-1, FR-14):** the quiz player's sticky header uses `top: 0`. After the student scrolls, it slides under the app shell's fixed AppBar, which hides the **quiz title, countdown timer and save-status pill** (at 375 and 1280) and also the **Submit** button (at 1280). Measured after a 1200px scroll, the title and timer sit at top 16–18px under a 56px (375) / 64px (1280) AppBar, and `elementFromPoint` at the timer hits the AppBar. Suggested fix in `src/app/(app)/quizzes/[quizId]/take/QuizPlayer.tsx`: offset the sticky `top` by the toolbar height (e.g. `top: { xs: 56, sm: 64 }` or derived from `theme.mixins.toolbar`). Evidence: `student-player-scrolled-375.png` and `student-player-scrolled-1280.png`.

## Method

Production build (`npm run build`, exit 0) served with `next start -p 3300` against local Postgres :5433. The existing :3000 and :3001 servers were left alone. A throwaway Playwright driver outside the repo (/tmp/uiv-sh10/driver.cjs) created tagged fixtures (code 'uiv-sh10'): a teacher, 3 students, a parent linked to 1 student, one course, and 6 quizzes. The quizzes are open/IMMEDIATELY with 5 question types, upcoming/AFTER_CLOSE, CLOSED with showCorrectAnswers off, DRAFT with a publish problem, MANUAL with a pending attempt, and practice/one-per-page/1-minute. The driver signed in per role and drove every SH-10 surface at 1280x800 (teacher) and 375x667 (student/parent), with bypassCSP as in the e2e suite. The student took a quiz live: answered, went offline, reloaded and submitted. The teacher then graded it and the student saw the result. State changes were checked against the DB. A second script (/tmp/uiv-sh10/sticky.cjs) measured the sticky header against the AppBar after scrolling. Fixtures were removed afterwards (cleanedUp: true). Apart from one expected offline network error, no console or page errors were captured. figma-readiness.json does not exist, so the checks compare against requirements.json only. The login rate limit required one server restart between runs. Screenshots are in screenshots/ and the raw probe output is in uiv-raw.json.

## Findings

| # | Requirement | Surface | Verdict | Notes |
|---|---|---|---|---|
| 1 | FR-11 | Course Quizzes tab /courses/[id]/quizzes (teacher, 1280) | ✅ PASS | The QUIZZES course tab is registered. The teacher table has the columns Title, Status, Window, Attempts, Average and Needs grading. It shows all 6 fixture quizzes, including the DRAFT and CLOSED ones and a Practice chip. Average updated from 58.3% to 77.1% after the live attempt. NEW QUIZ is present. Screenshot teacher-course-quizzes-1280.png. Minor issue: axe empty-table-header on the unlabeled actions column (UIV-3). |
| 2 | FR-11 | Course Quizzes tab (student, 375) | ✅ PASS | Cards are grouped into Available now (Start), Upcoming (Opens …), Completed and Missed. The draft quiz is hidden. Each card shows questions, points, minutes and attempts used/allowed. After grading, the card shows 'Score: 11.50 / 12.00 (95.8%)' with VIEW RESULT. A pending MANUAL quiz shows 'Submitted — results will be available later.' No horizontal overflow at 375. Screenshots student-course-quizzes-375.png, student-course-quizzes-after-375.png, student-s3-quizzes-375.png. |
| 3 | FR-11 | Course Quizzes tab (parent, 375) | ✅ PASS | Read-only list of the linked child's results ('UIV Fractions check — Blake Bell, Attempt 1: 7.00 / 12.00 (58.3%)'). It has no Start or Resume actions, and no draft or open quizzes are listed. Screenshot parent-course-quizzes-375.png. |
| 4 | FR-37 | Navigation | ✅ PASS | Quizzes are reached through the course tab. As FR-37 allows, there is no sidebar entry. |
| 5 | FR-6 | Quiz builder Settings tab /courses/[id]/quizzes/[id]/edit | ✅ PASS | Every Quiz field renders with a label: Title, Instructions, Opens, Closes, Time limit (with the hint 'Blank = untimed (1–300)'), Attempts allowed, Scoring policy, Results visible (3 options), Practice, Shuffle questions/options, One question per page and Show correct answers. 'NEW QUIZ' creates a DRAFT 'Untitled quiz' and redirects to /edit. The time-limit-versus-window error was NOT exercised in the UI: the probe's 300-minute value was shorter than the new quiz's 7-day window. That rule is covered by QA unit tests only. Screenshot teacher-builder-settings-1280.png. |
| 6 | FR-28 | Accommodations table (Settings tab) | ✅ PASS | The 'Accommodations' table renders one row per enrolled student, with Extra minutes (0–300), Extra attempts (0–5) and SAVE, plus an info note about in-progress attempts. Saving a value was not exercised through the UI. |
| 7 | FR-7 | Builder question list + per-type editors | ✅ PASS | The type picker plus ADD QUESTION added Single choice, Multiple choice, True/false, Short answer and Essay questions. The header updated each time (1 to 5 questions). Each question has a drag handle, up/down move buttons, Duplicate and Delete. Duplicate gave 6 questions; Delete opened a 'Delete question 2?' confirmation and then gave 5. The editors render the right controls: option rows with a correct radio (single) or checkbox (multiple), 'True is correct / False is correct', accepted answers with a Case sensitive switch, and essay 'Grading guidance (teachers only)'. Drag itself was not performed. Screenshot teacher-builder-questions-1280.png. |
| 8 | FR-8 | Running points total + Preview as student | ✅ PASS | The header shows 'N questions · X points total' and updates live. Preview opens a dialog titled 'Preview as student — nothing is recorded' with a Preview chip and a 'Not recorded' pill. Answering in the preview created no attempt (attempt count 1 before and 1 after). Screenshot teacher-preview-1280.png. |
| 9 | FR-9 | Publish checklist | ✅ PASS | A draft with a choice question that has no correct option shows the warning 'Before you can publish — Question 1 needs a correct answer.' and Publish is disabled. An empty new quiz also shows the checklist. Screenshot teacher-draft-checklist-1280.png. |
| 10 | FR-10 | Builder edit lock once attempts exist | ✅ PASS | On a quiz with attempts, an info alert explains which edits are still allowed, with a REGRADE action. ADD QUESTION is disabled, and Grade and Analytics links appear. Regrade was not clicked. Screenshot teacher-builder-locked-1280.png. |
| 11 | FR-12 | Player start screen /quizzes/[id]/take | ✅ PASS | Shows Markdown instructions (bold rendered), Questions 5, Total points 12, Time limit 20 minutes, Attempts '0 used of 2' and Closes. START ATTEMPT opens the confirmation 'Start this attempt? The 20-minute timer starts as soon as you start…'. Screenshots student-start-screen-375.png, student-start-confirm-375.png. |
| 12 | FR-14 | Player layout (all-on-one-page and one-per-page) | ❌ FAIL | Inputs render correctly: native Radio for single choice and true/false, Checkbox for multiple choice, a TextField for short answer, and a multiline essay field with a 0/10000 counter. The LinearProgress reads '4 of 5 answered'. One-per-page mode shows a single question, a 'Question navigator' of buttons labelled answered/unanswered/flagged, and Previous/Next. The timer showed 00:59 in red (rgb(185,28,28)) on a 1-minute quiz. DEFECT (UIV-1): the sticky header uses top: 0 inside the app shell, so after scrolling it slides under the fixed AppBar (56px at 375, 64px at 1280). Measured after a 1200px scroll: the title and timer are at top 16–18px, under the AppBar, and elementFromPoint at the timer hits the AppBar. At 1280, Submit (top 16px) is hidden too. The quiz title, the countdown and the save-status pill are therefore not visible while answering lower questions. Screenshots student-player-scrolled-375.png, student-player-scrolled-1280.png, student-player-375.png, student-one-per-page-375.png. |
| 13 | FR-15 | Autosave status pill | ✅ PASS | The pill showed 'Saving…' during the debounce, then 'All answers saved'. 4 answers were in the DB. With the browser offline, an essay edit showed 'Offline — answers saved on this device' and a localStorage key quiz-attempt:<id>. After reconnecting, the pill returned to 'All answers saved' and the DB had 5 answers. The only console error was the expected net::ERR_INTERNET_DISCONNECTED. Screenshot student-player-offline-375.png. |
| 14 | FR-19 | Reload mid-attempt | ✅ PASS | After a page reload the same attempt resumed with the single-choice answer, the multiple-choice answers and the essay text intact. The DB had exactly 1 IN_PROGRESS attempt. |
| 15 | FR-17 | Submit confirmation + outcome | ✅ PASS | The dialog reads 'Submit your answers? You have 1 unanswered question. …'. After confirming, the player went to the attempt page. The DB status was NEEDS_GRADING (the essay is ungraded), with an auto-score of 8. Screenshot student-submit-confirm-375.png. |
| 16 | FR-20 | Results visibility states | ✅ PASS | IMMEDIATELY: the result page appeared right after submit; while the essay was pending it said 'Some answers are awaiting grading…' and showed no total. MANUAL, before release: the student result page shows only 'Submitted — results will be available later.' with no score. The teacher builder for the MANUAL quiz shows RELEASE RESULTS (not clicked). Screenshots student-result-needs-grading-375.png, student-result-pending-375.png, teacher-manual-release-1280.png. |
| 17 | NFR-1 | Student-visible JSON before results | ✅ PASS | In the signed-in student browser context, GET /api/attempts/:id for a pending MANUAL attempt and GET /api/quizzes/:id contained no "correct" key and no explanation text. |
| 18 | FR-21 | Attempt result page /quizzes/[id]/attempts/[id] | ✅ PASS | After grading it shows 11.50 / 12 and 95.8%, plus per-question Correct/Partly correct/Incorrect chips with points, 'Your answer', and 'Correct answer' and Explanation (showCorrectAnswers=true). Teacher feedback 'Clear method.' is shown. When showCorrectAnswers=false (parent view of the closed quiz), correct answers and explanations are hidden. No input fields and no overflow at 375. Screenshots student-result-graded-375.png, student-result-graded-1280.png, parent-result-375.png. |
| 19 | FR-24 | Manual grading page /courses/[id]/quizzes/[id]/grade | ✅ PASS | BY STUDENT / BY QUESTION tabs, an attempt selector and per-answer cards with an Auto-graded / Needs grading / Graded by teacher chip. Points has the helper '0 – 4, steps of 0.5'; Feedback; SAVE. Entering 99 shows 'At most 2' and disables Save; 0.3 shows 'Points must be a multiple of 0.5'. By question shows the prompt, the essay guidance and every student's answer. Screenshots teacher-grade-by-student-1280.png, teacher-grade-invalid-1280.png, teacher-grade-by-question-1280.png. |
| 20 | FR-25 | Attempt completes on last grade | ✅ PASS | Saving 3.5 points on the essay showed the 'Grade saved' toast. The DB attempt then became GRADED with score 11.5, and the page showed 'Everything is graded.'. Screenshot teacher-grade-saved-1280.png. |
| 21 | FR-26 | Analytics summary + histogram | ✅ PASS | Tiles show Attempts 2, Average 9.25, Median 9.25, Highest 11.50, Lowest 7 and Avg. time 6m 06s. An MUI X BarChart has 10% buckets, with the bars at 50–60% and 90–100% matching 58.3% and 95.8%. Screenshot teacher-analytics-1280.png. axe found role-img-alt (serious) twice on the chart SVG and one heading-order issue (UIV-2). |
| 22 | FR-27 | Analytics per-question table + CSV | ✅ PASS | The 'Per-question results' table shows %, avg points and option-distribution chips (green = correct, red = most-chosen wrong, with a legend). EXPORT CSV is present, and GET ?format=csv returned 200 with a header row and one row per attempt. |
| 23 | FR-39 | Markdown prompts / image upload control | ✅ PASS | Markdown prompts render (bold in the start-screen instructions and prompt). The editor has Write/Preview tabs and 'ADD IMAGE 0/1'. Uploading an image and displaying it in a prompt were not exercised. |
| 24 | NFR-3 | Player accessibility | ✅ PASS | axe on <main> of the player at 375 found no violations. The choice inputs are native radio and checkbox elements, the timer has the aria-label 'Time remaining mm:ss', and there is an aria-live='assertive' status region. Keyboard-only operation was not driven end to end. The sticky-header overlap (UIV-1) is a visual problem, not an AT problem. |
| 25 | NFR-4 | MUI-only visual consistency | ✅ PASS | Every rendered surface uses the app's MUI theme (chips, cards, tables, x-charts) and matches the existing Assignments pages. No unstyled elements were seen. |

## Additional findings

- **UIV-1** — FAIL (major): the player's sticky header (top: 0) hides under the fixed AppBar after scrolling. The title, timer and save pill are hidden at 375 and 1280, and Submit is also hidden at 1280. Fix: offset the sticky top by the toolbar height (theme.mixins.toolbar / {xs: 56, sm: 64}) in QuizPlayer.tsx.
- **UIV-2** — minor: on the analytics BarChart SVG, axe reports role-img-alt (serious) twice; there is also one heading-order (moderate) issue on the analytics page.
- **UIV-3** — minor: axe empty-table-header on the unlabeled actions column of the teacher quizzes table (shared DataTable pattern).
- **UIV-4** — not exercised: the time-limit-longer-than-window validation in the Settings panel, saving accommodations, Regrade, Release results, drag reorder and image upload (QA covers them through unit, integration and e2e tests).

## Not UI-facing (not verified here)

FR-1–5, FR-13, FR-16, FR-18, FR-22, FR-23 (limit enforcement), FR-29–36, FR-38 and NFR-2/5–10 are server, schema or test requirements with no visual surface of their own. They are covered by the QA report.

## Screenshots

- `screenshots/parent-course-quizzes-375.png`
- `screenshots/parent-result-375.png`
- `screenshots/student-course-quizzes-375.png`
- `screenshots/student-course-quizzes-after-375.png`
- `screenshots/student-one-per-page-375.png`
- `screenshots/student-player-375.png`
- `screenshots/student-player-offline-375.png`
- `screenshots/student-player-scrolled-1280.png`
- `screenshots/student-player-scrolled-375.png`
- `screenshots/student-result-graded-1280.png`
- `screenshots/student-result-graded-375.png`
- `screenshots/student-result-needs-grading-375.png`
- `screenshots/student-result-pending-375.png`
- `screenshots/student-s3-quizzes-375.png`
- `screenshots/student-start-confirm-375.png`
- `screenshots/student-start-screen-375.png`
- `screenshots/student-submit-confirm-375.png`
- `screenshots/teacher-analytics-1280.png`
- `screenshots/teacher-builder-empty-1280.png`
- `screenshots/teacher-builder-locked-1280.png`
- `screenshots/teacher-builder-questions-1280.png`
- `screenshots/teacher-builder-settings-1280.png`
- `screenshots/teacher-course-quizzes-1280.png`
- `screenshots/teacher-draft-checklist-1280.png`
- `screenshots/teacher-grade-by-question-1280.png`
- `screenshots/teacher-grade-by-student-1280.png`
- `screenshots/teacher-grade-invalid-1280.png`
- `screenshots/teacher-grade-saved-1280.png`
- `screenshots/teacher-manual-release-1280.png`
- `screenshots/teacher-preview-1280.png`
- `screenshots/teacher-question-editor-1280.png`
- `screenshots/teacher-settings-timelimit-1280.png`
