# Dev Log — SH-17 (PRD-17 Fees, Invoices & Payment Records)

> Before this run, this file held the SH-15 log and `task-completion-markers.json` held SH-16 markers. Both are replaced for SH-17, following the precedent from earlier tickets. `dev-rerun-count.json` was left untouched because the engine owns it.

## Iteration 1 (2026-11-10)

All 32 tasks were implemented in one iteration, in dependency order. All 91 entries in `file-ownership-matrix.json` exist at their exact paths. No dependencies were added (ADR-1).

### Verification
| Gate | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean; `eslint tests/unit/fees tests/integration/fees` is also clean |
| Unit tests (FR-49) | 23/23 pass: `fee-math` (AC1 `2235.00`, AC2 `-107.50`, clamp, half-up, siblings, allocation, status, reminder slots, aging, NY timezone) and `money` |
| Integration tests (FR-50, real Postgres, `TEST_DATABASE_URL`) | 11/11 pass: FR-45 permission matrix through the real route handlers, 8 parallel issues and 8 parallel payments each numbered exactly 1..8, reversal and recompute, overpayment message, D-10 guard, and a 25-step seeded-random pay/reverse integrity check |
| `npm run build` | succeeds; every fee route is dynamic (only `/api/health` is prerendered) |
| E2E `tests/e2e/fees.spec.ts` (FR-51) | passes; run with `APP_URL=http://localhost:3200` because other processes hold ports 3000 and 3100 |
| `npm run db:seed` | runs and re-runs idempotently. Result: 9 Grade 7 invoices (3 PAID, 2 PARTIALLY_PAID, 1 ISSUED, 3 OVERDUE) and 12 payments across all 5 methods |
| Manual smoke (`next start`) | All 11 admin and print fee pages, plus dashboard, aging and the 3 CSV exports, return 200 for a bursar admin. Parent: `/fees` and `/api/me/fees` return 200 and are scoped to the family; admin APIs return 403. Teacher: fee pages redirect to `/forbidden` and fee APIs return 403. |

Migration `20261116000000_add_fees` was generated with `prisma migrate diff` and drops nothing. The raw SQL for the 3 partial unique indexes and 2 `CHECK (amount > 0)` constraints is appended to it. It is applied with `migrate deploy`, the client is regenerated, and there is no drift. The MUI MCP lookup (NFR-6) works: `useMuiDocs` returned the x-date-pickers 9.17 index. All components follow patterns already used in the repo against MUI 9.5.0, with system props in `sx` and `slotProps`. No banned imports.

### Failures that already existed (not caused by SH-17)
- `tests/unit/lockout.test.ts`, `auth-forms.test.tsx` and `useToast.test.tsx` fail on the pre-SH-17 baseline as well. I checked this with `git stash`.
- `tests/integration/dashboards/risk.test.ts` fails only in the full parallel run against the shared DB. It passes alone, both with and without SH-17 changes. This is the shared-DB flakiness noted in earlier logs.

### Implementation notes and deviations
- **File outside the matrix: `tests/unit/notifications.test.ts`.** One assertion changed. It expected the FINANCE category to have no types, and FR-36 deliberately adds three. Leaving it red would break the NFR-10 gate.
- **`Invoice.dueDays` (extra column).** A draft must know its due period when it is issued later. Plan invoices copy `plan.dueDays`; manual invoices take it from the input.
- **`nextDocumentNumber` is one statement.** It runs `INSERT … ON CONFLICT DO UPDATE SET nextValue = nextValue + 1 RETURNING`. This takes the same row lock, and a rollback undoes the increment, so it is equally gap-free, in one round trip instead of three (ADR-3 intent). The numbering test proves 1..N under parallel transactions.
- **`access.ts` loads `requireRole` lazily.** Auth.js / React `cache` cannot load outside Next, and the seed and tests call fees-service with an explicit actor.
- **`reports.ts` holds shared pieces.** These are the where builders and row serializers, plus `freshFeeSettings()` (settings + `markOverdue`). fees-service imports them; there is no import cycle.
- **Parent invoice detail hides the audit timeline.** `timeline` is `[]` for parents because it is internal. Payment detail and parent payment rows show only the parent's own children's allocations.
- **Manual invoices get no discounts.** Draft PATCH recomputes discount lines server-side for plan invoices only.
- **Seed: fee demo parents.** Payments need a payer family, and the local Grade 7 students (the risk cohort) have no parents. The seed creates `fees.parentN@schoolhub.test`, linked as primary parent only to Grade 7 students who have none. The first two share a parent, so the sibling rule shows (Hugo's invoice carries the 5% line). The 3 OVERDUE invoices come from `issue()` with `today − 45`, then `markOverdue`. Sam gets Merit 10% as a StudentDiscount. In this DB Sam has no grade profile, so Sam is not invoiced.
- **Record-payment picker.** `/api/students/:id/parents` has no GET, so the page server-renders `listPayerOptions()` (parents plus their children's names). The Autocomplete searches by parent or child name. No new endpoint.
- **Navigation.** The four admin entries sit under a "Fees" group (the nav has no nested children). Because the shell matches by prefix, `/admin/fees/*` also highlights "Fees".
- **FR-40 Fees card.** The page only owns `OverviewCards.tsx`, so the Fees item renders inside the existing Action items card when the balance is > 0. `getFeesSummary` is also added to `OVERVIEW_CARDS`, so `GET /api/students/:id/overview` gains a `fees` key (an additive change).
- **Admin KPI cache key bumped to `kpis-v2`.** A cache entry from before the deploy has no `outstandingFees` and crashed the KPI row during smoke testing; the new key avoids it.
- **Fees dashboard term choice.** It uses Chips that link to `?termId=` (a server component, no client select).
- **Open assumption (D-12).** Optional fees are billed on every plan invoice of the year. This is isolated in `buildInvoiceDrafts` and should be confirmed with the PRD owner.
- **`ponytail:` notes.**
  - Reminder scan covers all open invoices.
  - CSV exports are built in memory.
  - `/api/me/fees` returns the whole family history unpaginated.
  - Generation is synchronous and chunked (ADR-6).

### Checklist
- TASK-1: Prisma enums/models + migration 20261116000000_add_fees — ✓ complete
- TASK-2: src/lib/money.ts — ✓ complete
- TASK-3: Zod schemas src/lib/validators/fees.ts — ✓ complete
- TASK-4: pure fee-math.ts — ✓ complete
- TASK-5: unit tests fee-math + money — ✓ complete
- TASK-6: ledger.ts (numbers, locks, recompute, issue) — ✓ complete
- TASK-7: access.ts (FR-45 matrix) — ✓ complete
- TASK-8: fees.* notification types — ✓ complete
- TASK-9: User.isBursar via users validator/service — ✓ complete
- TASK-10: fees-service setup functions — ✓ complete
- TASK-11: setup API routes — ✓ complete
- TASK-12: maintenance.ts + dispatch hook — ✓ complete
- TASK-13: invoice services + reports.invoiceWhere — ✓ complete
- TASK-14: invoice API routes — ✓ complete
- TASK-15: payment services — ✓ complete
- TASK-16: payment API routes — ✓ complete
- TASK-17: reports (dashboard, aging, CSV, my fees, outstanding) — ✓ complete
- TASK-18: report API routes + /api/me/fees — ✓ complete
- TASK-19: shared fee UI components — ✓ complete
- TASK-20: invoice/receipt documents + print pages — ✓ complete
- TASK-21: navigation entries — ✓ complete
- TASK-22: /admin/fees/setup tabs — ✓ complete
- TASK-23: /admin/fees/invoices list + manual dialog — ✓ complete
- TASK-24: /admin/fees/invoices/generate — ✓ complete
- TASK-25: /admin/fees/invoices/[id] + actions — ✓ complete
- TASK-26: payment pages (list, new, detail + reverse) — ✓ complete
- TASK-27: /admin/fees dashboard — ✓ complete
- TASK-28: parent /fees page — ✓ complete
- TASK-29: admin KPI + parent overview fees card — ✓ complete
- TASK-30: seed — ✓ complete
- TASK-31: integration tests (access, numbering, ledger) — ✓ complete
- TASK-32: e2e fees.spec.ts — ✓ complete
