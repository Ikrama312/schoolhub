# File Structure — SH-17 (PRD-17 Fees, Invoices & Payment Records)

Phase: dev-planning · 2026-11-10T16:30:00Z · 32 tasks · 88 files (77 new, rest modified)

Brownfield: only the paths below change. Everything else (http.ts, audit, notify, csv, dates, DataTable, StatCard, ConfirmDialog, PageHeader, useToast) is reused as-is.

```
prisma/migrations/20261116000000_add_fees/migration.sql                        TASK-1 CREATE
prisma/schema.prisma                                                           TASK-1 MODIFY
prisma/seed.ts                                                                 TASK-30 MODIFY
src/app/(app)/admin/fees/_components/FeesDashboard.tsx                         TASK-27 CREATE
src/app/(app)/admin/fees/invoices/[id]/_components/InvoiceActions.tsx          TASK-25 CREATE
src/app/(app)/admin/fees/invoices/[id]/page.tsx                                TASK-25 CREATE
src/app/(app)/admin/fees/invoices/_components/InvoicesTable.tsx                TASK-23 CREATE
src/app/(app)/admin/fees/invoices/_components/ManualInvoiceDialog.tsx          TASK-23 CREATE
src/app/(app)/admin/fees/invoices/generate/_components/GenerateInvoices.tsx    TASK-24 CREATE
src/app/(app)/admin/fees/invoices/generate/page.tsx                            TASK-24 CREATE
src/app/(app)/admin/fees/invoices/page.tsx                                     TASK-23 CREATE
src/app/(app)/admin/fees/page.tsx                                              TASK-27 CREATE
src/app/(app)/admin/fees/payments/[id]/_components/ReversePaymentButton.tsx    TASK-26 CREATE
src/app/(app)/admin/fees/payments/[id]/page.tsx                                TASK-26 CREATE
src/app/(app)/admin/fees/payments/_components/PaymentsTable.tsx                TASK-26 CREATE
src/app/(app)/admin/fees/payments/new/_components/RecordPaymentForm.tsx        TASK-26 CREATE
src/app/(app)/admin/fees/payments/new/page.tsx                                 TASK-26 CREATE
src/app/(app)/admin/fees/payments/page.tsx                                     TASK-26 CREATE
src/app/(app)/admin/fees/setup/_components/DiscountsTab.tsx                    TASK-22 CREATE
src/app/(app)/admin/fees/setup/_components/FeeItemsTab.tsx                     TASK-22 CREATE
src/app/(app)/admin/fees/setup/_components/FeePlansTab.tsx                     TASK-22 CREATE
src/app/(app)/admin/fees/setup/_components/OptionalFeesTab.tsx                 TASK-22 CREATE
src/app/(app)/admin/fees/setup/_components/SetupTabs.tsx                       TASK-22 CREATE
src/app/(app)/admin/fees/setup/_components/StudentDiscountsTab.tsx             TASK-22 CREATE
src/app/(app)/admin/fees/setup/page.tsx                                        TASK-22 CREATE
src/app/(app)/dashboard/_components/widgets/KpiRowWidget.tsx                   TASK-29 MODIFY
src/app/(app)/fees/_components/ParentFeesView.tsx                              TASK-28 CREATE
src/app/(app)/fees/invoices/[id]/print/page.tsx                                TASK-20 CREATE
src/app/(app)/fees/page.tsx                                                    TASK-28 CREATE
src/app/(app)/fees/receipts/[paymentId]/print/page.tsx                         TASK-20 CREATE
src/app/(app)/my-children/[studentId]/OverviewCards.tsx                        TASK-29 MODIFY
src/app/api/fees/aging/route.ts                                                TASK-18 CREATE
src/app/api/fees/dashboard/route.ts                                            TASK-18 CREATE
src/app/api/fees/discounts/[id]/archive/route.ts                               TASK-11 CREATE
src/app/api/fees/discounts/[id]/route.ts                                       TASK-11 CREATE
src/app/api/fees/discounts/route.ts                                            TASK-11 CREATE
src/app/api/fees/export/aging/route.ts                                         TASK-18 CREATE
src/app/api/fees/export/invoices/route.ts                                      TASK-18 CREATE
src/app/api/fees/export/payments/route.ts                                      TASK-18 CREATE
src/app/api/fees/families/[parentId]/open-invoices/route.ts                    TASK-16 CREATE
src/app/api/fees/invoices/[id]/adjust/route.ts                                 TASK-14 CREATE
src/app/api/fees/invoices/[id]/issue/route.ts                                  TASK-14 CREATE
src/app/api/fees/invoices/[id]/remind/route.ts                                 TASK-14 CREATE
src/app/api/fees/invoices/[id]/route.ts                                        TASK-14 CREATE
src/app/api/fees/invoices/[id]/void/route.ts                                   TASK-14 CREATE
src/app/api/fees/invoices/generate/route.ts                                    TASK-14 CREATE
src/app/api/fees/invoices/preview/route.ts                                     TASK-14 CREATE
src/app/api/fees/invoices/route.ts                                             TASK-14 CREATE
src/app/api/fees/items/[id]/archive/route.ts                                   TASK-11 CREATE
src/app/api/fees/items/[id]/route.ts                                           TASK-11 CREATE
src/app/api/fees/items/route.ts                                                TASK-11 CREATE
src/app/api/fees/optional-fees/bulk/route.ts                                   TASK-11 CREATE
src/app/api/fees/payments/[id]/reverse/route.ts                                TASK-16 CREATE
src/app/api/fees/payments/[id]/route.ts                                        TASK-16 CREATE
src/app/api/fees/payments/route.ts                                             TASK-16 CREATE
src/app/api/fees/plans/[id]/route.ts                                           TASK-11 CREATE
src/app/api/fees/plans/route.ts                                                TASK-11 CREATE
src/app/api/fees/students/[id]/discounts/route.ts                              TASK-11 CREATE
src/app/api/fees/students/[id]/optional-fees/route.ts                          TASK-11 CREATE
src/app/api/internal/email/dispatch/route.ts                                   TASK-12 MODIFY
src/app/api/me/fees/route.ts                                                   TASK-18 CREATE
src/components/fees/AllocationEditor.tsx                                       TASK-19 CREATE
src/components/fees/InvoiceDocument.tsx                                        TASK-20 CREATE
src/components/fees/InvoiceLinesEditor.tsx                                     TASK-19 CREATE
src/components/fees/InvoiceStatusChip.tsx                                      TASK-19 CREATE
src/components/fees/MoneyText.tsx                                              TASK-19 CREATE
src/components/fees/PrintButton.tsx                                            TASK-19 CREATE
src/components/fees/ReceiptDocument.tsx                                        TASK-20 CREATE
src/config/navigation.ts                                                       TASK-21 MODIFY
src/lib/money.ts                                                               TASK-2 CREATE
src/lib/validators/fees.ts                                                     TASK-3 CREATE
src/lib/validators/users.ts                                                    TASK-9 MODIFY
src/server/dashboards/admin.ts                                                 TASK-29 MODIFY
src/server/fees/access.ts                                                      TASK-7 CREATE
src/server/fees/fee-math.ts                                                    TASK-4 CREATE
src/server/fees/fees-service.ts                                                TASK-10 CREATE, TASK-13 MODIFY, TASK-15 MODIFY
src/server/fees/ledger.ts                                                      TASK-6 CREATE
src/server/fees/maintenance.ts                                                 TASK-12 CREATE
src/server/fees/reports.ts                                                     TASK-13 CREATE, TASK-17 MODIFY
src/server/notifications/types.ts                                              TASK-8 MODIFY
src/server/parent/overview-service.ts                                          TASK-29 MODIFY
src/server/services/users.ts                                                   TASK-9 MODIFY
tests/e2e/fees.spec.ts                                                         TASK-32 CREATE
tests/integration/fees/access.test.ts                                          TASK-31 CREATE
tests/integration/fees/ledger.test.ts                                          TASK-31 CREATE
tests/integration/fees/numbering.test.ts                                       TASK-31 CREATE
tests/unit/fees/fee-math.test.ts                                               TASK-5 CREATE
tests/unit/fees/money.test.ts                                                  TASK-5 CREATE
```

## Notes

- `fees-service.ts` and `reports.ts` are built up across tasks (CREATE then MODIFY) so each dev iteration stays small: setup → invoices → payments → reports.
- `src/app/(app)/layout.tsx` / `shell.tsx` are **not** changed: fee nav does not depend on the bursar flag (all admins read fee pages), and pages get `isBursar(user)` from `src/server/fees/access.ts` to show write controls. Server-side `requireBursar` is the real guard (D-14 intent kept, one fewer file).
- `src/app/api/users/[id]/route.ts` is not changed: it already passes the validated body to `services/users.ts`, so `isBursar` only needs the validator + service edit (TASK-9).
- `src/server/http.ts` is not changed: list routes pass `meta` (with `totals`) through a variable, per the api-contracts note.
- D-12 (optional fees billed on every plan invoice in the year) remains an open assumption, isolated in `buildInvoiceDrafts` (TASK-13).
