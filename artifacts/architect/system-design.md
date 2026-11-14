# System Design: PRD-17 Fees, Invoices & Payment Records

Ticket: SH-17 · Phase: architect (arch-design-system) · Timestamp: 2026-11-10T15:45:00Z · Status: complete

Inputs: `artifacts/intake/requirements.json` (FR-1 to FR-51, NFR-1 to NFR-12), `artifacts/intake/handoff-to-architect.json`, `artifacts/architect/tech-stack-decisions.md` (ADR-1 to ADR-14), `artifacts/architect/requirements-analysis-notes.md`, `artifacts/architect/threat-model-notes.json`. The SH-16 version of this file was moved to `artifacts/architect/.prev-SH-16/system-design.md`. `api-contracts.json` and `handoff-to-dev-planning.json` in this folder are still SH-16 until `arch-api-contracts` rewrites them.

---

## 1. Overview

PRD-17 adds school fees to SchoolHub: fee setup (items, plans, discounts, optional fees), invoice generation and management, payment recording with allocation, reversal, printable invoices and receipts, reminders, a parent fees page and a fees dashboard with CSV exports. It is a brownfield feature on the existing Next.js 14 App Router / Prisma / MUI 9 stack. **No new dependencies** (ADR-1).

**Intake status:** `handoff-to-architect.json` reports **no blockers** (confidence 92 %). Its 11 warnings and 8 unresolved clarifications are resolved by the decisions in §1.2. The PRD ticket id is SCH-017; artifacts use SH-17.

### 1.1 Architectural shape

```
Pages (src/app/(app)/admin/fees/**, src/app/(app)/fees/**)       ← MUI only (NFR-6)
   │ fetch JSON (money as "0.00" strings)
Route handlers (src/app/api/fees/**, src/app/api/me/fees)         ← thin: withHandler + Zod + guard (NFR-7)
   │
src/server/fees/
   access.ts        requireBursar, fee read guard, parent scope       (FR-45, NFR-4)
   fees-service.ts  setup, invoices, payments (public service API)    (NFR-7)
   ledger.ts        nextDocumentNumber, lockInvoices, recomputeInvoice, issueInvoice (FR-16, FR-24, NFR-1/3)
   fee-math.ts      PURE: discounts, sibling rank, allocation, status, reminder slot (FR-49)
   reports.ts       list totals, dashboard, aging, CSV, /me/fees summary
   maintenance.ts   markOverdue, sendInvoiceReminders                  (FR-25, FR-37)
src/lib/money.ts    dec/fixed2/Decimal re-export, sumMoney, formatMoney, amountInWords (isomorphic)
src/lib/validators/fees.ts   Zod schemas shared by routes and forms
   │
Prisma / PostgreSQL 16  (Decimal(10,2), FOR UPDATE row locks, partial unique indexes)
```

Existing helpers reused, never duplicated (NFR-9): `requireRole` / `requirePageRole`, `withHandler`/`AppError`/`paginated`/`parseQuery`/`parseBody` (`src/server/http.ts`), `audit()`, `notify()`, `toCsv()` (`src/server/csv.ts`), `schoolDateOf`/`addDateDays`/`schoolMidnight` (`src/lib/dates.ts`), `dec`/`fixed2` (`src/server/assignments/grading-math.ts`), `getAccessibleStudentIds` (`src/server/auth/student-access.ts`), `DataTable`, `StatCard`, `ConfirmDialog`, `PageHeader`, `useToast`, `logger`.

### 1.2 Design decisions on intake's open points

| # | Topic | Decision | Req ids |
|---|---|---|---|
| D-1 | Draft numbers | `Invoice.number String? @unique`, assigned at issue. `Payment.receiptNumber String @unique` (always assigned on save). | FR-2, FR-14, FR-16 |
| D-2 | InvoiceReminder | `{ id, invoiceId, kind InvoiceReminderKind, scheduledFor @db.Date?, sentAt, sentById? }`, `@@unique([invoiceId, kind, scheduledFor])`. Kinds `PRE_DUE_3D, DUE_PLUS_1, OVERDUE_14D, MANUAL`. Auto kinds always set `scheduledFor`; MANUAL leaves it NULL (ADR-7). | FR-3, FR-37, FR-38 |
| D-3 | Annual plan uniqueness | PRD `@@unique([termId, gradeLevelId])` kept + raw partial unique index `FeePlan(academicYearId, gradeLevelId) WHERE termId IS NULL` (ADR-5). | FR-7 |
| D-4 | Sibling order | Siblings = non-archived STUDENT users linked to the **same primary parent** (`ParentStudentLink.isPrimary`). Order `StudentProfile.enrollmentDate` asc, tie-break `dateOfBirth` asc (older first), then `id`. Rank is 1-based. | FR-11 |
| D-5 | Sibling rule at rank ≥ 3 | Apply only the most specific active rule: rank ≥ 3 → SIBLING_3RD_PLUS if an active discount with that rule exists, else SIBLING_2ND; rank 2 → SIBLING_2ND. Never both. | FR-11, FR-15 |
| D-6 | createdAt/updatedAt | Added to every fee model except the pure join/ledger rows (`FeePlanLine`, `InvoiceLine`, `PaymentAllocation`, `DocumentSequence`, `InvoiceReminder`) which get `createdAt` only. | FR-2 |
| D-7 | Skip rule | A student is "already invoiced" when a non-VOID invoice with `feePlanId IS NOT NULL` exists for the same student and `termId` (annual: same `academicYearId` with `termId IS NULL`). Manual invoices never cause a skip. Enforced by partial unique indexes (ADR-5). | FR-13, NFR-3 |
| D-8 | Throttle | Manual reminder: 429 `RATE_LIMITED` when a `MANUAL` InvoiceReminder for the invoice has `sentAt > now − 24h`. Automatic reminders do not block a manual one. | FR-38 |
| D-9 | Amount in words | English; `dollars` for USD, otherwise the ISO code; minor part as `NN/100` (ADR-8). | FR-34 |
| D-10 | Adjustment guard | An adjustment line is negative, requires a reason, and is rejected (`VALIDATION_ERROR`) if the new total would be `< amountPaid` or `< 0` (no credit balances, NFR-11). | FR-21, NFR-11 |
| D-11 | Void guard | Void allowed when the invoice has **no non-reversed** allocations (reversed payments no longer count, FR-31). DRAFT invoices are deleted, not voided. | FR-20, FR-21, NFR-2 |
| D-12 | Optional fees per invoice | A `StudentOptionalFee` assigned for an academic year is billed at its amount on **each plan invoice** generated for that student in that year (term invoices and annual). Optional lines are excluded from the percent-discount base. *Assumption — confirm with the PRD owner; change point is one function (`buildInvoiceDraft`).* | FR-9, FR-12, FR-15 |
| D-13 | Audit and transactions | `audit()` writes through the global client and never throws (existing helper). Fee services collect `{action, entityId, before, after}` inside the transaction and call `audit()` for each **after commit**, matching the existing "call after a successful mutation" convention. Same for `notify()`. | NFR-2, FR-30, FR-36 |
| D-14 | Bursar flag | Mirrors `isSafeguardingLead`: set via the existing users service/validator (ADMIN-only, audited), read **from the DB** on every write (`requireBursar`), and loaded in `src/app/(app)/layout.tsx` to show/hide write buttons. | FR-5, FR-45 |

---

## 2. Component Breakdown

### 2.1 Data model (one migration `prisma/migrations/<ts>_fees/`)

Field names below are the design contract; where the PRD FR-1 block lists extra fields, the PRD wins. All money columns `Decimal @db.Decimal(10, 2)` (NFR-1).

**Enums (FR-1, D-2):** `InvoiceStatus { DRAFT ISSUED PARTIALLY_PAID PAID OVERDUE VOID }`, `PaymentMethod { CASH BANK_TRANSFER CHEQUE CARD_TERMINAL OTHER }`, `DiscountKind { PERCENT FIXED }`, `InvoiceReminderKind { PRE_DUE_3D DUE_PLUS_1 OVERDUE_14D MANUAL }`.

| Model | Key fields | Constraints / indexes | Req |
|---|---|---|---|
| FeeItem | name, code, description?, defaultAmount, isOptional, archivedAt? | `code @unique` | FR-2, FR-6 |
| FeePlan | name, academicYearId, termId?, gradeLevelId, dueDays Int @default(30), archivedAt? | `@@unique([termId, gradeLevelId])` + partial `(academicYearId, gradeLevelId) WHERE termId IS NULL` | FR-2, FR-7 |
| FeePlanLine | feePlanId, feeItemId, amount | `@@unique([feePlanId, feeItemId])`, cascade on plan | FR-2, FR-7 |
| StudentOptionalFee | studentId, academicYearId, feeItemId, amount | `@@unique([studentId, academicYearId, feeItemId])` | FR-2, FR-9 |
| Discount | name, kind, value (percent 0–100 or fixed amount), autoRule? (`SIBLING_2ND`/`SIBLING_3RD_PLUS`, Zod-validated), archivedAt? | `@@index([autoRule])` | FR-2, FR-8, FR-11 |
| StudentDiscount | studentId, academicYearId, discountId, note? | `@@unique([studentId, academicYearId, discountId])` | FR-2, FR-10 |
| Invoice | number?, studentId, academicYearId, termId?, feePlanId?, status, issueDate @db.Date?, dueDate @db.Date?, subtotal, discountTotal, total, amountPaid @default(0), notes?, voidedAt?, voidReason?, createdById | `number @unique`; `@@index([status, dueDate])`, `@@index([studentId])`, `@@index([termId])`, `@@index([academicYearId])`; partial uniques per D-7 | FR-2, FR-13, FR-16, FR-17 |
| InvoiceLine | invoiceId, feeItemId?, discountId?, description, amount (negative for discounts/adjustments), isOptional, isDiscount, isAdjustment, reason?, sortOrder | `@@index([invoiceId])`, cascade on invoice (only DRAFTs are ever deleted) | FR-2, FR-15, FR-21 |
| Payment | receiptNumber, amount, method, reference?, receivedAt, payerName, payerParentId?, notes?, recordedById, reversedAt?, reversedById?, reversalReason? | `receiptNumber @unique`, `@@index([receivedAt])`, `@@index([payerParentId])` | FR-2, FR-27, FR-31 |
| PaymentAllocation | paymentId, invoiceId, amount (> 0) | `@@unique([paymentId, invoiceId])`, `@@index([invoiceId])` | FR-2, FR-28 |
| DocumentSequence | kind ('INV'/'RCT'), year Int, nextValue Int @default(1) | `@@id([kind, year])` | FR-2, FR-16 |
| InvoiceReminder | see D-2 | `@@unique([invoiceId, kind, scheduledFor])`, `@@index([invoiceId, kind, sentAt])` | FR-3 |
| SchoolSettings (+) | currency String @default("USD"), invoiceFooter String? | — | FR-4 |
| User (+) | isBursar Boolean @default(false) | — | FR-5 |

Payments and issued invoices have no delete path (`onDelete: Restrict` from allocations to payment/invoice) — NFR-2. Raw SQL in the migration: the three partial unique indexes plus a `CHECK (amount > 0)` on `PaymentAllocation` and `Payment`.

### 2.2 Server modules (`src/server/fees/`)

**`fee-math.ts` — pure, no Prisma client, unit-tested (FR-49)**
- `computeInvoiceTotals(lines, discounts)` → `{ lines (incl. negative discount lines), subtotal, discountTotal, total }`. Order (FR-15): base = Σ non-optional lines; each PERCENT discount = −round(base × pct/100) (each on the same base, not compounding); then each FIXED discount = −min(value, remaining total); total clamped ≥ 0; 2 dp HALF_UP via `fixed2`. Fixtures AC1 `2235.00`, AC2 `−107.50`.
- `siblingRank(studentId, siblings)` and `siblingRuleFor(rank, activeRules)` (D-4, D-5) — FR-11.
- `autoAllocate(amount, openInvoices)` → oldest `dueDate` first, then `number`; never exceeds balance; returns remainder (> 0 ⇒ overpayment) — FR-28, FR-29.
- `validateAllocations(amount, allocations, balances)` → Σ = amount, each 0 < a ≤ balance — FR-28.
- `deriveStatus({ status, total, amountPaid, dueDate }, today)` → FR-24 (DRAFT/VOID unchanged; PAID if paid ≥ total; past due and unpaid balance → OVERDUE; else PARTIALLY_PAID / ISSUED).
- `reminderSlot(invoice, today)` → `{ kind, scheduledFor } | null`: PRE_DUE_3D on `due − 3` while `today < due`; DUE_PLUS_1 on `due + 1`; OVERDUE_14D on `due + 1 + 14k` (latest slot ≤ today, k ≥ 1). Missed older slots are not back-filled — FR-37.
- `agingBucket(dueDate, today)` → `current | 1-30 | 31-60 | 61-90 | 90+` — FR-42.

**`ledger.ts` — the only code that touches numbers, locks and `amountPaid` (NFR-1, NFR-3)**
- `nextDocumentNumber(tx, 'INV'|'RCT', year)` — ADR-3 (`INSERT … ON CONFLICT DO NOTHING`, `SELECT … FOR UPDATE`, increment, `INV-2026-000001`). `year` = school-tz year of the issue/received date.
- `lockInvoices(tx, ids)` — `SELECT id FROM "Invoice" WHERE id IN (…) ORDER BY id FOR UPDATE` (ADR-4).
- `recomputeInvoice(tx, id, today)` — `amountPaid = Σ allocations WHERE payment.reversedAt IS NULL`, status via `deriveStatus`; returns before/after for audit. **Nothing else writes `amountPaid` or post-issue status** (except `markOverdue`, which only applies the same OVERDUE rule).
- `issueInvoice(tx, id, today, tz)` — DRAFT only; number, `issueDate = today`, `dueDate = addDateDays(today, plan?.dueDays ?? input.dueDays ?? 30)`, then `recomputeInvoice` (a 0-total invoice becomes PAID).

**`access.ts` (FR-45, NFR-4, ADR-12)**
- `requireFeeReader()` = `requireRole('ADMIN', 'PARENT')`; teachers/students → 403.
- `requireBursar()` = `requireRole('ADMIN')` + DB read of `isBursar`, else 403 `FORBIDDEN`.
- `parentStudentIds(user)` via existing `getAccessibleStudentIds`; `assertCanSeeInvoice / Payment / Student(user, id)` — ADMIN passes; PARENT must have the invoice's student (or, for a payment, at least one allocation's student) linked; otherwise **404 `NOT_FOUND`** (no existence oracle).
- `assertParent(parentId)` — the id is an existing PARENT user (FR-26).

**`fees-service.ts` — public service API used by routes, seed and tests (NFR-7)**
- Setup: `listFeeItems / createFeeItem / updateFeeItem / archiveFeeItem` (FR-6); `listPlans / createPlan / replacePlan` (PUT replaces lines in one tx, FR-7); `listDiscounts / createDiscount / updateDiscount / archiveDiscount` (FR-8); `setStudentOptionalFees`, `bulkAssignOptionalFee(sectionId, …)` (FR-9; only `isOptional` items); `setStudentDiscounts` (FR-10; manual discounts only, `autoRule` must be null).
- Generation: `buildInvoiceDrafts({academicYearId, termId|null, gradeLevelIds})` — batched loads (students by `StudentProfile.gradeLevelId`, non-archived; section from `SectionMember` for the year; plans; optional fees; manual discounts; primary-parent links for sibling ranks; existing plan invoices for skip) → one row per student incl. `skipped: 'ALREADY_INVOICED'` (FR-12, FR-13). `previewInvoices` returns it; `generateInvoices({…, issue})` writes it in 50-student chunk transactions (ADR-6), issuing in the same tx when `issue` (FR-14); a `P2002` on a partial index ⇒ reported as skipped.
- Invoices: `listInvoices(filters, page)` returns rows + filtered totals (FR-17, FR-18); `getInvoice(id)` with lines, allocations (+ payment receipt numbers, reversed flag) and AuditLog timeline (`entityType='Invoice'`) (FR-19, FR-22); `createManualInvoice` (FR-23, `feePlanId` null, optional `issue`); `updateDraft` (replace lines, recompute totals) / `deleteDraft` / `issue` (FR-20); `adjustInvoice(id, {amount, reason})` (FR-21, D-10); `voidInvoice(id, reason)` (FR-21, D-11); `remindInvoice(id)` (FR-38, D-8).
- Payments: `getFamilyOpenInvoices(parentId)` — open (ISSUED/PARTIALLY_PAID/OVERDUE) invoices of every child linked to the parent, oldest due first, with balances and a suggested `autoAllocate` (FR-26, FR-28); a student selection resolves to its primary parent in the UI via the same call. `recordPayment(input)` (FR-27–FR-30), `reversePayment(id, reason)` (FR-31, second reverse → 409 `CONFLICT`), `listPayments / getPayment` with parent scope (FR-32).

**`reports.ts`** — `invoiceWhere(filters, scope)` shared by list, totals and CSV (FR-18, FR-44); `getDashboard(termId?)` (FR-42 KPIs + 12-week trend); `getAging()` (buckets + top-10 overdue families grouped by primary parent); `exportInvoicesCsv / exportPaymentsCsv / exportAgingCsv` through `toCsv` with non-negative money columns only (ADR-12 gotcha) (FR-44); `getMyFees(parent)` (FR-39); `outstandingTotal()` and `outstandingByStudent(ids)` used by the admin KPI and parent overview (FR-40, FR-43). All aggregates in SQL/Prisma `_sum` → `Decimal` → `fixed2` (ADR-2).

**`maintenance.ts`** — `markOverdue(today)` (one `updateMany`, FR-25) and `sendInvoiceReminders(now)` (FR-37). Both called from `src/app/api/internal/email/dispatch/route.ts` next to the quiz/assignment maintenance calls; `markOverdue` is also the first call of every fee read in `fees-service`/`reports` (FR-25).

### 2.3 Shared lib

- `src/lib/money.ts` — re-exports `Decimal`, `dec`, `fixed2` from `grading-math.ts`; `sumMoney`, `formatMoney(amount, currency, locale='en-US')` with cached `Intl.NumberFormat` (FR-35), `amountInWords` (FR-34). Isomorphic (used by pages and server).
- `src/lib/validators/fees.ts` — Zod: `money` (string or number → 2 dp string, `> 0` variant), id strings, list filters (`status, termId, gradeLevelId, sectionId, overdue, q, page, pageSize ≤ 100, sort` whitelist), and every write body. Shared by route handlers and React Hook Form resolvers (NFR-7).

### 2.4 Notifications (FR-36)

Register in `src/server/notifications/types.ts`, category `FINANCE`, role PARENT, email default on:
- `fees.invoice_issued` → link `/fees?invoice=<id>`
- `fees.payment_received` → link `/fees/receipts/<paymentId>/print`
- `fees.overdue_reminder` → link `/fees?invoice=<id>`

Recipients: every parent linked to the invoice's student (primary first). For payments: the union of linked parents across all allocated invoices. `notify()` is called after commit (D-13).

### 2.5 UI (MUI only, NFR-6; route group `src/app/(app)`)

| Route | Role guard (`requirePageRole`) | Content | Req |
|---|---|---|---|
| `/admin/fees` | ADMIN | StatCard KPIs, `LineChart` weekly trend, `BarChart` aging, top-10 overdue families table, CSV buttons | FR-42, FR-44 |
| `/admin/fees/setup` | ADMIN (writes bursar) | `Tabs`: Fee items · Fee plans (line editor, live `Decimal` total, dueDays) · Discounts · Optional fees (per student + bulk by section) · Student discounts | FR-6–FR-10 |
| `/admin/fees/invoices` | ADMIN | `DataTable` server mode + filter bar + totals summary bar; "New manual invoice" dialog (bursar) | FR-17, FR-18, FR-23, FR-44 |
| `/admin/fees/invoices/generate` | ADMIN bursar | Term/annual + grade multi-select → preview grid (skipped rows marked) → "Create drafts" / "Create and issue" | FR-12–FR-14 |
| `/admin/fees/invoices/[id]` | ADMIN | Header, lines, allocations, balance, timeline; status-dependent actions (edit/issue/delete; record payment/adjust/void/remind; view receipts) with `ConfirmDialog` + reason fields | FR-19–FR-22, FR-38 |
| `/admin/fees/payments` | ADMIN | `DataTable` of payments, reversed chip, CSV with date range (`DatePicker` ×2) + method | FR-32, FR-44 |
| `/admin/fees/payments/new` | ADMIN bursar | Parent/student `Autocomplete` → open invoices with editable allocation column (auto oldest-first) → form (amount, method, reference, `DateTimePicker` receivedAt, payer, notes) → on save navigate to receipt print | FR-26–FR-30 |
| `/admin/fees/payments/[id]` | ADMIN | Payment detail + "Reverse" (bursar, reason) | FR-31, FR-32 |
| `/fees` | PARENT | Summary card (outstanding, next due, overdue in `error` colour), invoices across children, payment history with receipt links, invoice footer | FR-39 |
| `/fees/invoices/[id]/print` | ADMIN, PARENT (+ access check) | A4 invoice, letterhead, footer, `PrintButton` | FR-33, NFR-12 |
| `/fees/receipts/[paymentId]/print` | ADMIN, PARENT (+ access check) | A4 receipt, allocations, amount in words, "Reversed" watermark if reversed | FR-34, NFR-12 |

Components live in `src/components/fees/` (feature folder): `InvoiceStatusChip`, `MoneyText` (uses `formatMoney`), `InvoiceLinesEditor`, `AllocationEditor`, `InvoiceDocument`, `ReceiptDocument`, `PrintButton` (client, `window.print()`). Print pages use `sx` `'@media print'` + page-scoped `GlobalStyles` `@page { size: A4; margin: 15mm }` (ADR-9).

Brownfield edits: `src/config/navigation.ts` — ADMIN "Fees" (`/admin/fees`, children Setup / Invoices / Payments) and PARENT "Fees" (`/fees`); none for TEACHER/STUDENT (FR-46, FR-41). `src/server/dashboards/admin.ts#getKpis` + admin dashboard page: "Outstanding fees" StatCard (FR-43). `src/server/parent/overview-service.ts` + `my-children` page: "Fees" card when the child's outstanding balance > 0, linking to `/fees` (FR-40). `src/app/(app)/layout.tsx`: also load `isBursar` (D-14).

### 2.6 API surface (detail belongs to `arch-api-contracts`)

All under `src/app/api/fees/**` unless noted; `withHandler` + Zod; reads `requireFeeReader` (parents scoped) or ADMIN-only; writes `requireBursar` (FR-45). Money in/out as 2 dp strings; every response that carries money also carries `currency`.

- Setup: `GET/POST /items`, `PATCH /items/:id`, `POST /items/:id/archive`; `GET/POST /plans`, `PUT /plans/:id`; `GET/POST /discounts`, `PATCH /discounts/:id`, `POST /discounts/:id/archive`; `GET/PUT /students/:id/optional-fees`, `POST /optional-fees/bulk`; `GET/PUT /students/:id/discounts`.
- Invoices: `POST /invoices/preview`, `POST /invoices/generate`, `GET/POST /invoices`, `GET/PATCH/DELETE /invoices/:id`, `POST /invoices/:id/issue|void|adjust|remind`.
- Payments: `GET /families/:parentId/open-invoices`, `GET/POST /payments`, `GET /payments/:id`, `POST /payments/:id/reverse`.
- Reports: `GET /dashboard`, `GET /aging`, `GET /export/invoices|payments|aging` (text/csv).
- Parent: `GET /api/me/fees`.

Error mapping (existing codes): validation → 400 `VALIDATION_ERROR` (incl. FR-29 message); wrong state (non-DRAFT edit, double reverse, void with allocations) → 409 `CONFLICT`; throttle → 429 `RATE_LIMITED`; role/bursar → 403 `FORBIDDEN`; out-of-scope id → 404 `NOT_FOUND`.

---

## 3. Data Flow

### 3.1 Generate term invoices (FR-12–FR-16, NFR-3, NFR-5)
1. Bursar picks term + grades → `POST /invoices/preview` → `buildInvoiceDrafts` (≈8 batched queries regardless of student count) → `computeInvoiceTotals` per student → rows incl. skipped.
2. `POST /invoices/generate {issue}` → rebuild drafts server-side (never trust client totals) → chunks of 50: `$transaction({timeout: 30s})` { `createMany` invoices + lines; if `issue`: `nextDocumentNumber` per invoice under the INV row lock, set dates/status } → after commit: `audit()` per invoice (`invoice.create` / `invoice.issue`), `notify(fees.invoice_issued)`.
3. Response `{ created, issued, skipped[] }`. Re-running is idempotent (D-7 indexes).

### 3.2 Record payment (FR-26–FR-30, NFR-1)
1. Select parent → `GET /families/:parentId/open-invoices` → UI pre-fills allocations with `autoAllocate`; bursar may edit; client validates with the same `fee-math` functions.
2. `POST /payments` → tx { `lockInvoices(ids)` (sorted) → reload balances → if amount > family outstanding ⇒ `VALIDATION_ERROR "Amount exceeds the family's outstanding balance of <formatMoney>"` (nothing saved) → `validateAllocations` → `nextDocumentNumber('RCT')` → insert Payment + allocations → `recomputeInvoice` each }.
3. After commit: `audit('payment.create')` + per-invoice before/after, `notify(fees.payment_received, link=receipt)`. Response includes `paymentId`; UI navigates to `/fees/receipts/:id/print`.

### 3.3 Reverse payment (FR-31)
tx { lock payment row (`FOR UPDATE`; already reversed ⇒ 409) → `lockInvoices(allocated)` → set `reversedAt/reversedById/reversalReason` → `recomputeInvoice` each } → audit. Allocation rows stay; they are excluded by `payment.reversedAt IS NULL`.

### 3.4 Adjust / void / issue / draft edit (FR-20, FR-21)
Each: tx { `lockInvoices([id])` → state check (409 on wrong status) → write (adjust: insert negative `isAdjustment` line, recompute `total`, D-10 guard; void: D-11 guard, `status=VOID`, `voidedAt`, `voidReason`; issue: `issueInvoice`) → `recomputeInvoice` } → audit with before/after → notify on issue.

### 3.5 Overdue and reminders (FR-24, FR-25, FR-37, FR-38, NFR-8)
- Maintenance route (existing secret-protected internal endpoint) → `markOverdue(today)` → `sendInvoiceReminders(now)`: for each open invoice with a `reminderSlot`, `prisma.invoiceReminder.create`; on `P2002` skip (already sent); on success `notify(fees.overdue_reminder)` to all linked parents. At-most-once: if `notify` fails after the insert, the reminder is logged and not retried.
- Every fee read calls `markOverdue(today)` first → lists/details never stale.
- Manual `/remind`: tx { `lockInvoices([id])`, check last MANUAL within 24 h ⇒ 429, insert MANUAL row } → notify → audit.
- "today" = `schoolDateOf(now, settings.timezone)` everywhere; `@db.Date` written as `new Date(day + 'T00:00:00Z')` (ADR-13).

### 3.6 Parent read (FR-39, FR-40, FR-32, NFR-4)
`GET /api/me/fees` → `requireRole('PARENT')` → student ids from `getAccessibleStudentIds` → `markOverdue` → invoices of those students (non-DRAFT, non-VOID shown; VOID shown greyed), payments with ≥ 1 allocation to them, summary (Σ balance, min open dueDate, Σ overdue balance), `invoiceFooter`, `currency`. Print pages run the same `assertCanSee*` before rendering.

### 3.7 Dashboard and exports (FR-42–FR-44)
`markOverdue` → SQL aggregates: billed (Σ total of non-DRAFT, non-VOID invoices of the selected/current term), collected (Σ non-reversed allocations to those invoices), outstanding (Σ balance of open invoices), overdue (Σ balance of OVERDUE), rate = collected ÷ billed (0 when billed = 0); weekly trend = Σ non-reversed payments by ISO week of school-tz `receivedAt`, last 12 weeks; aging and top-10 overdue families (grouped by primary parent). CSV endpoints reuse the same `where` builders and `toCsv`.

### 3.8 Security considerations (NFR-4, FR-45; answers `threat-model-notes.json`)
- **Authentication:** every fee page/API sits behind the existing Auth.js session (`requireRole` / `requirePageRole`); the maintenance hook reuses the internal route's existing `timingSafeEqual` secret check. No new auth surface.
- **Authorization:** the FR-45 matrix lives in `access.ts` only; bursar flag re-read from the DB per write; every URL id is checked server-side (out-of-scope ⇒ 404). Hidden buttons are cosmetic only.
- **Input validation:** Zod on every body/query; money parsed as strings to `Decimal` with max 2 dp and `≤ 99,999,999.99` (Decimal(10,2)); enums validated; `sort` whitelisted; `q` used only through Prisma parameters; `notify` links are relative (existing `isSafeRelativeLink`).
- **PII:** fee data (student names, payer names, references, amounts) is visible only to ADMIN and linked parents; CSV exports ADMIN-only and formula-injection-safe (`toCsv`). `reference`/`notes` are free text — UI helper text says *never enter card numbers*; no card or bank account data is stored (NFR-11). `audit()` already strips secret keys.
- **Encryption / secrets:** no new secrets or keys. In-transit TLS and at-rest DB encryption stay as provided by the existing deployment; nothing fee-specific is stored that needs field-level encryption.

### 3.9 Seed (FR-47, FR-48)
Extend the existing seed script; all invoices and payments go through `fees-service` (`generateInvoices`, `recordPayment`) so numbers and `amountPaid` are consistent. The 3 OVERDUE invoices are generated with an injected `today` in the past (services accept `today` for tests and seed), then `markOverdue` runs.

---

## 4. Testing map (FR-49–FR-51, NFR-10)

| Test | Location | Covers |
|---|---|---|
| Unit: `computeInvoiceTotals` (AC1/AC2 fixtures, clamp ≥ 0, half-up), `siblingRank`/`siblingRuleFor`, `autoAllocate`/`validateAllocations`, `deriveStatus`, `reminderSlot`, `agingBucket` (tz pinned to `America/New_York`) | `tests/unit/fees/fee-math.test.ts` | FR-11, FR-15, FR-24, FR-28, FR-37, FR-49 |
| Unit: `amountInWords`, `formatMoney` | `tests/unit/fees/money.test.ts` | FR-34, FR-35, FR-49 |
| Unit/integration: FR-45 permission matrix (bursar admin / admin / teacher / parent own / parent other / student) | `tests/integration/fees/access.test.ts` | FR-41, FR-45, NFR-4 |
| Integration: N parallel issues + N parallel payments → numbers exactly 1..N | `tests/integration/fees/numbering.test.ts` | FR-16, FR-50, NFR-3 |
| Integration: reversal recompute; seeded-random pay/reverse sequence asserting `amountPaid = Σ non-reversed allocations` and status | `tests/integration/fees/ledger.test.ts` | FR-31, FR-50, NFR-1 |
| E2E: bursar generates → records payment → prints receipt → parent sees balance | `tests/e2e/fees.spec.ts` | FR-51 |

---

## 5. Requirements Traceability

| Req | Design element(s) |
|---|---|
| FR-1 | §2.1 enums (+ `InvoiceReminderKind`, D-2) |
| FR-2 | §2.1 models, D-1, D-6 |
| FR-3 | §2.1 InvoiceReminder, D-2 |
| FR-4 | §2.1 SchoolSettings `currency`, `invoiceFooter` |
| FR-5 | §2.1 `User.isBursar`, D-14 |
| FR-6 | `fees-service` fee items, `/admin/fees/setup` tab, `/items` routes |
| FR-7 | `createPlan/replacePlan`, D-3, setup tab |
| FR-8 | Discount CRUD, setup tab |
| FR-9 | `setStudentOptionalFees`, `bulkAssignOptionalFee`, D-12 |
| FR-10 | `setStudentDiscounts` (manual only) |
| FR-11 | `fee-math.siblingRank/siblingRuleFor`, D-4, D-5 |
| FR-12 | `buildInvoiceDrafts`, `/invoices/preview`, generate page, §3.1 |
| FR-13 | D-7 partial indexes + pre-filter, §3.1 |
| FR-14 | `generateInvoices({issue})`, `issueInvoice`, ADR-6 chunks |
| FR-15 | `fee-math.computeInvoiceTotals`, negative `InvoiceLine.isDiscount` |
| FR-16 | `ledger.nextDocumentNumber`, `DocumentSequence` |
| FR-17 | `listInvoices`, `/admin/fees/invoices` DataTable |
| FR-18 | `reports.invoiceWhere` + totals aggregate, filter bar |
| FR-19 | `getInvoice` (lines, allocations, AuditLog timeline), detail page |
| FR-20 | `updateDraft/deleteDraft/issue`, §3.4 |
| FR-21 | `adjustInvoice` (D-10), `voidInvoice` (D-11), §3.4 |
| FR-22 | detail page receipt links → receipt print page |
| FR-23 | `createManualInvoice`, `POST /invoices` |
| FR-24 | `fee-math.deriveStatus`, `ledger.recomputeInvoice` |
| FR-25 | `maintenance.markOverdue` in maintenance route + every fee read |
| FR-26 | `getFamilyOpenInvoices`, `/families/:parentId/open-invoices`, payment page |
| FR-27 | payment form + Zod `recordPayment` body |
| FR-28 | `autoAllocate`, `validateAllocations`, `AllocationEditor` |
| FR-29 | in-tx outstanding check, `formatMoney` message, §3.2 |
| FR-30 | `recordPayment` tx, RCT number, notify, navigate to receipt |
| FR-31 | `reversePayment`, §3.3 |
| FR-32 | `listPayments/getPayment` + parent scope, payments pages |
| FR-33 | `/fees/invoices/[id]/print`, `InvoiceDocument`, `PrintButton` |
| FR-34 | `/fees/receipts/[paymentId]/print`, `ReceiptDocument`, `amountInWords` |
| FR-35 | `src/lib/money.formatMoney`, `MoneyText`, `currency` in responses |
| FR-36 | §2.4 notification types |
| FR-37 | `fee-math.reminderSlot`, `maintenance.sendInvoiceReminders`, D-2 |
| FR-38 | `remindInvoice`, D-8 |
| FR-39 | `reports.getMyFees`, `GET /api/me/fees`, `/fees` page |
| FR-40 | `outstandingByStudent` in `parent/overview-service.ts`, Fees card in `my-children` |
| FR-41 | `access.requireFeeReader` excludes STUDENT, no nav entry |
| FR-42 | `reports.getDashboard/getAging`, `/admin/fees` charts |
| FR-43 | `outstandingTotal` in `dashboards/admin.ts#getKpis`, StatCard |
| FR-44 | `reports.export*Csv` via `toCsv`, `/export/*` routes |
| FR-45 | `access.ts` (`requireBursar`, `requireFeeReader`, `assertCanSee*`) |
| FR-46 | `src/config/navigation.ts` entries |
| FR-47 | §3.9 seed setup data |
| FR-48 | §3.9 seed invoices/payments through services |
| FR-49 | §4 unit tests on `fee-math.ts`, `money.ts` |
| FR-50 | §4 integration numbering + ledger tests |
| FR-51 | §4 `tests/e2e/fees.spec.ts` |
| NFR-1 | Decimal(10,2), ADR-2 money strings, `recomputeInvoice` single writer, ledger test |
| NFR-2 | no delete path for issued/payments (Restrict), void/reverse, `audit()` after commit (D-13) |
| NFR-3 | `nextDocumentNumber` row lock, D-7 partial indexes, numbering test |
| NFR-4 | `access.ts` per-id checks (404), print pages checked, §3.8 |
| NFR-5 | batched `buildInvoiceDrafts`, 50-student chunk transactions (ADR-6) |
| NFR-6 | §2.5 MUI-only components (DataGrid, x-charts, x-date-pickers), MCP doc checks in dev |
| NFR-7 | thin Zod handlers under `src/app/api/fees/**` → `src/server/fees/fees-service.ts`, standard errors/pagination |
| NFR-8 | `schoolDateOf`/`addDateDays`, `@db.Date` UTC-midnight writes, §3.5 |
| NFR-9 | §1.1 reused helpers; brownfield edits in §2.5 only extend existing files |
| NFR-10 | §4 tests; lint/typecheck/test gate |
| NFR-11 | no gateway/card storage, CSV only, overpayment + D-10 credit guards, USD-style single currency |
| NFR-12 | ADR-9 `sx` print styles + page-scoped `@page` A4 |

## 6. Risks and notes for downstream phases

- **D-12 (optional fee per invoice)** is an assumption with real billing impact; it is isolated in `buildInvoiceDrafts`.
- `markOverdue` on every read is a write on a read path; it is one indexed `updateMany` and idempotent. *ponytail: on-read sweep, drop it if the maintenance run ever becomes reliable enough for FR-25.*
- The DocumentSequence row lock serializes issuing per year (ADR-3) — fine at school scale; chunking keeps lock hold time bounded.
- `arch-api-contracts` must carry `currency` in every money response, money as strings, and the error mapping in §2.6.
