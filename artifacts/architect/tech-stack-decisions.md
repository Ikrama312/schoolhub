# Tech Stack Decisions: PRD-17 Fees, Invoices & Payment Records

Ticket: SH-17 · Phase: architect (arch-research-stack) · Timestamp: 2026-11-10T15:30:00Z · Status: complete

> This file replaces the SH-16 version. `system-design.md`, `api-contracts.json` and `handoff-to-dev-planning.json` in `artifacts/architect/` are still from SH-16 until their own sub-tasks rewrite them.

**Summary:** keep intake's detected stack (`react`, 98 %). It covers every FR and NFR, so **no new runtime or dev dependencies are needed**. These are already installed and pinned in `package.json`: Next.js 14.2.18 App Router, React 18.3.1, TypeScript strict, MUI 9.5.0 (`@mui/material`, `@mui/icons-material`, `@mui/x-data-grid`, `@mui/x-charts`, `@mui/x-date-pickers`), Prisma 5.20.0 on PostgreSQL 16, Auth.js 5.0.0-beta.25, Zod 3.23.8, React Hook Form 7.53.0, date-fns 3.6.0 with date-fns-tz 3.2.0, Vitest 2.1.1 and Playwright 1.47.2.

Checked in the codebase:
- No fee code exists yet.
- `src/server/assignments/grading-math.ts` already exports `Decimal`, `dec()` and `fixed2()` (ROUND_HALF_UP), using Prisma's bundled decimal.js.
- `src/server/email/dispatch.ts` already uses raw `FOR UPDATE` SQL.
- Two migrations already add **partial unique indexes** in raw SQL (`grading_scale_one_default`, `ConferenceSlot_one_per_teacher_per_child`).
- `src/server/http.ts` already defines the `RATE_LIMITED` (429) and `CONFLICT` (409) error codes.
- `src/lib/dates.ts` has `schoolDateOf`, `schoolMidnight` and `addDateDays`.
- `src/server/csv.ts` has `toCsv`.
- Print styles already follow the `sx` `'@media print'` pattern (`ReportCardDocument.tsx`, conference day page).
- `tests/integration/` already runs against a real Postgres database.

---

## ADR-1: Keep the existing stack and add no dependencies

**Context:** NFR-9 (brownfield reuse), NFR-6 (MUI-only UI, no banned libraries), NFR-10 (lint, typecheck and test stay green) and NFR-11 (no payment gateways, no accounting integrations). The features need CRUD, transactional money writes, tables, charts, CSV export, print layouts and notifications. The installed stack covers all of them.

**Decision:** No new packages. Specifically, do **not** add:
- `decimal.js` or `big.js` (see ADR-2)
- a number-to-words package (see ADR-8)
- a PDF library such as pdfkit, react-pdf or puppeteer (see ADR-9)
- a job queue or cron library (see ADR-7)
- a chart library other than `@mui/x-charts`

**Consequences:** No lockfile churn and no new supply-chain surface. Every new UI element must be checked against the MUI MCP docs (NFR-6). Server-side PDF generation stays out of scope; the browser's "Save as PDF" covers FR-33 and FR-34.

## ADR-2: Money is Prisma `Decimal(10,2)`, sent as 2-decimal strings, with shared helpers

**Context:** FR-2 (Decimal(10,2) columns), FR-15 (half-up rounding, total never below 0), NFR-1 (no JS float arithmetic). The gradebook already solved this. `grading-math.ts` imports `Decimal` from `@prisma/client/runtime/index-browser.js` (isomorphic, already shipped). `src/lib/validators/gradebook.ts` accepts `number | string` and outputs `"18.00"` via `fixed2`.

**Decision:**
- All money columns are `@db.Decimal(10, 2)`.
- Every server calculation uses `Decimal`: subtotals, percent and fixed discounts, allocation, balances, aging sums and dashboard KPIs.
- Aggregates use Prisma `aggregate`/`groupBy` `_sum`, which returns `Decimal`, or SQL `SUM(...)::text`. They never go through `Number`.
- Money leaves the API as a 2-decimal **string** (`"2235.00"`). The client only formats it (ADR-10) and never adds it up.
- Live form previews, such as the allocation editor and invoice line totals, use the same isomorphic `Decimal`.
- Reuse `dec`/`fixed2` and the `decimal()` Zod helper pattern. Put a small `src/lib/money.ts` in the fees feature that re-exports `dec`, `fixed2` and `Decimal` from `grading-math.ts`, plus `sumMoney` and `formatMoney` (ADR-10). Do not write a second Decimal wrapper.

**Consequences:** FR-49 unit tests use the intake fixtures (AC1 = `2235.00`, AC2 = `−107.50`) as exact string comparisons. Lint and review must reject `parseFloat` and `Number(` in `src/server/fees/**`. Charts (ADR-11) receive `Number(fixed2(x))` only at the presentation edge, which is acceptable because no further arithmetic happens there.

## ADR-3: Gap-free document numbers come from a `DocumentSequence` row lock, not a Postgres SEQUENCE

**Context:** FR-16 requires `INV-YYYY-NNNNNN` and `RCT-YYYY-NNNNNN`, sequential per year, unique and **gap-free** under concurrency. NFR-3 and FR-50 add the concurrency requirement and its integration test. A native Postgres `SEQUENCE` is not transactional: `nextval` is never rolled back, so a failed transaction leaves a gap. Prisma 5.20 has no row-lock API.

**Decision:** Each number is allocated inside the same `prisma.$transaction(async (tx) => …)` that issues the invoice or saves the payment. The helper `nextDocumentNumber(tx, kind, year)` lives in `src/server/fees/` and does three things:
1. `tx.$executeRaw` `INSERT INTO "DocumentSequence" (kind, year, "nextValue") VALUES (…, 1) ON CONFLICT (kind, year) DO NOTHING`. This makes creating a new year's row race-safe.
2. `tx.$queryRaw` `SELECT "nextValue" FROM "DocumentSequence" WHERE kind = … AND year = … FOR UPDATE`.
3. Increment the value and format it with `padStart(6, '0')`.

`year` is the calendar year of the issue date or received date **in the school timezone** (NFR-8). The pattern follows the existing raw `FOR UPDATE` in `src/server/email/dispatch.ts`.

**Consequences:** Number allocation is serialized per (kind, year). A rollback also rolls back the increment, so no gaps. This is the deliberate throughput ceiling. At school scale (hundreds of invoices per term), the row lock stays well inside NFR-5. FR-50 tests this with `Promise.all` over N parallel issues and payments against real Postgres, asserting the numbers form exactly the range 1..N.

## ADR-4: Lock invoice rows and recompute `amountPaid` from allocations in every write transaction

**Context:** NFR-1 (`amountPaid` = Σ non-reversed allocations), FR-24 (status recomputed in the same transaction), FR-28 and FR-29 (no allocation above the balance, and overpayment refused), FR-31 (reversal recomputes). Two bursars recording payments for the same family at the same time could both read the same balance.

**Decision:** Payment save, reversal, adjustment and void each run in one interactive transaction:
1. Lock every affected invoice with `SELECT … FROM "Invoice" WHERE id IN (…) ORDER BY id FOR UPDATE`. A deterministic lock order prevents deadlocks.
2. Re-validate balances against the locked rows. On failure, throw `AppError('VALIDATION_ERROR', …)` with the FR-29 message, so nothing is saved.
3. Write the rows.
4. Call a single `recomputeInvoice(tx, invoiceId, today)`. It sets `amountPaid = SUM(PaymentAllocation.amount WHERE payment.reversedAt IS NULL)`, derives status per FR-24, and calls `audit()` with before and after values (NFR-2).

Nothing increments `amountPaid` directly.

**Consequences:** There is one source of truth and one function to unit-test (FR-49 status transitions) and integration-test (FR-50 random payment and reversal sequences). Postgres's default READ COMMITTED isolation is enough because the rows are explicitly locked. SERIALIZABLE and its retry loops are not needed.

## ADR-5: Partial unique indexes in raw migration SQL enforce the "one plan invoice per student per term" rule and annual plan uniqueness

**Context:** FR-13 (generation never creates a second invoice, even when two bursars run it in parallel), NFR-3, and the intake warning that `FeePlan @@unique([termId, gradeLevelId])` does not cover annual plans (`termId NULL`). Prisma 5.20 cannot express partial indexes. The repo already adds them by hand in `migration.sql` (gradebook and PRD-15 migrations).

**Decision:** The fees migration adds these indexes in raw SQL, each with a `-- Prisma can't express partial indexes` comment:
- `Invoice (studentId, termId) WHERE "feePlanId" IS NOT NULL AND status <> 'VOID' AND "termId" IS NOT NULL`
- `Invoice (studentId, academicYearId) WHERE "feePlanId" IS NOT NULL AND status <> 'VOID' AND "termId" IS NULL` (annual plans)
- `FeePlan (academicYearId, gradeLevelId) WHERE "termId" IS NULL`
- `Invoice.number` is `String? @unique`. Postgres allows multiple NULLs, so DRAFT invoices have no number until they are issued (the intake default).

Generation still pre-filters to produce the "Skipped — already invoiced" preview (FR-12, FR-13). The index is the backstop. A `P2002` during generation is reported as a skip, not a failure. Manual invoices (`feePlanId` NULL) are never blocked (the intake default).

**Consequences:** Duplicate protection lives in the database, so it holds even under races. The design must include the exact column names, such as `feePlanId` and `academicYearId` on Invoice, so these indexes can be written.

## ADR-6: Bulk generation runs in batched transactions, so NFR-5 holds without a background job

**Context:** NFR-5 requires a whole term's invoices for every student in under 5 minutes end to end. FR-14 includes "Create and issue". The volume is at most a few thousand students, and the platform has no job queue (ADR-1).

**Decision:** `POST /api/fees/invoices/generate` runs synchronously in chunks of about 50 students, one interactive transaction per chunk. Each chunk does the following:
1. Allocate numbers through ADR-3. The lock is held only for that chunk.
2. Write the invoices and lines with `createMany`.
3. Write one audit row per invoice.

Notifications go through the existing `notify()` outbox *after* each chunk commits. Set an explicit `$transaction` timeout (for example 30 s) on chunk transactions.

**Consequences:** Partial progress is safe. Re-running skips the students already invoiced (ADR-5), so a retry is idempotent. If a school ever outgrows this, move to the existing email-worker pattern. *ponytail: synchronous chunked generation, move to a worker if a term is ever more than ~5k students.*

## ADR-7: Hook overdue transitions and reminders into the existing maintenance pass; make them idempotent with InvoiceReminder

**Context:**
- FR-25 says OVERDUE is applied both in the daily run and on read.
- FR-37 defines the automatic reminders: 3 days before the due date, due date + 1, and every 14 days after that. No reminder may be sent twice.
- FR-38 allows one manual reminder per 24 hours per invoice, answered with 429.
- FR-3 adds the InvoiceReminder model.
- The maintenance pass is in `src/app/api/internal/email/dispatch/route.ts`.
- `src/server/rate-limit.ts` is an in-process Map. It is per-process and lost on restart.

**Decision:**
- **Overdue:** `markOverdue(today)` runs one `updateMany` (`status IN (ISSUED, PARTIALLY_PAID) AND dueDate < today` → OVERDUE). It runs in the maintenance pass **and** at the start of every fee read service (lists, detail, `/api/me/fees`, dashboard). It is a single indexed UPDATE, so it is cheap. `today` is `schoolDateOf(now, settings.timezone)`.
- **Automatic reminders:** InvoiceReminder `{ id, invoiceId, kind, scheduledFor @db.Date?, sentAt }` with `@@unique([invoiceId, kind, scheduledFor])`. The maintenance pass computes each due reminder date. It sends only if `create` succeeds; on `P2002`, it skips. The database guarantees "never twice", even with overlapping runs.
- **Manual reminders:** stored with `kind = MANUAL` and `scheduledFor = NULL`. Because NULLs do not conflict, the unique constraint does not apply. The throttle is a DB check (`sentAt > now − 24h`, done inside a transaction that holds a row lock on the invoice) → `AppError('RATE_LIMITED')` / 429 (the intake default). Do **not** use `rateLimit()` for this business rule, because it does not survive a restart or a second instance.

**Consequences:** No new scheduler is needed. The exact model shape is for `arch-design-system` to confirm, but it must keep a DB-enforced idempotency key.

## ADR-8: Amount in words is a hand-written pure function

**Context:** FR-34 ("One thousand two hundred forty dollars and 00/100"), FR-49 (unit tested). Intake default: USD wording, with the ISO code as the unit name for other currencies. NFR-11 rules out multi-currency.

**Decision:** Write `amountInWords(amount: string, currency: string)` as about 40 lines in `src/lib/money.ts`. It handles 0–999,999,999.99 and English only. The input is the 2-decimal string from ADR-2, split on `.`, so no floats are involved. Major unit: `dollars` for USD, otherwise the ISO code. The minor part is written as `NN/100`.

**Consequences:** No i18n dependency. Covering other locales or currencies would mean replacing this function. That is out of scope (NFR-11).

## ADR-9: Print with the browser and `@media print` through `sx`, not a PDF library

**Context:** FR-33 and FR-34 (A4 print pages with a `window.print()` button), NFR-12 (theme or `sx` print styles only, no CSS modules). `ReportCardDocument.tsx` already uses this pattern.

**Decision:**
- `/fees/invoices/[id]/print` and `/fees/receipts/[paymentId]/print` are server components that load data through the access-checked fee service (NFR-4).
- A small client `PrintButton` calls `window.print()`.
- Page CSS uses `sx={{ '@media print': … }}` to hide the app chrome and the `no-print` class, and to set A4 margins (`'@page': { size: 'A4', margin: '15mm' }` through MUI `GlobalStyles` on that page only).

**Consequences:** The output looks the same in every browser's "Save as PDF". There are no server-side rendering costs. E2E (FR-51) asserts the page renders and the button exists. It does not check the PDF bytes.

## ADR-10: Format money with `Intl.NumberFormat` in `SchoolSettings.currency`

**Context:** FR-4 (`currency` default `"USD"`, ISO 4217), FR-35, FR-29 (the error message contains the formatted amount).

**Decision:** `formatMoney(amount: string, currency: string, locale = 'en-US')` in `src/lib/money.ts` wraps a cached `Intl.NumberFormat(locale, { style: 'currency', currency })`. It is used both server-side (the FR-29 error message, CSV is *not* formatted) and client-side. The currency comes from settings with every fee API response, or the layout passes it down. Nothing is hard-coded to `$`.

**Consequences:** CSV exports (ADR-12) keep raw 2-decimal strings plus a currency column, so spreadsheets can still do arithmetic on them.

## ADR-11: UI uses MUI X DataGrid through the existing `DataTable`, MUI X Charts, and MUI X Date Pickers

**Context:** FR-17 and FR-18 (server-side table with filters and a totals row), FR-42 (KPI cards, weekly trend, aging buckets, top 10 overdue), FR-43 (StatCard), FR-27 (received date and time), FR-44 (date-range filters), NFR-6, NFR-9.

**Decision:**
- Invoice and payment lists use the existing `src/components/DataTable` in server mode (page, pageSize ≤ 100, sort, q per NFR-7).
- The filtered totals row comes from a separate `aggregate` in the same list response and is rendered below the grid as a summary bar. Do not use pinned rows; they are a Pro feature, and the repo has the community grid.
- KPIs use the existing `StatCard`.
- The weekly collection trend is `LineChart` from `@mui/x-charts`. Aging buckets are `BarChart`. `@mui/x-charts` is already used in `QuizAnalytics.tsx` and the PRD-16 dashboards.
- `receivedAt` uses `DateTimePicker` with the existing `LocalizationProvider` setup. Export date ranges use two `DatePicker`s, because the range picker is Pro.
- Toasts use the existing `useToast`. Void and reverse confirmations use `ConfirmDialog`.

**Consequences:** No Pro license and no banned libraries. Every component and prop must be checked against the MUI MCP docs during development (NFR-6). QA's banned-import scan stays clean.

## ADR-12: Reuse `src/server/csv.ts`, `audit()`, `notify()` and `requireRole`; check the bursar flag from the database

**Context:**
- FR-44: CSV exports.
- NFR-2: audit every mutation.
- FR-36: three `fees.*` notification types in the existing FINANCE category.
- FR-45 and FR-5: writes require ADMIN with `isBursar`; teachers and students get 403.
- NFR-4: every ID in a URL is access-checked.
- NFR-9: reuse existing helpers.

**Decision:**
- **CSV:** `toCsv()` from `src/server/csv.ts`, which already escapes cells against formula injection. Responses are `text/csv` with `Content-Disposition`. This holds up to the existing export row cap.
- **Notifications:** register the three types in `src/server/notifications/types.ts` and send through `notify()`.
- **Auth:** routes use `requireRole('ADMIN', 'PARENT')` as usual. A new `requireBursar(session)` re-reads `User.isBursar` **from the database** on every write, so revoking the flag takes effect immediately.
- **Parent scope:** `assertParentCanSee(parentId, studentId | invoiceId | paymentId)` uses the existing `ParentStudentLink` lookup used by `src/server/parent/overview-service.ts`.

**Gotcha:** `escapeCsvCell` adds an apostrophe before any cell starting with `-`. Negative money values in exports would become text (`'-107.50`) and stop being numbers in a spreadsheet. Affected values: discount and adjustment lines, and any negative totals. Export the aging, invoice and payment CSVs with non-negative columns only: balances, totals, paid amounts, and reversed payments as a status column, not a negative amount. Do not weaken the injection guard.

**Consequences:** One permission module (`src/server/fees/access.ts`) is unit- and integration-tested for the FR-45 matrix (bursar admin / admin / teacher / parent / student). There is no new auth infrastructure.

## ADR-13: Use the existing date helpers (date-fns-tz plus `src/lib/dates.ts`) for school-timezone dates

**Context:** NFR-8 (UTC timestamps; `issueDate` and `dueDate` are `@db.Date`; all date rules use `SchoolSettings.timezone`). Affected rules: FR-14 (due date = today + `dueDays`), FR-24, FR-25 and FR-37 (overdue and reminder schedule), FR-42 (aging buckets and weekly trend).

**Decision:**
- "Today" is always `schoolDateOf(new Date(), tz)` (a `YYYY-MM-DD` string).
- Due dates come from `addDateDays(today, plan.dueDays)`.
- `@db.Date` values are written as `new Date(dateStr + 'T00:00:00Z')`, so the stored calendar date matches the school's calendar date regardless of server TZ.
- Aging days are the difference between two `YYYY-MM-DD` strings.
- Weekly trend buckets are ISO weeks of `schoolDateOf(receivedAt, tz)`.

**Consequences:** DST and UTC-offset edge cases are handled in one place. Unit tests (FR-49) pin `tz` to a non-UTC zone, for example `America/New_York`, to catch off-by-one-day errors.

## ADR-14: Test with the existing tools only (Vitest unit and integration, Playwright e2e)

**Context:** FR-49, FR-50, FR-51, NFR-10.

**Decision:**
- Pure logic goes in `src/server/fees/fee-math.ts`: discount order, sibling detection, oldest-first allocation, status derivation. `amountInWords` stays in `src/lib/money.ts`. Unit tests for both go in `tests/unit/fees/`.
- Concurrency, reversal and the `amountPaid` integrity check go in `tests/integration/fees/` against real Postgres, matching the existing `tests/integration/*`. The integrity check is a seeded-random sequence; a hand-written loop with a fixed seed is enough, so no property-testing library is added.
- `tests/e2e/fees.spec.ts` covers the bursar → parent flow and reuses `tests/e2e/helpers`.

**Consequences:** `npm run lint && npm run typecheck && npm run test` stays the regression gate (NFR-10). The FR-50 concurrency test must use separate Prisma transactions, not a single shared `tx`, or the lock is never contended.

---

## Requirement coverage by ADR

| ADR | Requirement ids |
|---|---|
| 1 | NFR-6, NFR-9, NFR-10, NFR-11 |
| 2 | FR-2, FR-15, NFR-1 |
| 3 | FR-16, FR-50, NFR-3, NFR-8 |
| 4 | FR-24, FR-28, FR-29, FR-31, NFR-1, NFR-2 |
| 5 | FR-7, FR-13, NFR-3 |
| 6 | FR-14, NFR-5 |
| 7 | FR-3, FR-25, FR-37, FR-38, NFR-8 |
| 8 | FR-34, FR-49, NFR-11 |
| 9 | FR-33, FR-34, NFR-12, NFR-4 |
| 10 | FR-4, FR-29, FR-35 |
| 11 | FR-17, FR-18, FR-27, FR-42, FR-43, FR-44, NFR-6, NFR-7, NFR-9 |
| 12 | FR-5, FR-36, FR-44, FR-45, NFR-2, NFR-4, NFR-9 |
| 13 | FR-14, FR-24, FR-25, FR-37, FR-42, NFR-8 |
| 14 | FR-49, FR-50, FR-51, NFR-10 |

## Notes for `arch-design-system`

- Intake reported **no blockers**. Its 8 defaults from the unresolved clarifications are adopted above where they affect stack choices: nullable `Invoice.number`, the InvoiceReminder shape (extended with `scheduledFor` for DB-level idempotency), annual plan uniqueness (now a partial index rather than a service check), the skip rule, and the 429 throttle code.
- Fee models get `createdAt` and `updatedAt`, following the platform convention (intake default).
- The sibling ordering default (`enrollmentDate` ascending, tie-break older `dateOfBirth` first) is a domain rule, not a stack decision. Carry it into the design as stated.
