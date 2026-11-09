# SH-11 — User Stories (PRD-11: Gradebook, Grading Scales & Report Cards)

Run mode: `--brownfield --tech-stack react`. Each story cites its requirement id(s) in `requirements.json`.

## Data & Sync

- **US-1 (FR-1, FR-2)** — As a developer, I want the gradebook models, a Course grading scale, and a category on assignments and quizzes, so that every grade has a stored home.
- **US-2 (FR-3, FR-4)** — As a teacher, I want published assignments and graded (non-practice) quizzes to appear in the gradebook automatically, so that I never enter them twice.
- **US-3 (FR-5, FR-6)** — As a teacher, I want a returned submission's final score (or its exemption) to sync to the gradebook, so that the gradebook stays current. Unreturned scores stay hidden from students.
- **US-4 (FR-7)** — As a teacher, I want a quiz score to sync once the attempt is graded and its results are visible, so that quiz results count without manual entry.
- **US-5 (FR-8)** — As an admin, I want an idempotent `npm run gradebook:backfill`, so that data created before this PRD appears in the gradebook.
- **US-6 (FR-9)** — As a teacher, I want synced grades to be read-only except for the comment, so that the source page remains the single place to edit them.

## Calculation

- **US-7 (FR-10 – FR-15)** — As a teacher, I want term grades calculated the same way across the school (excused and missing items, drop lowest, weight re-normalisation, half-up rounding, then band lookup, then overrides), so that grades are consistent and correct. For example, Homework 40% (18/20, 9/10) and Exams 60% (70/100) give 78.0% C+.

## Setup

- **US-8 (FR-16)** — As an admin, I want to define grading scales with validated bands and exactly one default, so that letter grades are consistent.
- **US-9 (FR-17, FR-40)** — As a teacher, I want to set weighted categories that must total 100, with a live sum indicator, and choose a grading scale per course, so that grades reflect my syllabus.

## Gradebook Grid

- **US-10 (FR-18, FR-19)** — As a teacher, I want a spreadsheet-like grid of students × items, grouped by category, with averages and the term grade, so that I can see my whole class at a glance.
- **US-11 (FR-20)** — As a teacher, I want to edit manual-item grades with the keyboard (numbers, Enter or arrows, E, M, Delete), with optimistic saves, so that I can enter grades quickly.
- **US-12 (FR-21)** — As a teacher, I want clicking a synced cell to open its submission or quiz attempt, so that I edit the grade at its source.
- **US-13 (FR-22)** — As a teacher, I want to add manual grade items for offline work, so that all assessment is in one place.
- **US-14 (FR-23)** — As a teacher, I want to override a student's term grade or letter and add a comment, so that I can apply professional judgement on the report card.
- **US-15 (FR-24)** — As a teacher, I want column actions (hide/show, mark ungraded as missing, statistics), so that I can manage items in bulk.
- **US-16 (FR-25)** — As a teacher, I want to export the grid as CSV, so that I can share or archive it.

## Student & Parent Views

- **US-17 (FR-26, FR-27, FR-28, FR-42)** — As a student or parent, I want to see current course grades and individual visible scores (on the student tab, on `/grades` and on the course Grades tab), so that we know where the student stands.

## Report Cards

- **US-18 (FR-29)** — As an admin, I want a term-filtered list of students with report card status and missing-data warnings, so that I can fix gaps before generating.
- **US-19 (FR-30, FR-31)** — As an admin, I want to generate draft report cards as frozen snapshots, so that published results never change afterwards.
- **US-20 (FR-32, FR-33)** — As a homeroom teacher or admin, I want to review a card and write homeroom and principal comments, so that families get personal feedback.
- **US-21 (FR-34, FR-37)** — As an admin, I want to publish cards (individually or in bulk) and unpublish with an audited reason, so that families receive official results securely.
- **US-22 (FR-35, FR-36)** — As an admin, student or parent, I want an A4 print view and a 'Report cards' student tab, so that cards can be printed or saved as PDF.

## Notifications & Seed

- **US-23 (FR-38)** — As a student or parent, I want a `grade.posted` notification for manual grades and a `report_card.published` notification, so that I'm informed promptly.
- **US-24 (FR-41)** — As a developer or QA, I want seed data (the Standard A–F scale, 7A categories, the Oral presentation item, 7A draft cards), so that the features can be demoed and tested.

## Non-Functional Requirements

- **NFR-1** — Pure, Decimal-based calculation with an exhaustive unit test matrix.
- **NFR-2 / NFR-3** — Gradebook for 35 × 80 loads in < 800 ms; report card generation for 600 × 8 finishes in < 30 s.
- **NFR-4** — Every manual grade change, override and unpublish is audited with old and new values.
- **NFR-5** — Hidden items, unreturned scores and unpublished cards never reach students or parents.
- **NFR-6** — Server-side role and entity access checks on every handler and page.
- **NFR-7** — MUI-only UI, with every component looked up via mui-mcp. No banned libraries; QA checks.
- **NFR-8** — DataGrid uses MIT-tier features only (no pinned columns).
- **NFR-9** — Brownfield reuse of existing helpers; no re-scaffolding or renames; no console.log.
- **NFR-10** — Date rules use the school timezone; storage is UTC.
- **NFR-11** — Printed cards fit A4 portrait without the sidebar.
- **NFR-12** — lint, typecheck and test pass, plus the new unit, integration and Playwright tests.
- **NFR-13** — Out of scope: standards-based grading, GPA/class rank, multi-year transcripts.
