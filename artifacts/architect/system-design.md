# System Design: PRD-11 Gradebook, Grading Scales & Report Cards

Ticket: **SH-11** · Phase: architect (`arch-design-system`) · Timestamp: 2026-11-09T17:30:00Z · Status: **complete**

Inputs: `artifacts/intake/requirements.json` (42 FR + 13 NFR), `artifacts/intake/handoff-to-architect.json`, `artifacts/architect/tech-stack-decisions.md` (ADR-1 to ADR-10), `artifacts/architect/requirements-analysis-notes.md` (B1–B19, R1–R7), and the source PRD `11-gradebook.md`.

---

## 1. Overview

PRD-11 adds a gradebook to SchoolHub, a brownfield Next.js 14 App Router + Prisma/PostgreSQL + MUI 9.5.0 app. It has four parts:

1. **Sync.** Published assignments and quizzes become `GradeItem`s. Returned submissions and released quiz results become `Grade`s.
2. **Calculation.** A pure Decimal function turns items, grades, categories, a scale and an override into a term percent and letter.
3. **Views.** A teacher grid (MIT DataGrid), student/parent grade views, and admin pages for scales and categories.
4. **Report cards.** Frozen JSON snapshots per student and term, with a draft → published workflow, notifications and an A4 print view.

The design adds **no dependencies** (ADR-1). New server code lives only in `src/server/gradebook/` and `src/server/report-cards/` (NFR-9). Existing services gain one-line calls into the sync module.

### 1.1 Intake blockers

`handoff-to-architect.json` reports **`blockers: []`** at 95% confidence. There is nothing to escalate. The flagged assumptions are resolved in §1.2.

### 1.2 Assumptions and design decisions (need product sign-off, none block dev)

| # | Topic | Decision | Req |
|---|---|---|---|
| A1 | Exemption removal | Unexempt sets `excused = false` and re-derives `score` from the source: `finalScore` if the submission is RETURNED, otherwise `null`. | FR-6 |
| A2 | Quiz score source | **Intake's correction:** `getStudentQuizScore(quizId, studentId)` **already exists** in `src/server/quiz/attempt-service.ts` (L359, labelled "PRD-11 export"). Call it as is. It does **not** check visibility, so the sync gates on `resultsVisible()` first. This replaces ADR-6's "add a helper to grading.ts". Don't create a second one. | FR-7, NFR-9 |
| A3 | 89.95 rounding | 89.95 → 90.0 → **A−** under the seed scale (A is 93). The unit test asserts 90.0 and the 90-band letter. | FR-13 |
| A4 | Nav entries | Add `/grades` (STUDENT, PARENT), `/report-cards` (TEACHER), and `/admin/grading-scales` and `/admin/report-cards` (ADMIN, group `Administration`). | FR-16, FR-27, FR-29, FR-33 |
| A5 | Past due | `now > dueAt` as a UTC instant. Term containment compares school-local dates (`SchoolSettings.timezone`). | NFR-10 |
| A6 | No term | If no term of the course's academic year contains the date and no term contains today, skip the item and `logger.warn`. | FR-3 |
| A7 | Teacher hide vs source visibility (R2) | **No extra column** (FR-1 says "exactly as specified"). Source sync writes `isVisible` only on source visibility **transitions**: publish / publishOnce → `true`, archive → `false`. Plain edits to an already-published source never touch `isVisible`, so a teacher's hide survives re-saves. | FR-4, FR-24 |
| A8 | Uncategorised weight (R3) | If the course has categories, the implicit "Uncategorised" bucket is **shown with its subtotal but has weight 0**, so it's excluded from the weighted mean. If no category has a counted item, fall back to the points total over **all** counted items. If the course has no categories, use the points total. | FR-12 |
| A9 | `grade.posted` dedupe (R4) | No marker column. Notify only when a MANUAL grade's `score` goes from `null` to a value. That gives one notification per student per item. Later edits are audited but not notified. | FR-38 |
| A10 | Term drift (R5) | Re-derive `GradeItem.termId` only when `dueAt`/`availableUntil` changes. | FR-3 |
| A11 | Scale delete (R6) | Return `CONFLICT` if the scale is the default or any `Course.gradingScaleId` references it. Published snapshots embed their own legend, so they're unaffected. | FR-16 |
| A12 | Percent-only override | Re-derive the letter from the effective scale using the override percent. | FR-14 |
| A13 | Report card edits | Comments are editable only while `DRAFT`. Unpublish returns the card to `DRAFT` and clears `publishedAt`/`publishedById`. | FR-32, FR-34 |
| A14 | `Grade.updatedById` on system writes | Sync uses the acting user (grader/teacher) when there is one. Otherwise (auto-graded quiz, maintenance release, backfill) it uses `quiz.createdById`, `assignment.createdById` or, for backfill, `course.teacherId`. The column has no FK, as specified. | FR-1, FR-5, FR-7, FR-8 |
| A15 | Quiz CLOSED | A CLOSED quiz is **not** unpublished. Its item stays visible. Quizzes have no archive. `deleteQuiz` deletes the item. A practice toggle after publish deletes the item. | FR-3, FR-4 |

---

## 2. Component Breakdown

### 2.1 Data model (one migration: `prisma/migrations/<ts>_gradebook/`)

The models and enums are **exactly the PRD FR-1 block** (FR-1). On top of that:

- **Additive columns (FR-2):** `Course.gradingScaleId String?` → `GradingScale` (`onDelete: SetNull`). `Assignment.categoryId String?` and `Quiz.categoryId String?` → `GradeCategory` (`onDelete: SetNull`), so deleting a category never deletes sources.
- **Relation fields:** add only the back-relations Prisma requires (`Course.gradeItems`, `Course.gradeCategories`, `Term.gradeItems`, `GradeCategory.items/assignments/quizzes`). There are no new scalar columns beyond the spec.
- **Keys already in the spec make sync race-safe (B19):** `GradeItem.sourceId @unique`, `Grade @@id([gradeItemId, studentId])`, `TermGradeOverride @@id([courseId, termId, studentId])`, `ReportCard @@unique([studentId, termId])`.
- **Indexes added:**
  - `GradeItem @@index([courseId, termId])` (NFR-2, NFR-3)
  - `TermGradeOverride @@index([termId])` (NFR-3)
  - `ReportCard @@index([termId, status])` (FR-29)
- **Raw SQL in the migration:** a partial unique index `CREATE UNIQUE INDEX grading_scale_one_default ON "GradingScale" ("isDefault") WHERE "isDefault";` as the backstop for "exactly one default" (FR-16, ADR-3).
- **Types:** `bands Json` holds `{ letter, minPercent, gpa?, descriptor? }[]`, sorted descending and validated by Zod (`bandsSchema`). `gpa` is stored and never computed (NFR-13).

### 2.2 Server modules

| Module | Responsibility | Reuses | Req |
|---|---|---|---|
| `src/server/gradebook/grade-calc.ts` | **Pure** functions with no Prisma client import (types only): `computeStudentTerm(input)`, `categoryPercent`, `applyDropLowest`, `roundHalfUp1`, `letterFor(percent, bands)`, `applyOverride`, `effectiveScale(course, default)`, `gradeColour(percent)`. Everything is `Decimal`, and rounding happens once at the end. | `Decimal`, `dec`, `fixed2` from `assignments/grading-math.ts` | FR-10–FR-15, FR-26, NFR-1 |
| `src/server/gradebook/term-placement.ts` | Pure `termFor(date, terms, tz, now)`: picks the containing term in school-local dates, falls back to the term containing today, else returns `null`. | `schoolToday` (attendance-rules), `getSchoolTimezone` | FR-3, NFR-10, A6 |
| `src/server/gradebook/gradebook-sync.ts` (file name from the PRD) | Idempotent upserts. `upsertItemFromAssignment(tx, id)`, `upsertItemFromQuiz(tx, id)`, `hideItemForSource(tx, sourceId)`, `deleteItemForSource(tx, sourceId)`, `syncSubmissionGrade(tx, assignmentId, studentId, actorId?)`, `syncQuizGrade(quizId, studentId)`, `syncQuizGrades(quizId)`. It also exports **pure row builders** (`itemFromAssignment`, `gradeFromSubmission`, `gradeFromQuizScore`) that the backfill shares. | `isAssignmentVisible`, `getStudentQuizScore`, `resultsVisible`, `applyScoringPolicy`, `logger` | FR-3–FR-7, NFR-5 |
| `src/server/gradebook/backfill.ts` | `backfillGradebook()`. Batch-loads per course and runs the same row builders with `upsert`. Idempotent through the unique keys. | `applyScoringPolicy` in memory (no per-student `getStudentQuizScore`) | FR-8, NFR-3 |
| `src/server/gradebook/gradebook-service.ts` | `getGradebook(user, courseId, termId)`, `createManualItem`, `updateItem`, `deleteItem`, `putGrade`, `markAllMissing`, `putTermOverride`, `exportGradebookCsv`. Loads the data, calls grade-calc, enforces FR-9 and writes audit entries. | `assertCanManageCourse`, `audit`, `notifyStudentAndParents`, `toCsv` | FR-9, FR-18–FR-25, FR-38, NFR-2, NFR-4 |
| `src/server/gradebook/categories-service.ts` | `getCategories`, `replaceCategories` (in a transaction: delete removed ids, upsert the rest, `dec(sum).eq(100)`), and `setCourseScale`. | `assertCanViewCourse`/`assertCanManageCourse` | FR-17, FR-40 |
| `src/server/gradebook/scales-service.ts` | CRUD. `setDefault` runs in a transaction that clears the other defaults. Delete is guarded (A11). | `requireRole('ADMIN')`, `audit` | FR-16 |
| `src/server/gradebook/student-grades-service.ts` | `getStudentGrades(user, studentId, termId, courseId?)`. Uses the visible-only serializer. Reuses grade-calc and passes **visible items only** into it, so the computed totals match what the student sees. | `assertCanViewStudent`, `getAccessibleStudentIds` | FR-26–FR-28, FR-42, NFR-5 |
| `src/server/gradebook/load.ts` | Shared batched loader: `loadCourseTermData(courseIds[], termId, studentIds?)` returns `{items, grades, categories, overrides, scales}` in 5 `findMany` calls with `in` filters, grouped in memory. Used by the gradebook, student grades and report-card generation. | Prisma | NFR-2, NFR-3 |
| `src/server/report-cards/snapshot.ts` | Zod `snapshotSchema` (`v: 1`) and the pure `buildSnapshot(student, courses, computed, attendance, school, scale)`. | grade-calc | FR-30 |
| `src/server/report-cards/report-card-service.ts` | `listReportCards` (with warnings), `generateDrafts`, `getReportCard`, `patchComments`, `publish`, `unpublish`, `listForStudent`. | `load.ts`, attendance `getReport`, `notifyStudentAndParents`, `audit` | FR-29–FR-34, FR-36, NFR-3, NFR-4 |
| `src/server/report-cards/access.ts` | `assertCanViewReportCard(user, card)`, `canEditHomeroomComment`. | `student-access`, `Section.homeroomTeacherId`, `Enrollment` | FR-32, FR-37, NFR-5, NFR-6 |
| `src/lib/validators/gradebook.ts` | Zod: `bandsSchema`, `scaleSchema`, `categoriesPutSchema`, `manualItemSchema`, `itemPatchSchema`, `gradePutSchema`, `termOverrideSchema` (comment ≤ 1000), `reportCardPatchSchema`, `generateSchema`, `publishSchema`, `unpublishSchema` (reason required). These are shared by client forms and handlers. | Zod | FR-16, FR-17, FR-22, FR-23, FR-39, FR-40 |
| `src/server/notifications/types.ts` (edit) | Register `grade.posted` (STUDENT+PARENT, `defaultEmail: false`) and `report_card.published` (STUDENT+PARENT, `defaultEmail: true`). | existing registry | FR-38 |

**Hook edits to existing services** (each is one call; behaviour is otherwise unchanged, per NFR-9):

| Existing site | Added call | Req |
|---|---|---|
| `assignments-service` `createAssignment` / `updateAssignment` / `publishOnce` | `upsertItemFromAssignment(tx, id)`. This sets `isVisible` only on a visibility transition (A7). It re-places the term only if `dueAt` changed (A10). | FR-3, FR-4 |
| `deleteOrArchiveAssignment` | archive → `hideItemForSource`; hard delete → `deleteItemForSource` in the same transaction (B9) | FR-4 |
| `gradeSubmission`, `bulkReturn`, `gradeOffline` | `syncSubmissionGrade` when the submission **is** RETURNED after the write. This covers re-grades of returned work. Nothing happens otherwise (AC-3). | FR-5, NFR-5 |
| `setExemption` (both branches) | `syncSubmissionGrade` (A1) | FR-6 |
| `quiz-service` `updateQuiz` (→PUBLISHED, or edits to a published quiz) / `deleteQuiz` | `upsertItemFromQuiz` / `deleteItemForSource`. Practice quizzes are skipped; turning practice on deletes the item. Wrap `deleteQuiz` in a transaction. | FR-3, FR-4 |
| After callers of `recomputeAttempt` commit (`submitAttempt`, `gradeAnswerManually`, `regradeQuiz`) | `syncQuizGrade(quizId, studentId)`: no-op unless GRADED, `resultsVisible` and not practice | FR-7 |
| `releaseResults` (MANUAL) and `quiz/maintenance.ts` AFTER_CLOSE claim (`count === 1`) | `syncQuizGrades(quizId)` (bulk). Without this, delayed-visibility quizzes never sync (R1). | FR-7, NFR-5 |
| Assignment and quiz Zod validators and editors | Optional nullable `categoryId` plus one MUI `Select` of the course's categories | FR-2 |

### 2.3 API layer (`src/app/api/**/route.ts`, thin: `withHandler` → Zod → service → `ok()`)

These match the PRD API table exactly. `api-contracts.json` (next sub-task) owns the shapes.

| Route | Role check | Service | Req |
|---|---|---|---|
| `GET/POST /api/grading-scales`, `PATCH/DELETE /api/grading-scales/[id]` | GET: `requireUser`; writes: ADMIN | scales-service | FR-16, FR-39 |
| `GET/PUT /api/courses/[id]/grade-categories` | view / manage | categories-service (PUT body also carries `gradingScaleId`) | FR-17, FR-40 |
| `GET /api/courses/[id]/gradebook?termId=` (`&format=csv` → `text/csv`) | manage | gradebook-service | FR-18–FR-21, FR-24, FR-25, NFR-2 |
| `POST /api/courses/[id]/grade-items` | manage | createManualItem | FR-22 |
| `PATCH/DELETE /api/grade-items/[id]` | manage (via the item's course) | updateItem / deleteItem. Non-MANUAL items accept only `isVisible`, and DELETE is MANUAL only. | FR-9, FR-24 |
| `POST /api/grade-items/[id]/mark-missing` | manage | markAllMissing (`now > dueAt`, ungraded rows only) | FR-24 |
| `PUT /api/grade-items/[id]/grades/[studentId]` | manage + enrolled student | putGrade. Non-MANUAL items accept only `comment` (FR-9). | FR-9, FR-20, FR-38, NFR-4 |
| `PUT /api/courses/[id]/term-overrides/[studentId]` | manage | putTermOverride | FR-14, FR-23, NFR-4 |
| `GET /api/students/[id]/grades?termId=&courseId=` | `assertCanViewStudent` | student-grades-service | FR-26–FR-28, FR-42 |
| `GET /api/report-cards?termId=&gradeLevelId=&sectionId=&studentId=` | ADMIN; homeroom TEACHER (own sections); with `studentId`, view-student rules plus PUBLISHED-only for student/parent | listReportCards / listForStudent | FR-29, FR-33, FR-36 |
| `POST /api/report-cards/generate` | ADMIN | generateDrafts | FR-30, FR-31, NFR-3 |
| `GET /api/report-cards/[id]` | `assertCanViewReportCard` | getReportCard | FR-37 |
| `PATCH /api/report-cards/[id]` | field-level (§4) | patchComments | FR-32 |
| `POST /api/report-cards/publish`, `POST /api/report-cards/unpublish` | ADMIN | publish / unpublish | FR-34 |

`mark-missing` is the only route not in the PRD table. It implements the FR-24 column action server-side, because a client loop of N PUTs would write N audit rows and be slow. The `?format=csv` and `courseId`/`studentId` query parameters extend existing PRD routes rather than adding new ones.

### 2.4 UI (`src/app/(app)/…`, MUI only, every component looked up via mui-mcp first, per NFR-7)

| Page / component | Notes | Req |
|---|---|---|
| `admin/grading-scales/page.tsx` + `ScaleEditorDialog` | `DataTable` list. The dialog uses a band editor (TextField rows, add/remove) with Zod errors inline and a "Default" `Switch`. | FR-16 |
| `courses/[courseId]/gradebook/settings/page.tsx` | Category rows (name, weight, drop lowest, order), a live `Σ weights / 100` `Chip` (error colour ≠ 100, Save disabled), and a scale `Select` ("School default" = null). | FR-17 |
| `courses/[courseId]/gradebook/page.tsx` + `src/components/gradebook/GradebookGrid.tsx` | The single client component that owns the DataGrid (ADR-4, R7). Term `Select`, `columnGroupingModel` by category, custom `renderHeader` (title, due date, max, source icon), `renderCell` (score / EX / M red / — / late `AccessTime` icon), and `isCellEditable` = MANUAL only. Editing runs through `renderEditCell` + `onCellKeyDown` (digits, E, M, Delete, Enter/arrows), then `processRowUpdate` → PUT, `onProcessRowUpdateError` → per-cell error, and `hideFooter`. There are **no pinned columns**. Toolbar: "Add manual item", "Export CSV", "Settings". | FR-18–FR-25, NFR-8 |
| `AddManualItemDialog`, `TermOverrideDialog`, `ItemStatsDialog` | Dialogs. Stats (average, median, high, low) are computed client-side from the payload over counted scores. | FR-22, FR-23, FR-24 |
| `src/components/gradebook/StudentGradesView.tsx` | Course `Card`s with percent, letter and `gradeColour` `Chip`. `Accordion` expands to items and category subtotals. One component serves three hosts: | FR-26–FR-28 |
| ↳ `students/[id]/grades/page.tsx` | student tab | FR-26 |
| ↳ `grades/page.tsx` | STUDENT: self. PARENT: child `Select` from `getAccessibleStudentIds`. | FR-27 |
| ↳ `courses/[courseId]/grades/page.tsx` | filtered to one course | FR-28 |
| `admin/report-cards/page.tsx` | Term / grade level / section filters, `DataTable` with status `Chip` and warnings, and "Generate drafts", "Publish all", "Print all" actions. Confirmations use `ConfirmDialog`. | FR-29, FR-30, FR-34, FR-35 |
| `report-cards/page.tsx` | Homeroom TEACHER: their sections' cards for the selected term | FR-33 |
| `report-cards/[id]/page.tsx` | Review page: `ReportCardDocument` preview plus homeroom/principal comment fields (disabled per role or when PUBLISHED), and Publish / Unpublish (reason dialog) for ADMIN | FR-32, FR-34 |
| `report-cards/[id]/print/page.tsx`, `report-cards/print/page.tsx?termId=&…` | Server components rendering `ReportCardDocument` from the **snapshot only**. `GlobalStyles`: `@page { size: A4 portrait; margin: 12mm }`, `@media print` hides the app shell and buttons, each card gets `break-after: page`, and rows get `break-inside: avoid`. A `PrintButton` calls `window.print()`. Bulk print shows filtered PUBLISHED cards only. | FR-35, NFR-11 |
| `students/[id]/report-cards/page.tsx` | List of cards, each linking to the print view | FR-36 |
| Config | `courseTabs`: `gradebook` (ADMIN, TEACHER) and `grades` (STUDENT, PARENT). `studentTabs`: `grades` and `report-cards`. `navigation`: the four entries from A4. | FR-18, FR-26–FR-28, FR-33, FR-36 |

Every page server-checks the role with `requireUser`/`requireRole` plus the same entity assert as its API (NFR-6). It never relies on hidden links.

### 2.5 Scripts and seed

- `package.json`: `"gradebook:backfill": "tsx scripts/gradebook-backfill.ts"`. The script calls `backfillGradebook()` and exits (FR-8, ADR-7).
- `prisma/seed.ts`:
  1. scale "Standard A–F" (default)
  2. Homework 30 (drop 1) / Quizzes 30 / Exams 40 for each 7A course
  3. `backfillGradebook()`
  4. ENG-7A manual item "Oral presentation" graded for all enrolled students
  5. Semester 1 `TermGradeOverride.teacherComment` for MATH-7A and ENG-7A
  6. `generateDrafts(S1, 7A students)`

  Categories go in before the backfill so seeded assignments and quizzes can be attached to them (FR-41).

---

## 3. Data Flow

### 3.1 Source → gradebook sync (write path)

```
Teacher publishes assignment ─► assignments-service (tx) ─► upsertItemFromAssignment(tx)
                                                              ├─ termFor(dueAt, courseYearTerms, tz)  → null ⇒ warn+skip
                                                              └─ GradeItem upsert by sourceId (isVisible only on transition)
Teacher returns submission  ─► gradeSubmission/bulkReturn/gradeOffline (tx)
                                  └─ status==RETURNED ? syncSubmissionGrade(tx): Grade upsert {score: finalScore,
                                                                                  excused: exemption exists}
Quiz attempt graded         ─► recomputeAttempt → commit → syncQuizGrade(quiz, student)
                                  └─ GRADED ∧ resultsVisible ∧ ¬isPractice ? getStudentQuizScore → scale to maxPoints → upsert
Results released / closed   ─► releaseResults | maintenance claim ─► syncQuizGrades(quiz)  (bulk, batched)
```

Because unreleased scores are **never written** into `Grade`, privacy holds at the storage layer as well as in serializers (NFR-5, layer 1 of 3).

Quiz scaling: `score = result.score / result.maxScore × GradeItem.maxPoints`, where `maxPoints = quiz maxScore`, in Decimal with `fixed2` at write.

### 3.2 Calculation (pure, `grade-calc.ts`)

```
input: { items[], grades by itemId, categories[], bands, override?, now }
counted(item) = item.isVisible ∧ ¬grade.excused ∧ (grade.score ≠ null ∨ (grade.missing ∧ item.dueAt ∧ now > item.dueAt))
earned = score ?? 0
per category: sort counted by pct asc (tie: dueAt, id) → drop min(dropLowest, n−1) → Σearned/Σmax×100
course: categories present with ≥1 counted ⇒ Σ(w·pct)/Σw   (Uncategorised w = 0, A8)
        no categories / none counted       ⇒ Σearned/Σmax×100 over all counted
        nothing counted                    ⇒ percent = null, letter = null ("—")
percent = round half-up to 1 dp (only here) → letter = first band with percent ≥ minPercent
override: percent? → replaces percent (letter re-derived unless letter set, A12); letter? → replaces letter only
```

The output per student is `{ categories: [{id, name, weight, percent, earned, possible, droppedItemIds}], percent, letter, descriptor, computedPercent, computedLetter, overridden }`. The gradebook, the student views and report-card generation all call this **one** function, which guarantees FR-15 / AC-1 (78.0% C+ in both places).

### 3.3 Gradebook read (NFR-2: 35×80 < 800 ms)

`GET gradebook` → `assertCanManageCourse` → `load.ts`:

1. active enrollments + students, sorted by last name
2. items `(courseId, termId)`
3. grades for those item ids
4. categories
5. override rows + course scale or default

Then two lookup queries for click-through and late flags: `Submission {id, isLate}` by `assignmentId in` and `QuizAttempt {id}` by `quizId in`. That's seven indexed queries in total. The pure calc runs for each student in memory, and the response is one denormalised payload. The client builds the columns, and the grid virtualises rows and columns.

### 3.4 Manual grade edit

```
cell edit ─► processRowUpdate ─► PUT /api/grade-items/:id/grades/:studentId
   service (tx): load old grade → reject non-comment fields if item.source ≠ MANUAL (FR-9)
                 → upsert → audit('grade.update', {old, new})
   after commit: old.score == null ∧ new.score ≠ null ∧ MANUAL ⇒ notifyStudentAndParents('grade.posted')  (A9)
   response: updated grade + recomputed student row (so the term % cell refreshes)
```

On error the client rolls back the optimistic value and flags the cell.

### 3.5 Report card lifecycle

```
generate {termId, studentIds} (ADMIN)
  ├─ load once: students (+section, homeroom, gradeLevel), school settings, term+year, default scale,
  │             enrollments for those students in courses of the term's year,
  │             load.ts for all those courseIds (in-filters), attendance getReport(term range) ×1
  ├─ compute in memory: grade-calc per (student, course) → buildSnapshot(v:1)
  └─ write (chunks of 100, tx): createMany(skipDuplicates) for new;
                                updateMany({ where:{ id, status:'DRAFT' }, data:{ snapshot, generatedAt } }) for existing
     PUBLISHED rows are filtered out by the WHERE clause, which enforces immutability (FR-31 / AC-8)
publish {ids}   ─► updateMany({ id in ids, status:'DRAFT' } → PUBLISHED, publishedAt, publishedById)
                   → audit('reportCard.publish') → after commit notify report_card.published per card
unpublish {ids, reason} ─► PUBLISHED → DRAFT, clear publishedAt/ById, audit('reportCard.unpublish', {old, new, reason})
print            ─► reads snapshot only; never recomputes
```

Nothing in `src/server/gradebook/` imports `src/server/report-cards/` or writes `ReportCard`. Grade edits therefore cannot touch snapshots.

**Snapshot v1 shape**, owned by `snapshotSchema`:

```
{ v: 1,
  school:     { name, logoUrl },
  student:    { name, admissionNumber, gradeLevel, section, homeroomTeacher },
  term:       { name, startDate, endDate, academicYear },
  courses:    [{ subject, code, teacher, percent, letter, descriptor, teacherComment }],
  attendance: { rate, absences, lates, ...counts },
  scale:      { name, bands } }
```

`attendance.rate` uses the same formula the existing attendance report consumers use; dev must not invent a new one (B13). Each course's letter uses that course's effective scale. The legend shows the default scale and also lists any course-specific scale used.

**Missing-data warnings (FR-29)** are computed in the same batched pass:

- a count of courses with eligible-but-ungraded items (visible, past due, no score, not missing, not excused)
- courses with no `teacherComment` override for the student

### 3.6 Student/parent read (privacy, NFR-5 layers 2 and 3)

`GET /api/students/:id/grades`: `assertCanViewStudent` → `load.ts` with `isVisible = true` filtered **in the query** → calc → serializer emits only whitelisted fields (no `updatedById`, no hidden items).

Report-card endpoints apply `assertCanViewReportCard`. STUDENT and PARENT pass only if `card.status === 'PUBLISHED'` and they're the student or a linked parent. Anyone else unauthorised gets **NOT_FOUND**, so a 7B student can't tell that Sam's card exists (AC-7).

---

## 4. Access Control Matrix (NFR-6)

| Action | ADMIN | TEACHER | STUDENT | PARENT |
|---|---|---|---|---|
| Read scales | ✓ | ✓ | ✓ | ✓ |
| Write scales | ✓ | — | — | — |
| Categories GET | ✓ | view course | view course | view course |
| Categories PUT | ✓ | teaches course | — | — |
| Gradebook / items / grades / overrides | ✓ | teaches course (`assertCanManageCourse`) | — | — |
| Student grades | ✓ | teaches student or is homeroom (existing student-access) | self | linked child |
| Report cards list / generate | list + generate | list: own homeroom sections | own published (via `studentId`) | child's published |
| Report card GET | ✓ | teaches any course of the student, or is homeroom | self, PUBLISHED only | linked, PUBLISHED only |
| `homeroomComment` PATCH | ✓ | homeroom teacher of the student's section, DRAFT only | — | — |
| `principalComment` PATCH | ✓ (DRAFT only) | — | — | — |
| Publish / unpublish | ✓ | — | — | — |

---

## 5. Cross-cutting

- **Audit (NFR-4):**
  - required: `grade.update` (manual, and comment edits on synced grades), `grade.markMissing`, `termOverride.upsert`, `reportCard.unpublish` (with reason), each carrying `{old, new}`
  - extra: `reportCard.publish`, `gradingScale.create/update/delete`, `gradeCategories.replace`
- **Notifications (FR-38):** sent after commit, using `notify()`, which never throws, so a notification failure can't roll back a grade.
- **Errors:** `AppError` codes `VALIDATION_ERROR` (weights ≠ 100, bad bands, non-MANUAL field edit, mark-missing before due), `CONFLICT` (scale in use, editing a PUBLISHED card), `NOT_FOUND`, `FORBIDDEN`.
- **Logging:** `logger` only, never `console.log` (NFR-9).
- **Timezone (NFR-10):** all date rules go through `getSchoolTimezone()` + `schoolToday`. UI dates use `DateDisplay`.
- **Out of scope (NFR-13):** no GPA computation, class rank, transcripts or standards-based grading.

---

## 6. Test Plan Mapping (NFR-12)

| Layer | File | Covers |
|---|---|---|
| Unit | `src/server/gradebook/grade-calc.test.ts` | no categories, empty categories, Uncategorised (A8), drop lowest (AC-2) and never-drop-all, missing vs ungraded vs excused (AC-5), past-due boundary, overrides (letter-only AC-6, percent-only A12), rounding 89.95 → 90.0 → A−, 77.0 → C+, the FR-15 golden 78.0 C+ |
| Unit | `term-placement.test.ts` | containment at tz day boundaries, current-term fallback, null |
| Integration | `gradebook-sync.test.ts` | return → Grade, save-without-return → none (AC-3), exemption on/off, quiz GRADED + IMMEDIATE / AFTER_CLOSE / MANUAL release, practice skipped, archive hides, delete removes, teacher hide survives re-save (A7) |
| Integration | `backfill.test.ts` | run twice → identical counts |
| Integration | `report-cards.test.ts` | generate → publish → edit grade → snapshot unchanged (AC-8), regenerate skips PUBLISHED, 7B student gets NOT_FOUND (AC-7), notifications sent |
| Integration | `perf` (optional, CI-skippable) | 35×80 gradebook < 800 ms, 600×8 generation < 30 s |
| Playwright | `gradebook.spec.ts`, `report-cards.spec.ts` | keyboard edits (digits, E, M, Delete, Enter/arrows), admin generate + publish, parent opens print view with sidebar hidden under print media |

---

## 7. Requirements Traceability

| Req | Design element(s) |
|---|---|
| FR-1 | §2.1 migration: PRD FR-1 models verbatim, plus indexes and the partial unique default index |
| FR-2 | §2.1 `Course.gradingScaleId`, `Assignment/Quiz.categoryId` (SetNull). §2.2 validator and editor `Select` hooks. |
| FR-3 | `gradebook-sync.upsertItemFromAssignment/Quiz`, `term-placement.termFor` (A6, A10). Hooks in §2.2. |
| FR-4 | `hideItemForSource`, `deleteItemForSource` (same transaction). A7, A15. |
| FR-5 | `syncSubmissionGrade` from `gradeSubmission` / `bulkReturn` / `gradeOffline`, only when RETURNED (§3.1) |
| FR-6 | `setExemption` → `syncSubmissionGrade` (A1) |
| FR-7 | `syncQuizGrade` after `recomputeAttempt` callers, `syncQuizGrades` on release and close, existing `getStudentQuizScore` + `resultsVisible` (A2) |
| FR-8 | `gradebook/backfill.ts`, `scripts/gradebook-backfill.ts`, npm script, seed call (§2.5) |
| FR-9 | `putGrade` / `updateItem` reject non-comment and non-`isVisible` fields on synced items. Grid `isCellEditable`. |
| FR-10 | `grade-calc.ts` `counted()` predicate (§3.2) |
| FR-11 | `applyDropLowest`, `categoryPercent` |
| FR-12 | course aggregation with renormalised weights, Uncategorised bucket, points fallback (A8) |
| FR-13 | `roundHalfUp1` + `letterFor`, `effectiveScale` (A3) |
| FR-14 | `applyOverride` (A12), `putTermOverride` |
| FR-15 | single shared calc for the gradebook and student views. Golden unit test. |
| FR-16 | `scales-service`, `/admin/grading-scales`, `bandsSchema`, partial unique index (A11) |
| FR-17 | `categories-service`, gradebook settings page with live sum, scale select |
| FR-18 | `GradebookGrid` (MIT DataGrid, column groups, virtualisation, sticky header), `getGradebook`, `courseTabs.gradebook` |
| FR-19 | `GradebookGrid` `renderCell`. The payload carries `isLate`. |
| FR-20 | `renderEditCell` + `onCellKeyDown` + `processRowUpdate`, PUT grade, optimistic update with per-cell error (§3.4) |
| FR-21 | payload `submissionId` / `attemptId` → links to the existing grading and attempt pages |
| FR-22 | `AddManualItemDialog`, `POST /api/courses/[id]/grade-items`, `createManualItem` |
| FR-23 | `TermOverrideDialog`, `PUT term-overrides`, `termOverrideSchema` (≤ 1000) |
| FR-24 | column menu: `PATCH isVisible`, `POST mark-missing`, `ItemStatsDialog` |
| FR-25 | `exportGradebookCsv` via `toCsv`, `?format=csv` |
| FR-26 | `StudentGradesView`, `studentTabs.grades`, `gradeColour` |
| FR-27 | `/grades` page with parent child select, nav entry (A4) |
| FR-28 | `courses/[courseId]/grades`, `courseTabs.grades` |
| FR-29 | `/admin/report-cards`, `listReportCards` with warnings (§3.5) |
| FR-30 | `generateDrafts`, `buildSnapshot` v1, attendance `getReport` |
| FR-31 | DRAFT-only `updateMany`. Gradebook never writes ReportCard (§3.5). |
| FR-32 | `report-cards/[id]` review page, `patchComments`, field-level access (§4, A13) |
| FR-33 | `/report-cards` homeroom list, TEACHER nav entry |
| FR-34 | `publish` / `unpublish`, notify after commit, audit with reason (A13) |
| FR-35 | print pages, `ReportCardDocument`, `@page` A4 + `@media print` GlobalStyles, `PrintButton` |
| FR-36 | `studentTabs['report-cards']`, `listForStudent` (PUBLISHED-only for student/parent) |
| FR-37 | `report-cards/access.assertCanViewReportCard` (NOT_FOUND for others) |
| FR-38 | `types.ts` registrations, `grade.posted` on first score (A9), `report_card.published` |
| FR-39 | §2.3 route table: `withHandler` → `validators/gradebook.ts` → services, existing course-access |
| FR-40 | `categories-service.replaceCategories` (transaction, `dec(sum).eq(100)`) |
| FR-41 | `prisma/seed.ts` sequence (§2.5) |
| FR-42 | `student-grades-service` (visible-only query + whitelist serializer) |
| NFR-1 | `grade-calc.ts` pure Decimal, single final rounding, unit matrix (§6) |
| NFR-2 | `load.ts` 7 indexed queries, in-memory calc, DataGrid virtualisation, `GradeItem(courseId, termId)` index |
| NFR-3 | batched `load.ts` with `in` filters, one attendance groupBy, chunked writes (§3.5) |
| NFR-4 | `audit()` calls listed in §5 with `{old, new}` |
| NFR-5 | three layers: sync gating (§3.1), visible-only serializer (§3.6), PUBLISHED-only card guard |
| NFR-6 | §4 matrix. Every route and server page calls `requireUser`/`requireRole` plus the entity asserts. |
| NFR-7 | §2.4 MUI-only components looked up via mui-mcp, `useToast`, `ConfirmDialog`/`Dialog`, `Autocomplete` |
| NFR-8 | `GradebookGrid` MIT props only, no pinned columns |
| NFR-9 | new code only in `src/server/gradebook/` and `src/server/report-cards/`, one-line hooks, reuse table (§2.2), `logger` |
| NFR-10 | `term-placement` (tz dates), instant past-due (A5), `DateDisplay` |
| NFR-11 | A4 `@page`, print media rules, `break-after` / `break-inside` |
| NFR-12 | §6 test plan |
| NFR-13 | `gpa` stored only. No rank or transcript components. |
