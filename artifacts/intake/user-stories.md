# SH-17 — PRD-17 Fees, Invoices & Payment Records: User Stories

Roles: **Bursar** = ADMIN with `isBursar=true`; **Admin** = any ADMIN (read-only on fees unless bursar); **Parent**; Student and Teacher have no fee access.

## Data & settings
- **US-1 (FR-1, FR-2, FR-3)** As a bursar, I want fee items, plans, discounts, invoices, payments, allocations and number sequences stored in the database, so that balances are always derivable from the ledger.
- **US-2 (FR-4)** As a bursar, I want to set the school currency and an invoice footer with bank details, so that printouts and the parent view show how to pay.
- **US-3 (FR-5, FR-45)** As a principal, I want only bursar-flagged admins to change fee data, so that other office staff can look but not alter the ledger.

## Fee setup
- **US-4 (FR-6)** As a bursar, I want to manage fee items (tuition, lab fee, bus), so that plans and invoices use consistent names and amounts.
- **US-5 (FR-7)** As a bursar, I want to define a fee plan per term (or annual) and grade level with a line editor and a computed total, so that invoices are generated consistently.
- **US-6 (FR-8, FR-11)** As a bursar, I want percent or fixed discounts, including automatic sibling rules, so that families with several children are billed correctly without manual work.
- **US-7 (FR-9)** As a bursar, I want to assign optional fees such as Bus to individual students or a whole section, so that only those who use the service are billed.
- **US-8 (FR-10)** As a bursar, I want to assign scholarships and other manual discounts to students, so that their invoices reflect them.

## Invoice generation & management
- **US-9 (FR-12, FR-13)** As a bursar, I want to preview a term's invoices per student, with already-invoiced students skipped, so that I can check totals before billing.
- **US-10 (FR-14, FR-16)** As a bursar, I want to create drafts or create and issue invoices in bulk with unique sequential numbers, so that every family is billed at once.
- **US-11 (FR-15)** As a bursar, I want percent discounts applied to non-optional lines first and fixed discounts after, never going below zero, so that discounts are fair and predictable.
- **US-12 (FR-17, FR-18)** As an admin, I want to filter and search invoices and see totals for billed, paid and outstanding, so that I know where collection stands.
- **US-13 (FR-19–FR-22)** As a bursar, I want to edit, issue or delete drafts and adjust or void issued invoices with a reason, with every change in the activity timeline, so that corrections stay auditable.
- **US-14 (FR-23)** As a bursar, I want to create a one-off manual invoice (for example a trip fee), so that ad-hoc charges go through the same ledger.
- **US-15 (FR-24, FR-25)** As an admin, I want invoice status to update automatically (partially paid, paid, overdue), so that the list always reflects reality.

## Payments & receipts
- **US-16 (FR-26, FR-27, FR-28)** As a bursar, I want to pick a parent or student, see the family's open invoices, and record a payment that is auto-allocated oldest-first (editable), so that payments go to the right invoices.
- **US-17 (FR-29)** As a bursar, I want overpayments refused with a clear message, so that no unsupported credit balances appear.
- **US-18 (FR-30, FR-34)** As a bursar, I want saving a payment to issue a numbered receipt with the amount in words and notify the parent, so that families have proof of payment.
- **US-19 (FR-31)** As a bursar, I want to reverse a mistaken payment with a reason, without deleting it, so that the ledger stays correct and auditable.
- **US-20 (FR-33, FR-35)** As a bursar or parent, I want an A4 printable invoice formatted in the school currency, so that I can print it or save it as a PDF.

## Reminders
- **US-21 (FR-36, FR-37)** As a bursar, I want parents reminded automatically before the due date, the day after it, and every 14 days while overdue, so that collection improves without manual chasing.
- **US-22 (FR-38)** As a bursar, I want to send a manual reminder from an invoice (at most once a day), so that I can follow up on specific cases.

## Parent view
- **US-23 (FR-39, FR-32)** As a parent, I want to see my children's invoices, total outstanding, next due date, overdue amount, payment history and receipts, so that I know what I owe without calling the office.
- **US-24 (FR-40)** As a parent, I want a Fees card on my child's overview when there is a balance, so that I notice outstanding fees.
- **US-25 (FR-41)** As a student, I don't see fees at all, so that family finances stay with parents.

## Dashboard & reports
- **US-26 (FR-42)** As an admin, I want a fees dashboard with KPIs, a weekly collection trend, aging buckets and the top overdue families, so that I can prioritise follow-up.
- **US-27 (FR-43)** As an admin, I want an "Outstanding fees" card on my main dashboard, so that I see the figure every day.
- **US-28 (FR-44)** As a bursar, I want invoices, payments and aging CSV exports, so that I can reconcile with our accountant.

## Navigation, seed, tests
- **US-29 (FR-46)** As a user, I want Fees in the sidebar only when my role can use it.
- **US-30 (FR-47, FR-48)** As a developer, I want seed data (Alice as bursar, plans for Grades 6–8, Sam's scholarship, mixed-status invoices, 12 payments), so that demos and e2e tests have realistic data.
- **US-31 (FR-49, FR-50, FR-51)** As QA, I want unit, integration and Playwright coverage of discounts, allocation, numbering, reversal and the bursar-to-parent flow.

## Acceptance criteria trace
| AC | Requirements |
|---|---|
| 1 Sam: subtotal 2,450.00, discount −215.00, total 2,235.00 | FR-15, FR-12 |
| 2 Sara sibling −107.50 | FR-11, FR-15 |
| 3 Concurrent numbering | FR-16, NFR-3 |
| 4 $1,000 partial payment, receipt, notification | FR-24, FR-30, FR-34 |
| 5 Overpayment refused | FR-29 |
| 6 Reversal restores status | FR-31, FR-24 |
| 7 OVERDUE + day-after reminder once | FR-25, FR-37 |
| 8 Non-bursar 403, teacher 403 | FR-45 |
| 9 Parent `/fees`, no student menu | FR-39, FR-41 |

## Non-Functional Requirements
- **NFR-1** Decimal money with half-up 2 dp rounding; `amountPaid` = sum of non-reversed allocations, plus an integrity test.
- **NFR-2** No hard delete of issued invoices or payments; every change is audited with before/after values.
- **NFR-3** Gap-free, unique invoice and receipt numbers under concurrency.
- **NFR-4** Parents see only linked children; every URL ID is access-checked server-side.
- **NFR-5** A full term's generation finishes in under 5 minutes.
- **NFR-6** MUI-only UI, with every component looked up through the MUI MCP; no banned libraries (QA-checked).
- **NFR-7** Thin Zod handlers and the `src/server/fees/` service, using the standard response, error and pagination shapes.
- **NFR-8** UTC storage and school-timezone date rules.
- **NFR-9** Reuse existing helpers and components; no duplicates or renames; logger instead of console.log.
- **NFR-10** lint, typecheck and test stay green.
- **NFR-11** Out of scope: gateways, accounting integrations, multi-currency, tax, credit balances.
- **NFR-12** A4 print layouts through the browser print dialog.
