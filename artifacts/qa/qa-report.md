# QA Report — SH-17 (PRD-17 Fees, Invoices & Payment Records)

## QA Summary

- ticketId: SH-17
- timestamp: 2026-11-10T11:45:00Z
- overallStatus: PASS
- requirementsChecked: 63
- requirementsPassed: 63
- requirementsFailed: 0

> The 63 requirements are 51 FRs and 12 NFRs. Every verdict cites a file or test. A few PASS rows rest on code review rather than a running test, and their Evidence column says so. One defect was found that SH-17 did not cause but that affects fee emails (finding 1). This file replaces the SH-15 QA report.

## Headline findings

1. **Pre-existing platform defect: some notification emails are silently lost. This includes fee reminders.**
   - **Cause.** `@react-email/render@1.0.1` decodes stream chunks with `TextDecoder.decode(chunk)` and doesn't pass `{ stream: true }`. When a multi-byte character from the `<Preview>` padding lands on a chunk boundary, the rendered HTML contains `U+0000`.
   - **Effect.** Postgres rejects the `EmailOutbox` row (`22021 invalid byte sequence 0x00`). `notify()` logs the error and swallows it. The in-app notification is still written; only the email is lost.
   - **When it happens.** It is reproducible with titles of 53–63 characters, for example `Fee reminder: invoice INV-2026-000123 for <student name>`. The QA integration run hit it on both manual reminders.
   - **Scope.** It is not in SH-17 code (`src/server/email/templates/BaseLayout.tsx` and the renderer predate it). It hits every module that sends notifications.
   - **Tracking.** `tests/unit/fees/qa-sh17-email.test.ts` pins it with `it.fails`; that test turns red when the bug is fixed.
   - **Suggested fix.** Strip `\0` from `html` in `renderEmail`, or upgrade `@react-email/render`. This is a new ticket, so FR-36/37/38 are not failed for it.
2. **Fixed by QA: a dangerous test cleanup in Dev's integration suites.**
   - **What happened.** `tests/integration/fees/access.test.ts` `afterAll` ran `payment.deleteMany({ where: { id: ids.payment } })`. Prisma reads `{ id: undefined }` as "match all". When `beforeAll` failed (here, because of leftover fixture users from an earlier QA run), the cleanup **deleted every Payment and PaymentAllocation in the dev DB**. That left the seeded Grade 7 invoices with `amountPaid` but no allocations.
   - **Fix.** The cleanups in `access`, `ledger`, `numbering` and `qa-sh17` now resolve their fixtures by MARK email or name, so every filter is an id list.
   - **Proof.** QA verified it by forcing a `beforeAll` failure: payments stayed at 12 and the leftover user was cleaned up.
   - **Data repair.** The 9 corrupted seed invoices and the 2026 `DocumentSequence` rows were removed and `npm run db:seed` was re-run. The dev DB is back to 9 Grade 7 invoices (3 PAID, 2 PARTIALLY_PAID, 1 ISSUED, 3 OVERDUE) and 12 payments across 5 methods. `amountPaid` equals the sum of non-reversed allocations on every row.
3. **Fixed by QA: a regression in the test gate caused by SH-17 that Dev missed.** `tests/integration/parent-portal/qa-sh15.test.ts` expected 8 overview cards. FR-40 deliberately adds `fees`, so the assertion is now 9.
4. **Gates.**
   - `npm run typecheck` is clean and `npm run lint` is clean.
   - `npm run build` succeeds, and every fee route is dynamic.
   - All fee suites pass: 44 SH-17 tests (unit, integration and e2e), stable across 5 runs.
   - Full suite with files run one at a time: 733–735/738. Of the failures:
     - `attendance-qa` FR-22, `auth-forms`, `lockout` and `useToast` already failed on the baseline (recorded in the SH-15 report and the Dev log).
     - `email-dispatch` AC-4 and the `qa-sh10` 50 ms timing check failed once under load and pass in isolation.
     - In the fully parallel run, shared-DB flakes also show up (`risk`, `gradebook-sync`), and they pass in isolation.
5. **Dev's self-report matches reality.** All 32 tasks are marked complete. All 91 paths in `file-ownership-matrix.json` exist, and a scan found no `TODO`/`FIXME`/stub markers in fee code. QA ran the e2e test (`tests/e2e/fees.spec.ts`) against a production build: it passed in 3.6 s.

## Tests written or changed by QA
- `tests/integration/fees/qa-sh17.test.ts` (new, 7 tests, real DB). It covers generation end to end, setup guards, the draft lifecycle, the reminder throttle, the on-read OVERDUE refresh, parent payment scope, the dashboard, CSV and outstanding by student. See `coverage-report.md`.
- `tests/unit/fees/qa-sh17-email.test.ts` (new, 2 tests). It covers finding 1.
- Cleanups hardened in `tests/integration/fees/{access,ledger,numbering}.test.ts` (finding 2).
- `tests/integration/parent-portal/qa-sh15.test.ts`: card count 8 → 9 (finding 3).

## Requirement Results

| Requirement | Status | Evidence |
|---|---|---|
| FR-1 | PASS | `prisma/schema.prisma` enums InvoiceStatus/PaymentMethod/DiscountKind (+InvoiceReminderKind); migration `20261116000000_add_fees` applied; all fee integration suites write them |
| FR-2 | PASS | 12 fee models in `schema.prisma`, Decimal(10,2); `qa-sh17.test.ts` creates FeeItem/FeePlan/Line/Discount/StudentOptionalFee/StudentDiscount/Invoice/Payment/Allocation; DocumentSequence via `numbering.test.ts` |
| FR-3 | PASS | `InvoiceReminder` model with unique (invoiceId, kind, scheduledFor); `qa-sh17` "manual reminder…" asserts the P2002 on a duplicate slot |
| FR-4 | PASS | `SchoolSettings.currency/invoiceFooter`; DB check: USD + seeded footer; `access.test` `/api/me/fees` returns footer |
| FR-5 | PASS | `User.isBursar`; `access.test` "a non-bursar flag revoked in the DB takes effect at once"; `src/lib/validators/users.ts` |
| FR-6 | PASS | `qa-sh17` setup test (createFeeItem ×3); `access.test` POST /api/fees/items 201 for bursar. Update/archive by code review (`fees-service.ts` updateFeeItem/archiveFeeItem) |
| FR-7 | PASS | `qa-sh17` "plan PUT replaces lines" (lines replaced, total 2150.00) |
| FR-8 | PASS | `qa-sh17` createDiscount PERCENT/FIXED/auto rules; percent 100.01 → VALIDATION_ERROR |
| FR-9 | PASS | `qa-sh17` bulkAssignOptionalFee → `{assigned: 4}`; non-optional item refused |
| FR-10 | PASS | `qa-sh17` manual merit assigned with note; auto discount assignment refused |
| FR-11 | PASS | `fee-math.test` siblings; `qa-sh17` preview ranks 1/2/3/null, SIBLING_2ND only on rank 2, 3RD_PLUS only on rank 3 |
| FR-12 | PASS | `qa-sh17` preview test (plan + optional + manual + auto lines per student); e2e generate page |
| FR-13 | PASS | `qa-sh17` re-run: all rows `ALREADY_INVOICED`, 0 created; a manual term invoice does not skip |
| FR-14 | PASS | `qa-sh17` create-and-issue: ISSUED, issueDate today, dueDate today+30 (leap year), 3 `fees.invoice_issued` notifications; `e2e/fees.spec.ts` |
| FR-15 | PASS | `fee-math.test` AC1/AC2/clamp/half-up; `qa-sh17` AC1 2235.00 and AC2 −107.50 through the DB |
| FR-16 | PASS | `numbering.test` parallel INV/RCT 1..N gap-free; `ledger.ts` nextDocumentNumber; `qa-sh17` INV-2096-NNNNNN unique |
| FR-17 | PASS | `listInvoices` + `InvoicesTable.tsx`; `access.test` GET /api/fees/invoices; `qa-sh17` listInvoices |
| FR-18 | PASS | `reports.ts invoiceWhere` (status/term/grade/section/overdue/q); `qa-sh17` overdue+student filter, CSV `q`+term filter; totals in `listInvoices` meta (code review) |
| FR-19 | PASS | `getInvoice` lines/allocations/timeline from AuditLog; `ledger.test` reads lines and statuses; `qa-sh17` asserts `invoice.issue` audit rows |
| FR-20 | PASS | `qa-sh17` draft lifecycle: edit → 80.00, issue, then edit/delete/issue → CONFLICT; draft delete removes row |
| FR-21 | PASS | `ledger.test` adjust (negative isAdjustment line + reason, guard) and void refused with allocations |
| FR-22 | PASS | `getInvoice.allocations` with receipt numbers + `InvoiceActions.tsx` receipt links; e2e prints the receipt |
| FR-23 | PASS | `createManualInvoice` used by `ledger`, `access`, `qa-sh17` tests |
| FR-24 | PASS | `fee-math.test` deriveStatus; `ledger.test` PAID/PARTIALLY_PAID/ISSUED transitions + integrity checker |
| FR-25 | PASS | `qa-sh17` "a past-due ISSUED invoice reads as OVERDUE"; `markOverdue` hooked in `api/internal/email/dispatch/route.ts` |
| FR-26 | PASS | `getFamilyOpenInvoices` + `RecordPaymentForm.tsx`; e2e records a payment through the page |
| FR-27 | PASS | `recordPaymentSchema` in `validators/fees.ts`; `qa-sh17` payment with method/reference/payer/receivedAt |
| FR-28 | PASS | `fee-math.test` autoAllocate/validateAllocations; `ledger.test` oldest-first 500/100 and invalid allocations refused |
| FR-29 | PASS | `ledger.test` "refuses an overpayment… $1,000.00 and saves nothing" |
| FR-30 | PASS | `recordPayment` (RCT number, recompute, `fees.payment_received`, receiptUrl); `qa-sh17` RCT-2096 format; e2e opens receipt |
| FR-31 | PASS | `ledger.test` reverse → recompute, second reverse CONFLICT; payment row kept with `reversed: true` |
| FR-32 | PASS | `qa-sh17` listPayments: parent sees own payment, other parent none; `access.test` payment GET 200/404 |
| FR-33 | PASS | `fees/invoices/[id]/print/page.tsx` + `InvoiceDocument.tsx` (letterhead, lines, totals, footer, PrintButton). Code review + build; not exercised by a test |
| FR-34 | PASS | `money.test` amountInWords; `ReceiptDocument.tsx`; e2e prints the receipt |
| FR-35 | PASS | `money.test` formatMoney; overpayment message formatted `$1,000.00` (`ledger.test`) |
| FR-36 | PASS | `src/server/notifications/types.ts`; `tests/unit/notifications.test.ts` (FINANCE, PARENT, email on). Email delivery affected by finding 1 (pre-existing) |
| FR-37 | PASS | `maintenance.ts sendInvoiceReminders` + `fee-math.test` reminderSlot schedule + `qa-sh17` unique-key idempotency. Not run end to end (acts on the whole DB, see coverage note 1). Emails affected by finding 1 |
| FR-38 | PASS | `qa-sh17` remind: 1 recipient, 23 h → RATE_LIMITED, 25 h → OK |
| FR-39 | PASS | `access.test` `/api/me/fees` outstanding 60.00 + receiptUrl; e2e parent sees updated balance; `ParentFeesView.tsx` |
| FR-40 | PASS | `overview-service.ts` `fees` card + `OverviewCards.tsx`; `qa-sh17` outstandingByStudent 2000.00; `qa-sh15.test` 9 cards |
| FR-41 | PASS | `access.test` student 403 on all fee APIs; `navigation.ts` has no STUDENT entry |
| FR-42 | PASS | `qa-sh17` getDashboard billed/collected/12-week trend; `fee-math.test` agingBucket; `FeesDashboard.tsx` (StatCard, ChartA11y, top 10) |
| FR-43 | PASS | `dashboards/admin.ts` outstandingFees + `KpiRowWidget.tsx` "Outstanding fees". Code review + build |
| FR-44 | PASS | `qa-sh17` invoice CSV header/rows; `access.test` export 200 admin / 403 parent; payments/aging CSV by code review |
| FR-45 | PASS | `access.test` full matrix (bursar writes, admin read-only 403 on writes, teacher 403, parent scoped) |
| FR-46 | PASS | `src/config/navigation.ts` lines 67–82 |
| FR-47 | PASS | DB after seed: Alice Admin isBursar, USD, footer, Tuition/Lab fee/Bus service(optional)/Activity fee, Semester 1 plans Grades 6–8 |
| FR-48 | PASS | DB after seed: Sibling 5% SIBLING_2ND, Merit 10% manual; Grade 7: 3 PAID, 2 PARTIALLY_PAID, 1 ISSUED, 3 OVERDUE; 12 payments, 5 methods |
| FR-49 | PASS | `tests/unit/fees/fee-math.test.ts`, `money.test.ts` (23 tests) |
| FR-50 | PASS | `tests/integration/fees/numbering.test.ts`, `ledger.test.ts` (25-step seeded random integrity) |
| FR-51 | PASS | `tests/e2e/fees.spec.ts` passed against `next start` (QA run) |
| NFR-1 | PASS | Decimal throughout (`money.ts`); `ledger.test` integrity checker; DB check after reseed: amountPaid = Σ allocations on all 9 invoices |
| NFR-2 | PASS | `qa-sh17` audit rows on issue; deleteDraft refuses non-drafts; reversal keeps the payment row (`ledger.test`) |
| NFR-3 | PASS | `numbering.test` 8 parallel issues and 8 parallel payments → exactly 1..8 |
| NFR-4 | PASS | `access.test` other parent 404 on invoice/payment, draft hidden from parent; `qa-sh17` payment scope |
| NFR-5 | PASS | Batched draft build (≈8 queries) + 50-student chunk transactions in `fees-service.ts generateInvoices`; e2e generate in seconds. Not load-tested at full school size |
| NFR-6 | PASS | QA import scan of all fee UI files: only `@mui/*`, next, react, date-fns, internal; `npm run lint` (no-restricted-imports) clean. MUI MCP lookup is a process step QA can't re-verify |
| NFR-7 | PASS | Thin handlers under `src/app/api/fees/**` → `src/server/fees/fees-service.ts`; Zod in `validators/fees.ts` (pageSize ≤ 100, sort whitelist) |
| NFR-8 | PASS | `fee-math.test` NY-timezone case; `qa-sh17` @db.Date issue/due dates; `feeSettings().today` in school tz |
| NFR-9 | PASS | Reuses audit()/notify()/requireRole/DataTable/StatCard/useToast/toCsv; grep: no `console.log` in fee code |
| NFR-10 | PASS | lint/typecheck/build green; new tests added; remaining suite failures pre-date SH-17 or are shared-DB flakes passing in isolation (finding 4) |
| NFR-11 | PASS | No gateway or accounting dependencies (package.json unchanged); overpayment refused (no credit balances); single currency |
| NFR-12 | PASS | `InvoiceDocument.tsx` GlobalStyles `@page { size: A4 }` + `@media print`; PrintButton hidden in print. No CSS modules. Not visually verified |

## Open items for the team
- Finding 1 (email NUL bytes) needs its own ticket. It affects all notification emails, not only fees.
- D-12 (optional fees billed on every plan invoice of the year) is still an assumption to confirm with the PRD owner (Dev log).
- An isolated test DB would allow end-to-end tests of `sendInvoiceReminders`/`markOverdue` with injected dates and stop shared-DB flakes.
