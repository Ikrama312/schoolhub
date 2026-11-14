# Coverage Report — SH-17 (PRD-17 Fees, Invoices & Payment Records)

> This file replaces the SH-15 coverage report.

## Method

- No coverage instrumentation is installed (`@vitest/coverage-v8` is not a dependency, and QA adds no dependencies). Coverage is measured **per exported function and route**: a function counts as covered when at least one test calls it directly, or calls it through a route handler or the e2e flow.
- DB suites ran with `TEST_DATABASE_URL=$DATABASE_URL` (local Postgres :5433). E2E ran against `next start -p 3200` with `APP_URL=http://localhost:3200`.

## Tests for SH-17

| Suite | Tests | Author | Result |
|---|---|---|---|
| `tests/unit/fees/fee-math.test.ts` | 14 | Dev | pass |
| `tests/unit/fees/money.test.ts` | 9 | Dev | pass |
| `tests/unit/fees/qa-sh17-email.test.ts` | 2 (1 is `it.fails`, a known defect) | **QA** | pass |
| `tests/integration/fees/access.test.ts` | 4 | Dev (cleanup hardened by QA) | pass |
| `tests/integration/fees/numbering.test.ts` | 2 | Dev (cleanup hardened by QA) | pass |
| `tests/integration/fees/ledger.test.ts` | 5 | Dev (cleanup hardened by QA) | pass |
| `tests/integration/fees/qa-sh17.test.ts` | 7 | **QA** | pass |
| `tests/e2e/fees.spec.ts` | 1 | Dev | pass |
| **Total** | **44** | | **44/44** (unit and integration fee suites stable across 5 consecutive runs) |

## Server code (`src/server/fees/*`, `src/lib/money.ts`)

| Module | Exported functions | Covered | Not covered |
|---|---|---|---|
| `fee-math.ts` | 11 | 11 | — |
| `money.ts` | 4 | 4 | — |
| `ledger.ts` | 6 | 6 | — |
| `access.ts` | 9 | 9 (through the route handlers in `access.test`) | — |
| `maintenance.ts` | 4 | 3 (`markOverdue` via on-read refresh, `parentsOf`, `notifyReminder` via `remindInvoice`) | `sendInvoiceReminders` (see note 1) |
| `fees-service.ts` | 41 | 34 | `updateFeeItem`, `archiveFeeItem`, `listPlans`, `listDiscounts`, `archiveDiscount`, `getFamilyOpenInvoices` (e2e only), `listPayerOptions` (e2e only) |
| `reports.ts` | 17 | 12 | `getAging` (bucketing is unit-tested through `agingBucket`), `exportPaymentsCsv`, `exportAgingCsv`, `outstandingTotal`, `csvResponse` only through `exportInvoicesCsv` |
| **Total** | **92** | **≈79 (≈86%)** | 13 |

**What the QA suite adds** (`qa-sh17.test.ts`), none of it previously tested:
- generation from plans: preview, sibling ranks 1/2/3/none, AC1 `2235.00`, AC2 `-107.50`, D-5 "most specific rule only", issue numbers and dates (including a leap year), `invoice_issued` notifications, audit rows, the re-run skip, and the rule that manual invoices don't cause a skip
- setup: `replacePlan` replaces lines; guards for percent > 100, non-optional optional fees and auto discounts assigned manually; `bulkAssignOptionalFee`
- the draft lifecycle: `updateDraft`, `issue`, `deleteDraft`, plus 409 once issued
- `remindInvoice`: the 24 h throttle (429), and the `InvoiceReminder` unique key used for idempotency
- the on-read OVERDUE refresh, through `getInvoice` and `listInvoices(overdue)`
- `listPayments` scoped to a parent; the "other" parent sees nothing
- `outstandingByStudent`; `getDashboard` billed/collected/12-week trend; the invoice CSV header and rows

### Notes
1. `sendInvoiceReminders(now)` and `markOverdue(today)` with an injected date act on **every** invoice in the DB. Running them with a fake date against the shared dev DB would corrupt seed data. Their logic is covered by `reminderSlot`/`deriveStatus` unit tests plus the unique-key test. A test for them needs an isolated DB.
2. Line and branch coverage are not measured.

## API routes (`src/app/api/fees/**`, `src/app/api/me/fees`)

There are 33 route files. Handlers called directly by integration tests: items GET/POST, invoices GET, invoice GET, void POST, payment GET, `me/fees` GET, export/invoices GET. Handlers exercised through e2e: generate/preview, payments POST, open-invoices. The rest are thin `withHandler` + Zod wrappers over covered service functions. They pass typecheck and lint, and the build marks them dynamic.

## UI (`src/components/fees/*`, `src/app/(app)/admin/fees/**`, `src/app/(app)/fees/**`)

There are no component unit tests. E2E covers the generate page, record payment page, receipt print page and parent `/fees` page. A static scan of every fee UI file found only `@mui/*`, `next/*`, `react`, `date-fns` and internal imports, with no banned libraries. Not exercised by any test: the setup tabs UI, invoice detail actions, the manual invoice dialog, the fees dashboard page and the invoice print page.

## Gaps worth adding later
- an isolated-DB test for `sendInvoiceReminders` (pre-due, due+1, every 14 days, no duplicates)
- a test that the aging/payments CSVs and `getAging`'s top-10 families agree with the dashboard
- an RTL test for `AllocationEditor` (auto-allocation and the sum check)
