# SH-16 — User Stories (PRD-16 Role Dashboards, Reports & Early-Warning Insights)

Source: PRD-16 (SCH-016), run mode `--brownfield --tech-stack react`. Confidence labels match `requirements.json`.

## Dashboard shell
- **FR-1 (HIGH)** As any signed-in user, I want `/dashboard` to show the dashboard for my role (parents go to the child overview) so that I land on what's relevant to me.
- **FR-2 (HIGH)** As a user, I want each widget to load on its own with a skeleton, and to show "This widget could not load — Retry" if it fails, so that one broken widget doesn't break my page.
- **FR-3 (HIGH)** As a user, I want a greeting with my name, today's date and the current term so that I know where I am at a glance.

## Teacher dashboard
- **FR-4 (HIGH)** As a teacher, I want today's classes with Now/Next badges and attendance status so that I know which registers I still need to take.
- **FR-5 (HIGH)** As a teacher, I want a count and the oldest 5 ungraded submissions and quiz attempts so that I can clear my grading backlog.
- **FR-6 (HIGH)** As a teacher, I want deadlines in the next 7 days with submission rates so that I can chase students before work is due.
- **FR-7 (HIGH)** As a teacher, I want my top 5 at-risk students with reasons so that I can intervene early.
- **FR-8 (MEDIUM)** As a teacher, I want my unread message count and the latest 3 announcements so that I don't miss communication.
- **FR-9 (HIGH)** As a teacher, I want quick actions (New assignment, New announcement, Take attendance, New quiz) so that I can start common tasks in one click.

## Student dashboard
- **FR-10 (HIGH)** As a student, I want today's schedule with Now/Next, or a holiday message, so that I know where to be.
- **FR-11 (HIGH)** As a student, I want work due in the next 7 days, with missing work first in red, so that I stay organised.
- **FR-12 (HIGH)** As a student, I want my last 5 grades so that I see recent feedback.
- **FR-13 (HIGH)** As a student, I want course cards with current percent and letter, content progress and next lesson so that I can pick up where I left off.
- **FR-14 (MEDIUM)** As a student, I want my latest 3 unread announcements so that I stay informed.
- **FR-15 (HIGH)** As a student, I want my term attendance rate as a gauge so that I can see how I'm doing.

## Admin dashboard
- **FR-16 (HIGH)** As an admin, I want KPI cards (active students and teachers, today's attendance with weekly delta, missing registers, open safeguarding reports for leads, pending absence notes) so that I can monitor the school's health.
- **FR-17 (HIGH)** As an admin, I want a 30-school-day attendance trend with the alert threshold line so that I spot declines.
- **FR-18 (HIGH)** As an admin, I want enrollment per grade level stacked by gender so that I understand the student population.
- **FR-19 (HIGH)** As an admin, I want a 10 % bucket grade distribution with average and median so that I see academic health.
- **FR-20 (HIGH)** As an admin, I want at-risk counts by level and reason so that I see the size of the problem.
- **FR-21 (MEDIUM)** As an admin, I want the next 5 school events so that I can prepare.
- **FR-22 (HIGH)** As an admin, I want the last 10 user/report-card/settings audit entries so that I see recent changes.

## Caching
- **FR-23 (HIGH)** As a user, I want expensive aggregates cached (15 min; at-risk 60 min) so that dashboards load quickly.
- **FR-24 (HIGH)** As an admin, I want to see "Updated N min ago" and a Refresh button so that I can force fresh data.

## Early-warning (at-risk)
- **FR-25 (HIGH)** As an admin or teacher, I want each active student scored on attendance, grades and missing work so that slipping students are flagged.
- **FR-26 (HIGH)** As an admin or teacher, I want a clear overall level (High / Medium / none) so that I can prioritise.
- **FR-27 (HIGH)** As the system, I want risk results stored per student per term and refreshed at most hourly so that lists are fast and current.
- **FR-28 (LOW)** As an admin or teacher, I want to see whether a student's risk is improving or worsening so that I can judge whether interventions are working.
- **FR-29 (HIGH)** As an admin or teacher, I want an at-risk list scoped to the students I can access, with reasons as chips and quick actions, so that I can intervene early.
- **FR-30 (HIGH)** As an admin or teacher, I want to filter the at-risk list and export it to CSV so that I can share it with colleagues.
- **FR-31 (HIGH)** As an admin or teacher, I want an Insights tab on the student page so that I see the student's signals and history in context.
- **FR-32 (HIGH)** As a homeroom teacher, I want to be notified when a student becomes High risk (no more than once per 14 days per student) so that I can act promptly.

## Reports centre
- **FR-33 (HIGH)** As an admin, I want a reports centre with a year/term selector, plus filters, a chart, a table and CSV export on every report, so that I can answer leadership questions.
- **FR-34 (HIGH)** As an admin, I want an enrollment report so that I can report headcounts and movements.
- **FR-35 (HIGH)** As an admin, I want an attendance report by grade, section and course with a trend and the lowest 20 students so that I can target attendance work.
- **FR-36 (HIGH)** As an admin, I want an academic performance report by course, subject and section so that I can compare outcomes.
- **FR-37 (HIGH)** As an admin, I want on-time / late / missing completion rates by course and teacher so that I see where work is slipping.
- **FR-38 (MEDIUM)** As an admin, I want lesson completion, announcement read rate and parent portal activity so that I can measure engagement.
- **FR-39 (HIGH)** As an admin, I want per-teacher workload (courses, students, weekly periods, grading backlog) so that I can balance staffing.

## Navigation & API
- **FR-40 (HIGH)** As an admin or teacher, I want "Reports" (admin) and "At-risk students" (admin, teacher) in the sidebar so that I can reach them directly.
- **FR-41 – FR-44 (HIGH)** As a client developer, I want role-guarded REST endpoints for dashboard data, refresh, at-risk lists, student insights and reports (with `?format=csv`) so that the UI and exports share one source of truth.

## Seed data
- **FR-45 (HIGH)** As a developer, I want `npm run seed:large` (600 students, 40 teachers, deterministic) so that I can verify performance targets.
- **FR-46 (HIGH)** As a developer, I want the default seed to include at least 3 students at each risk level so that features are demonstrable locally.

## Non-Functional Requirements
- **NFR-1 (HIGH)** Dashboards render first content in under 1.5 s and reports in under 3 s on seed:large data.
- **NFR-2 (HIGH)** Charts have accessible summaries or hidden tables, meet 3:1 contrast, don't rely on colour alone, and pass an axe scan.
- **NFR-3 (HIGH)** Teacher-scoped data is limited to `getAccessibleStudentIds`, enforced server-side.
- **NFR-4 (HIGH)** UI is built only from Material UI / MUI X components; no banned libraries.
- **NFR-5 (HIGH)** Every MUI component is looked up through the mui-mcp server first; QA verifies imports.
- **NFR-6 (HIGH)** Platform conventions apply: thin handlers, Zod validators, standard response shapes, pagination limits, feature-subdirectory services.
- **NFR-7 (HIGH)** All date logic uses the school timezone.
- **NFR-8 (HIGH)** Brownfield reuse: no re-scaffolding, no duplicated helpers, no renamed routes or models.
- **NFR-9 (HIGH)** Tests cover risk boundaries (unit), reports and cache revalidation (integration), and role dashboards with axe (Playwright).
- **NFR-10 (HIGH)** lint, typecheck and tests keep passing; no `console.log`.
- **NFR-11 (HIGH)** Out of scope: drag-and-drop layouts, ML risk models, scheduled report emails.
- **NFR-12 (HIGH)** At-risk data is refreshed at least hourly.
