# Requirements Analysis Notes: ticket SH-17

Written by `arch-research-reqs` for `arch-design-system`. This is a supporting document, not a primary phase output.
Source: `artifacts/intake/requirements.json` (2026-11-10T15:10:00Z), PRD-17 Fees, Invoices & Payment Records. It has 51 FRs and 12 NFRs (63 requirements) at 92% confidence.
`handoff-to-architect.json` lists **no blockers** and 11 warnings. §3 proposes a default for each open question so that `arch-design-system` can decide.

Concern tags: **DATA** (schema/migration), **API** (route handler), **SVC** (service logic in `src/server/fees/`), **UI** (page/component), **JOB** (maintenance pass), **AUTH** (permission boundary), **NOTIFY**, **TX** (transaction/locking), **SEED**, **TEST**.

Brownfield anchors I checked on disk:
- `prisma/schema.prisma` has `User.archivedAt`, `StudentProfile.enrollmentDate @db.Date`, `ParentStudentLink` (with `isPrimary`), `AuditLog`, and `SchoolSettings.timezone`. There are no fee models yet.
- `src/server/http.ts` already defines the `CONFLICT` (409) and `RATE_LIMITED` (429) codes and maps P2002 to CONFLICT. `src/server/rate-limit.ts` exists.
- `src/server/email/dispatch.ts` already uses raw `FOR UPDATE SKIP LOCKED`, so the pattern for raw row locks inside Prisma is established.
- The existing helpers are `src/server/audit.ts`, `src/server/csv.ts`, `src/server/notifications/`, `src/server/parent/overview-service.ts`, `src/server/dashboards/admin.ts`, and the maintenance route `src/app/api/internal/email/dispatch/route.ts`.
- Shared UI lives at `src/components/{DataTable,StatCard,ConfirmDialog,Toast,PageHeader,charts,...}`. Validators live at `src/lib/validators/<feature>.ts`.

## 1. Functional requirements

| Req | Concern | Notes |
|---|---|---|
| FR-1 | DATA | Three new enums. Add a fourth enum, `InvoiceReminderKind` (PRE_DUE_3D, DUE_PLUS_1, OVERDUE_14D, MANUAL), unless FR-3 uses a String. A single migration is enough. |
| FR-2 | DATA, TX | 11 models with Decimal(10,2) money columns. Make `Invoice.number` and `Payment.receiptNumber` `String? @unique`, because drafts have no number (see §3 Q1). `DocumentSequence` needs a PK of (kind, year) so it can be row-locked. Add the indexes the list filters need: Invoice(status), (termId), (studentId), (dueDate). |
| FR-3 | DATA, JOB | `InvoiceReminder { id, invoiceId, kind, sentAt }` with `@@index([invoiceId, kind])`. Idempotency for the automatic kinds comes from checking for an existing (invoiceId, kind) row. OVERDUE_14D repeats, so compare against the latest `sentAt` instead of using a unique constraint. |
| FR-4 | DATA | Two new SchoolSettings columns. The currency is read by every money formatter (FR-35), and the footer is read by the print pages and the parent page (FR-33, FR-39). |
| FR-5 | DATA, AUTH | `User.isBursar`. It must be added to the session/user payload, or looked up per request, by a new `requireBursar()` guard built on `requireRole('ADMIN')`. |
| FR-6 | UI, API, SVC | CRUD for `/api/fees/items`. Archiving is a soft delete (archivedAt). A duplicate `code` returns CONFLICT through the P2002 mapping. Admin setup page with tabs. |
| FR-7 | UI, API, SVC, TX | The plan PUT replaces all lines in one transaction (deleteMany + createMany). The uniqueness check for annual plans goes in the service (§3 Q3). The computed total can be derived on the client and recomputed on the server. |
| FR-8 | UI, API, SVC | Validate PERCENT as 0–100 and FIXED as > 0 with Zod. `autoRule` is a nullable string enum. |
| FR-9 | UI, API, SVC | `PUT /api/fees/students/:id/optional-fees` replaces the set for one year. Bulk assign by section loops over the section's enrolled students in one transaction. Only `isOptional` items can be assigned. |
| FR-10 | UI, API, SVC | `PUT /api/fees/students/:id/discounts` handles manual discounts only. Auto-rule discounts are never assigned by hand. |
| FR-11 | SVC, TEST | Pure function `detectSiblingRank(student, siblings)`: group by the primary parent, exclude archived students, sort by enrollmentDate ascending then dateOfBirth (§3 Q4), and return a 1-based rank. Rank ≥ 2 → SIBLING_2ND. Rank ≥ 3 → SIBLING_3RD_PLUS. Clarify in the design whether both apply at rank ≥ 3; the default is to apply only the most specific one. |
| FR-12 | UI, API, SVC | `POST /api/fees/invoices/preview` is read-only and shares a pure `buildInvoiceDraft()` with generate. This is the main path for the NFR-5 performance target: load all students, plans, optional fees and discounts in a few batched queries, never one query per student. |
| FR-13 | SVC | The skip rule is in §3 Q6. An `Invoice.feePlanId` (nullable) or `source` flag is needed to tell plan invoices from manual ones. |
| FR-14 | API, SVC, TX, NOTIFY | Generate uses the same builder. "Create and issue" calls the shared `issueInvoice(tx, id)`, which allocates the number, sets dates in the school timezone and sets status. Notify after commit. Chunk large batches, or allocate a whole block of numbers with one locked increment (NFR-5). |
| FR-15 | SVC, TEST | Pure Decimal function. Percent discounts apply to the non-optional subtotal, then fixed discounts apply, and the total is clamped at 0. Discount lines are stored as negative InvoiceLines. Use `Prisma.Decimal` with `ROUND_HALF_UP`. The AC1/AC2 fixtures are 2,235.00 and −107.50. |
| FR-16 | TX, DATA, TEST | `nextNumber(tx, kind, year)`: a raw `SELECT … FOR UPDATE` on DocumentSequence (upsert the row first), then increment, inside the caller's interactive transaction. A rollback leaves no gap. The year is the school-timezone year of issue or receipt. |
| FR-17 | UI, API, SVC | Server-paginated list on the existing DataTable. `paid` and `balance` are derived (total − amountPaid). Sort keys need whitelisting. |
| FR-18 | API, SVC | The totals row is a separate aggregate (`SUM` of total and amountPaid) over the same `where` builder. "Overdue only" uses status OVERDUE after the on-read sweep (FR-25). `q` matches the student name or the invoice number. |
| FR-19 | UI, API, SVC | Detail includes lines, allocations joined to payments (reversed allocations marked), and a timeline from AuditLog filtered by entity `Invoice` and the id. |
| FR-20 | API, SVC | PATCH/DELETE return CONFLICT on any status except DRAFT. A hard delete is allowed only for DRAFT (NFR-2). `POST /issue` → `issueInvoice`. |
| FR-21 | API, SVC, TX | `/adjust` adds a negative line, requires a reason, writes an audit entry and recomputes. The adjustment cannot push the total below amountPaid (that would create a credit, which is out of scope per NFR-11), so the design must define this guard. `/void` requires a reason and zero non-reversed allocations. |
| FR-22 | UI | The PAID detail page links to the receipt print page of each allocated payment. No new API is needed beyond detail. |
| FR-23 | UI, API, SVC | `POST /api/fees/invoices` creates a manual invoice with free-form lines, as a DRAFT or issued straight away. It does not count for the skip rule (FR-13). |
| FR-24 | SVC, TEST | Single `recomputeInvoice(tx, id)`: `amountPaid = SUM(non-reversed allocations)`, then derive the status from FR-24. Every allocation, reversal and adjustment calls it. This is the NFR-1 invariant point. VOID and DRAFT are terminal or excluded. |
| FR-25 | JOB, SVC | `markOverdue(now)` is a bulk UPDATE of ISSUED and PARTIALLY_PAID invoices with dueDate < school-today. Call it from the maintenance pass and at the start of the list, detail, dashboard and `/api/me/fees` reads. It is cheap and idempotent. |
| FR-26 | UI, API, SVC, AUTH | `GET /api/fees/families/:parentId/open-invoices` returns the open invoices of every child linked to that parent, ordered by dueDate. The parentId is checked to be a PARENT user. |
| FR-27 | UI, API | Zod: amount > 0 as a 2 dp string, method enum, receivedAt, payerName defaulting to the primary parent's name. |
| FR-28 | SVC, TEST | Pure `autoAllocate(amount, openInvoices)` that fills the oldest due date first. Server validation: Σ allocations = amount, and each allocation ≤ the balance read **inside** the transaction. |
| FR-29 | SVC | Check amount ≤ the family's outstanding balance inside the transaction and return VALIDATION_ERROR with the formatted message. Nothing is written. |
| FR-30 | API, SVC, TX, NOTIFY | One transaction: lock and allocate the receipt number, insert the payment and its allocations, `recomputeInvoice` for each invoice, then audit. After commit, notify the family's parents with the receipt URL. The client navigates to the print page. |
| FR-31 | API, SVC, TX | `/reverse`: set reversedAt and reversalReason, recompute the affected invoices, write an audit entry. Allocation rows are kept and filtered out by `payment.reversedAt IS NULL`. Reversing a payment twice returns CONFLICT. |
| FR-32 | API, AUTH | ADMIN gets all payments. PARENT gets only payments with ≥ 1 allocation to an invoice of a linked child. Put this filter in one shared `parentScope(userId)` helper. |
| FR-33 | UI, AUTH | Route `/fees/invoices/[id]/print` sits outside `/admin` because parents use it too. Page-level access check (NFR-4). A4 print styles go through sx `@media print`. |
| FR-34 | UI, SVC, TEST | Same as FR-33, plus a pure `amountInWords(decimal, currency)` (§3 Q8). |
| FR-35 | UI | One `formatMoney(value, currency)` helper in `src/lib/` using `Intl.NumberFormat`. Money values reach the client as strings and are formatted without float arithmetic beyond display. |
| FR-36 | NOTIFY | Add three keys to `src/server/notifications/types.ts` under the existing FINANCE category for the PARENT role, with email on by default. |
| FR-37 | JOB, NOTIFY, DATA | `sendDueReminders(now)` in the maintenance route. The schedule is computed in the school timezone. Insert the InvoiceReminder row and the notification together so a reminder is never sent twice. Recipients are all linked parents. |
| FR-38 | API, SVC | `/remind` returns 429 RATE_LIMITED if an InvoiceReminder exists for the invoice within 24 h (any kind, or MANUAL only, which the design should choose). The default is any kind. |
| FR-39 | UI, API, AUTH | `GET /api/me/fees` aggregates the children's invoices, payments, the summary and the footer. New `/fees` page for parents. |
| FR-40 | SVC, UI | Extend `src/server/parent/overview-service.ts` with an outstanding balance per child and render a Fees card in `my-children`. |
| FR-41 | AUTH, UI | Students get 403 on every fee route and have no nav entry. Covered by the guards in FR-45. |
| FR-42 | UI, API, SVC | `/api/fees/dashboard` (KPIs, weekly trend) and `/api/fees/aging` (buckets, top 10 families). Use SQL aggregates. Aging days are counted from dueDate in the school timezone. The charts use MUI x-charts (NFR-6). |
| FR-43 | SVC, UI | Add an outstanding total to `getKpis` in `src/server/dashboards/admin.ts` and one more StatCard. |
| FR-44 | API | Three CSV endpoints through `src/server/csv.ts`. The invoices export reuses the FR-18 `where` builder. Read-only admins are allowed. |
| FR-45 | AUTH | Guards: `requireRole('ADMIN')` for reads and `requireBursar()` for writes. PARENT reads go through `parentScope`. TEACHER and STUDENT get 403. Every write route also needs an explicit test for a non-bursar admin. |
| FR-46 | UI | Add entries to `src/config/navigation.ts`: admin Fees with subpages, parent Fees. |
| FR-47 | SEED | Extend the existing seed script so Alice gets isBursar, set the settings, add the items, and add the Sem 1 plans for G6–8. |
| FR-48 | SEED | The seed must go through the same service functions (issue, payment) so the numbers and amountPaid stay consistent. The 3 OVERDUE invoices need back-dated due dates. |
| FR-49 | TEST | Unit tests for the pure functions in FR-11, 15, 24, 28 and 34. Keeping these as pure functions is a design requirement. |
| FR-50 | TEST | Integration tests against the DB: parallel `nextNumber`, reversal recompute, and a randomized pay/reverse sequence asserting that amountPaid = Σ allocations (NFR-1). |
| FR-51 | TEST | One Playwright spec covering the bursar flow, then the parent flow. |

## 2. Non-functional requirements

| Req | Concern | Notes |
|---|---|---|
| NFR-1 | SVC, TX, TEST | Decimal end to end. The API transports money as strings. Only `recomputeInvoice` writes amountPaid. |
| NFR-2 | SVC, DATA | No hard delete for issued invoices or payments (FR-20, FR-21, FR-31). Every mutation calls `audit()` with before/after inside the transaction. |
| NFR-3 | TX | Fully covered by FR-16 if every issue path (generate, issue, manual, seed) goes through `nextNumber`. |
| NFR-5 | SVC | Batch the reads, use createMany for lines, and issue in chunks inside transactions of a bounded size. The main risk is one transaction per student running into the Prisma interactive transaction timeout. |
| NFR-4, NFR-7–NFR-10, NFR-12 | AUTH, API, UI | Conventions: thin Zod handlers under `src/app/api/fees/**` and `src/app/api/me/fees`, service in `src/server/fees/`, validators in `src/lib/validators/fees.ts`, MUI only, logger, school timezone through the existing helpers, A4 print through sx. |
| NFR-6 | UI | The x-charts and x-data-grid docs must be checked through the MUI MCP server during dev. Out of scope for this phase. |
| NFR-11 | SVC | Guards are needed against credits (overpayment FR-29, and the adjustment going below amountPaid in FR-21). No gateway or tax code. |

## 3. Open questions → proposed defaults

| # | Question | Proposed default |
|---|---|---|
| Q1 | Draft invoice numbers | `number String? @unique`, assigned at issue. `receiptNumber` stays non-null, because a payment always gets its number on save. |
| Q2 | InvoiceReminder shape | A `kind` enum as in FR-3. Idempotency is checked in the service. |
| Q3 | Annual plan uniqueness | Uniqueness of (academicYearId, gradeLevelId, termId) is checked in the service (NULL-safe), plus the PRD's DB unique. |
| Q4 | Sibling order | enrollmentDate ascending, then dateOfBirth (older first). Archived students are excluded. |
| Q5 | createdAt and updatedAt | Add them to all fee models. |
| Q6 | Skip rule | A non-VOID invoice with `feePlanId` set for the same student and term (annual: same year with termId NULL). Manual invoices do not cause a skip. |
| Q7 | Throttle code | 429 RATE_LIMITED (the code already exists in `http.ts`). |
| Q8 | Amount in words | USD wording; for other currencies, use the ISO code as the unit name ("… EUR and 00/100"). |
| Q9 (new) | Adjustment below amountPaid | Reject with VALIDATION_ERROR, because it would create a credit balance (NFR-11). |
| Q10 (new) | Sibling rule at rank ≥ 3 | Apply only SIBLING_3RD_PLUS when such a discount exists; otherwise fall back to SIBLING_2ND. |
