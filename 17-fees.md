# PRD-17: Fees, Invoices & Payment Records

**Ticket:** SCH-017 · **Depends on:** PRD-00 – PRD-16 · **Run mode:** `--brownfield --tech-stack react`

## Summary

Fee management for the school office: define fee items and fee plans per grade level, generate invoices in bulk for a term, apply discounts and scholarships, record offline payments (cash, bank transfer, cheque, card terminal), issue printable receipts, track balances and overdue invoices, send reminders, and give parents a clear view of what they owe. Online card payment is deliberately out of scope.

## Platform Context (shared by every SchoolHub PRD)

SchoolHub is a single-school web platform for administrators, teachers, students and parents. It is built incrementally by a sequence of PRDs (PRD-00 … PRD-18). **When this PRD runs, every lower-numbered PRD is already implemented in the workspace.** Reuse existing models, services, components and helpers — never re-scaffold the project, never duplicate a helper that already exists, never rename existing routes or models.

### Fixed technology decisions

| Concern | Decision |
|---|---|
| Framework | Next.js 14 (App Router), React 18, TypeScript `strict: true` |
| UI components | **Material UI only** — `@mui/material` v9 (+ `@emotion/react`, `@emotion/styled`), `@mui/material-nextjs` (App Router cache provider), `@mui/icons-material`. Every component is looked up through the MUI MCP server first (see "UI component rule" below) |
| Theming | MUI `createTheme` with `cssVariables: true` and light/dark `colorSchemes`, `InitColorSchemeScript`, `useColorScheme()` for the toggle; styling only through the theme, the `sx` prop and `styled()` — no Tailwind, no CSS modules |
| Dates & pickers | `@mui/x-date-pickers` v9 (MIT) with `AdapterDateFns`; `date-fns` + `date-fns-tz` for logic |
| Database | PostgreSQL 16 via Prisma ORM (`prisma/schema.prisma`), migrations with `prisma migrate` |
| Auth | Auth.js (NextAuth v5) Credentials provider, JWT session strategy, bcrypt password hashes |
| Validation | Zod schemas in `src/lib/validators/<feature>.ts`, shared by client forms and API handlers |
| Forms | React Hook Form + `@hookform/resolvers/zod` |
| Data tables | `@mui/x-data-grid` v9 (MIT `DataGrid`, server-side pagination/sorting/filtering) wrapped by the shared `DataTable` component |
| Charts | `@mui/x-charts` v9 (MIT) |
| Email | Nodemailer via the `EmailOutbox` table (from PRD-04); dev transport logs to console |
| Calendar UI | `@mui/x-scheduler` (MIT Community `EventCalendar`; pin the exact version found via the MUI MCP — it is in beta) |
| Tests | Vitest + Testing Library (unit/integration), Playwright (e2e in `tests/e2e`) |
| Local infra | `docker-compose.yml` with Postgres; `.env.example` documents every env var |

### UI component rule (mandatory — applies to every screen in this PRD)

1. **Material UI components only.** Every visible UI element is built from `@mui/material`, `@mui/icons-material` or the MUI X packages listed above (`@mui/x-data-grid`, `@mui/x-date-pickers`, `@mui/x-charts`, `@mui/x-scheduler`) — composed with `Box`, `Stack`, `Grid` and the theme. Hand-styled raw HTML (`<div>`/`<button>`/`<table>` with custom CSS) is not allowed where an MUI component exists.
2. **Look up every component through the MUI MCP server (`mui-mcp`) before using it.** Call `useMuiDocs` with the package (for example `@mui/material@9.5.0`, `@mui/x-data-grid`) to get the docs index, then `fetchDocs` on the component's page, and use only props, slots and imports documented there for the installed version. Never write MUI code from memory, and never invent props. If the MCP server is unreachable, stop and report it as a blocker instead of guessing.
3. **Banned:** Tailwind CSS, shadcn/ui, Radix UI, Headless UI, Chakra UI, Ant Design, Bootstrap, `lucide-react`, `next-themes`, `@tanstack/react-table`, Recharts, FullCalendar, `react-select`, `react-datepicker`, `sonner`, `notistack` and any other component or styling library. PRD-00 enforces this with an ESLint `no-restricted-imports` rule.
4. **Allowed non-visual libraries** (they render no UI of their own): React Hook Form, Zod, `@dnd-kit/core` and `@dnd-kit/sortable` (drag behaviour only — draggable items are MUI components), `react-markdown` + `remark-gfm` + `rehype-sanitize` (every Markdown element is mapped to an MUI component through the `components` prop), `papaparse`, `date-fns`. Email templates (`@react-email/components`) are exempt because email clients cannot render MUI.
5. Shared wrappers live in `src/components/shared/` and are themselves built from MUI. Toasts use MUI `Snackbar` + `Alert` through the shared `useToast()` hook from PRD-00; side panels use `Drawer`; confirmations use `Dialog`; pickers and searchable selects use `Autocomplete`.
6. Intake must record this rule as a non-functional requirement, and QA must check it: no banned imports, and every MUI import resolves to a documented component.

### Code layout and conventions

- `src/app/(public)/…` public pages, `src/app/(auth)/…` sign-in flows, `src/app/(app)/…` authenticated app with the shared sidebar shell.
- `src/app/api/<feature>/…/route.ts` REST route handlers. Handlers are thin: parse with Zod → call a service → return JSON.
- `src/server/services/<feature>.ts` business logic and Prisma access. Server components may call services directly; client components call the REST API. New features follow PRD-05's precedent of a feature-named subdirectory instead: `src/server/<feature>/<feature>-service.ts` (for example `src/server/sections/sections-service.ts`), not this older flat path — which remains accurate only for the already-built PRD-02/03-era services that still live there.
- `src/server/auth/requireRole.ts` exposes `requireUser()`, `requireRole(...roles)` and per-entity access checks. Every handler and every server page enforces access server-side; hiding a button is never the only protection.
- Response shape: success `{ "data": … }`; list `{ "data": [...], "page": 1, "pageSize": 20, "total": 134 }`; error `{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details": {…} } }`. Error codes: `VALIDATION_ERROR` (400), `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `RATE_LIMITED` (429), `INTERNAL` (500).
- Pagination: `?page=` (default 1) and `?pageSize=` (default 20, maximum 100). Sorting: `?sort=field&order=asc|desc`. Search: `?q=`.
- IDs are `cuid()` strings. Every model has `createdAt` and `updatedAt`. Timestamps are stored in UTC and displayed in the school timezone from `SchoolSettings.timezone`. Date-only values use `@db.Date`.
- Sidebar navigation lives in `src/config/navigation.ts` as an array of `{ label, href, icon, roles }`. A PRD that adds a page adds its nav entry there.
- Student detail page `/students/[studentId]` is tab-based; tabs are registered in `src/config/student-tabs.ts`. Feature PRDs add a tab there instead of creating a separate student page.
- Mutations that change records owned by someone else write an `AuditLog` row through `audit()` (from PRD-01).
- Notifications go through `notify()` (from PRD-04). Notification type keys are registered in `src/server/notifications/types.ts`.
- No `console.log` in committed code except the dev email transport; use the `logger` from `src/lib/logger.ts`.

### Roles

`ADMIN` (school office staff and principal), `TEACHER`, `STUDENT`, `PARENT` (parent or guardian). A user has exactly one role. Parents see data only for students linked to them; students see only their own data; teachers see data for courses they teach and sections they are homeroom teacher of; admins see everything.

### Assumptions and constraints

- **Assumptions:** one school per deployment (no multi-tenancy); English-only UI; the school timezone is the reference for every date rule; users have a modern evergreen browser (last 2 versions of Chrome, Edge, Firefox, Safari).
- **Constraints:** this PRD is delivered in a single forge run, so its scope must not expand beyond the sections below; do not modify behaviour owned by later PRDs; keep all existing tests passing (`npm run lint && npm run typecheck && npm run test`) and add the tests listed in this PRD.
- **Delivery milestones:** Milestone 1 "Core platform" = PRD-00 – PRD-05 · Milestone 2 "Teaching & learning" = PRD-06 – PRD-11 · Milestone 3 "Communication" = PRD-12 – PRD-15 · Milestone 4 "Operations & public" = PRD-16 – PRD-18.

## Background

The office tracks fees in spreadsheets and prints invoices by hand; parents call to ask for balances and lost receipts. A built-in ledger with invoices, payment records and parent visibility removes the spreadsheets and most of the calls. The school takes payments in person or by bank transfer, so recording payments (not processing them) is the requirement.

## Goals

1. The office generates a term's invoices for every student in under 5 minutes.
2. Every payment produces a receipt with a unique sequential number, and balances are always derivable from the ledger.
3. Parents see all their children's invoices, balances and receipts without contacting the office.

## Out of Scope

- Online payment gateways (Stripe, PayPal) and stored cards.
- Accounting system export beyond CSV (no QuickBooks/Xero integration).
- Multi-currency — one school currency (`SchoolSettings.currency`, ISO 4217, default `USD`).
- Tax/VAT calculation.

## User Stories

- As an admin (bursar), I want to define fee items and plans per grade level so that invoices are generated consistently.
- As an admin, I want to generate invoices for a term in bulk so that every family is billed at once.
- As an admin, I want to apply sibling discounts and scholarships so that families are billed correctly.
- As an admin, I want to record a payment and print a receipt so that families have proof of payment.
- As an admin, I want to see outstanding and overdue balances and send reminders so that collection improves.
- As a parent, I want to see invoices, balances and receipts for my children so that I know what I owe.

## Functional Requirements

### FR-1 Data model

```prisma
enum InvoiceStatus { DRAFT ISSUED PARTIALLY_PAID PAID OVERDUE VOID }
enum PaymentMethod { CASH BANK_TRANSFER CHEQUE CARD_TERMINAL OTHER }
enum DiscountKind { PERCENT FIXED }

model FeeItem {
  id          String   @id @default(cuid())
  name        String                       // "Tuition", "Lab fee", "Bus service"
  code        String   @unique
  description String?
  defaultAmount Decimal @db.Decimal(10, 2) // > 0
  isOptional  Boolean  @default(false)     // optional items (bus) are assigned per student
  archivedAt  DateTime?
}

model FeePlan {
  id             String   @id @default(cuid())
  academicYearId String
  termId         String?                    // null = annual
  gradeLevelId   String
  name           String                     // "Grade 7 – Semester 1"
  dueDays        Int      @default(30)      // due date = issue date + dueDays
  lines          FeePlanLine[]
  @@unique([termId, gradeLevelId])
}

model FeePlanLine {
  id        String  @id @default(cuid())
  planId    String
  plan      FeePlan @relation(fields: [planId], references: [id], onDelete: Cascade)
  feeItemId String
  amount    Decimal @db.Decimal(10, 2)
}

model StudentOptionalFee {               // opt-in items (e.g. bus) per student per year
  studentId      String
  feeItemId      String
  academicYearId String
  amount         Decimal @db.Decimal(10, 2)
  @@id([studentId, feeItemId, academicYearId])
}

model Discount {
  id          String       @id @default(cuid())
  name        String                       // "Sibling discount", "Merit scholarship"
  kind        DiscountKind
  value       Decimal      @db.Decimal(10, 2) // percent 0–100 or fixed amount
  autoRule    String?                      // "SIBLING_2ND" | "SIBLING_3RD_PLUS" | null (manual)
  archivedAt  DateTime?
}

model StudentDiscount {
  studentId      String
  discountId     String
  academicYearId String
  note           String?
  @@id([studentId, discountId, academicYearId])
}

model Invoice {
  id            String        @id @default(cuid())
  number        String        @unique         // "INV-2026-000123", sequential per year
  studentId     String
  student       User          @relation(fields: [studentId], references: [id])
  termId        String?
  status        InvoiceStatus @default(DRAFT)
  issueDate     DateTime?     @db.Date
  dueDate       DateTime?     @db.Date
  subtotal      Decimal       @db.Decimal(10, 2)
  discountTotal Decimal       @db.Decimal(10, 2) @default(0)
  total         Decimal       @db.Decimal(10, 2)
  amountPaid    Decimal       @db.Decimal(10, 2) @default(0)   // denormalised, kept in sync in the same transaction
  notes         String?
  voidReason    String?
  createdById   String
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
  lines         InvoiceLine[]
  allocations   PaymentAllocation[]
  @@index([studentId, status])
}

model InvoiceLine {
  id          String  @id @default(cuid())
  invoiceId   String
  invoice     Invoice @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
  description String
  feeItemId   String?
  quantity    Int     @default(1)
  unitAmount  Decimal @db.Decimal(10, 2)
  amount      Decimal @db.Decimal(10, 2)       // quantity × unitAmount; negative for discount lines
  isDiscount  Boolean @default(false)
}

model Payment {
  id            String        @id @default(cuid())
  receiptNumber String        @unique         // "RCT-2026-000045", sequential per year
  payerName     String
  payerParentId String?
  amount        Decimal       @db.Decimal(10, 2)  // > 0
  method        PaymentMethod
  reference     String?                         // bank ref, cheque number
  receivedAt    DateTime
  recordedById  String
  notes         String?
  reversedAt    DateTime?
  reversalReason String?
  createdAt     DateTime      @default(now())
  allocations   PaymentAllocation[]
}

model PaymentAllocation {
  id        String  @id @default(cuid())
  paymentId String
  payment   Payment @relation(fields: [paymentId], references: [id])
  invoiceId String
  invoice   Invoice @relation(fields: [invoiceId], references: [id])
  amount    Decimal @db.Decimal(10, 2)
}

model DocumentSequence {
  key    String @id                          // "INV-2026", "RCT-2026"
  value  Int
}
```

Add `currency String @default("USD")` and `invoiceFooter String?` (bank details, payment instructions) to `SchoolSettings`.

### FR-2 Fee setup (`/admin/fees/setup`)
1. Tabs: Fee items (CRUD), Fee plans (per year/term × grade level with line editor and computed total), Discounts (CRUD; auto rules SIBLING_2ND applies to the second-youngest-enrolled sibling onward with the same primary parent, SIBLING_3RD_PLUS to third onward), Optional fees (assign items like Bus to students, with bulk assign by section), Student discounts (assign manual discounts such as scholarships).

### FR-3 Invoice generation (`/admin/fees/invoices/generate`)
1. Choose term (or annual) and grade levels → preview table per student: plan lines, optional fees, discounts (manual + auto sibling), total. Students that already have an invoice for that term are listed as "Skipped — already invoiced".
2. "Create drafts" creates DRAFT invoices; "Create and issue" also issues them (assigns number, issue date = today, due date = today + `dueDays`, status ISSUED) and notifies parents.
3. Discount application order: percent discounts apply to the subtotal of non-optional lines; fixed discounts after; total never below 0. Each discount is a negative `InvoiceLine` with `isDiscount`.
4. Numbers are allocated from `DocumentSequence` inside the issuing transaction (`SELECT … FOR UPDATE`) so numbers are gap-free and unique even under concurrency.

### FR-4 Invoices (`/admin/fees/invoices`)
1. Table: number, student, grade/section, term, issue date, due date, total, paid, balance, status badge. Filters: status, term, grade level, section, overdue only, search by student or number. Totals row for the filtered set (total billed, paid, outstanding).
2. Invoice detail: header, lines, allocations (payments applied), balance, activity timeline (audit). Actions by status: DRAFT → edit lines / issue / delete; ISSUED/PARTIALLY_PAID/OVERDUE → record payment / add adjustment line (creates a credit note style negative line with reason, audited) / void (only when no allocations; requires reason); PAID → view receipt(s).
3. Manual invoice: create a one-off invoice for a student (for example a trip fee) with free-form lines.
4. Status rules (recomputed in the same transaction after every allocation or adjustment): `amountPaid >= total` → PAID; `0 < amountPaid < total` → PARTIALLY_PAID; issued with `amountPaid = 0` → ISSUED; ISSUED or PARTIALLY_PAID past `dueDate` → OVERDUE (applied by the maintenance run daily and on read).

### FR-5 Recording payments (`/admin/fees/payments/new`)
1. Select parent or student → shows all open invoices of the family (all linked children) with balances. Enter amount, method, reference, received date/time, payer name (defaults to primary parent), notes.
2. Allocation: default auto-allocates oldest due first; the bursar can edit per-invoice allocations. Sum of allocations must equal the payment amount; an allocation can't exceed the invoice balance. Overpayment is refused ("Amount exceeds the family's outstanding balance of $1,240.00") — credit balances are out of scope.
3. Saving assigns a receipt number and opens the receipt.
4. Reversal (ADMIN, requires reason): marks the payment reversed, deletes its allocations' effect (recompute invoices) — never deletes the payment row. Audited.

### FR-6 Receipts and invoice printouts
1. `/fees/invoices/[id]/print` and `/fees/receipts/[paymentId]/print`: A4 layouts with school letterhead, number, dates, student/payer, lines, totals, amount in words for receipts ("One thousand two hundred forty dollars and 00/100"), invoice footer from settings; "Print / Save as PDF" via `window.print()`.
2. Amount formatting uses `Intl.NumberFormat` with the school currency.

### FR-7 Reminders
1. Register `fees.invoice_issued` (default email true), `fees.payment_received` (default email true, includes receipt link), `fees.overdue_reminder` (default email true).
2. Overdue reminders: the maintenance run sends a reminder to the primary parent (and other linked parents) 3 days before due date, on the due date + 1 day, and every 14 days thereafter while overdue (track in `InvoiceReminder { invoiceId, kind, sentAt }`). Admin can also send a manual reminder from the invoice (throttled to once per 24 hours).

### FR-8 Parent view (`/fees`)
1. PARENT: summary card (total outstanding across children, next due date, overdue amount in red), invoice list across children with status and balance, invoice detail and print, payment history with receipts. Footer shows the invoice payment instructions from settings.
2. Child overview (PRD-15) gains a "Fees" card when the child has an outstanding balance.
3. Students do not see fees.

### FR-9 Fees dashboard and reports
1. `/admin/fees`: KPI cards (billed this term, collected, outstanding, overdue, collection rate %), collection trend chart by week, aging buckets (current, 1–30, 31–60, 61–90, 90+ days overdue), top 10 overdue families.
2. Add an "Outstanding fees" `StatCard` to the admin dashboard (PRD-16).
3. Exports: invoices CSV, payments CSV (date range, method), aging report CSV.

### FR-10 Permissions
1. Add `isBursar Boolean @default(false)` to `User` (ADMIN only). All fee write actions require ADMIN with `isBursar`; other admins have read-only access to fee pages. Teachers have no access.

## API

| Method & path | Role | Notes |
|---|---|---|
| `GET/POST /api/fees/items`, `PATCH /api/fees/items/:id` | bursar (read: ADMIN) | |
| `GET/POST /api/fees/plans`, `PUT /api/fees/plans/:id` | bursar | Lines replaced in full |
| `GET/POST /api/fees/discounts`, `PATCH /api/fees/discounts/:id` | bursar | |
| `PUT /api/fees/students/:id/optional-fees` · `/discounts` | bursar | |
| `POST /api/fees/invoices/preview` | bursar | `{ termId, gradeLevelIds }` |
| `POST /api/fees/invoices/generate` | bursar | `{ termId, gradeLevelIds, issue: boolean }` |
| `GET /api/fees/invoices` · `GET /api/fees/invoices/:id` | ADMIN; PARENT (own children only) | |
| `POST /api/fees/invoices` | bursar | Manual invoice |
| `PATCH /api/fees/invoices/:id` · `DELETE` | bursar | DRAFT only |
| `POST /api/fees/invoices/:id/issue` · `/void` · `/adjust` · `/remind` | bursar | |
| `GET /api/fees/families/:parentId/open-invoices` | bursar | |
| `POST /api/fees/payments` | bursar | `{ amount, method, reference, receivedAt, payerName, payerParentId, allocations: [{ invoiceId, amount }] }` |
| `POST /api/fees/payments/:id/reverse` | bursar | `{ reason }` |
| `GET /api/fees/payments` · `/:id` | ADMIN; PARENT (own) | |
| `GET /api/fees/dashboard` · `/aging` | ADMIN | |
| `GET /api/me/fees` | PARENT | Summary + lists |

## Non-Functional Requirements

1. **Correctness:** money is `Decimal` everywhere with 2-decimal rounding half-up; `amountPaid` must always equal the sum of non-reversed allocations — enforced by recomputation in every write transaction and checked by an integrity test.
2. **Auditability:** issued invoices and payments are never hard-deleted; every change writes an audit entry with before/after values.
3. **Concurrency:** generating invoices and recording payments in parallel never produces duplicate or skipped document numbers.
4. **Security:** parents only access invoices of linked children; IDs in URLs are always access-checked.

## Acceptance Criteria

1. Given a Grade 7 Semester 1 plan of Tuition $2,000 + Lab fee $150, Sam with Bus $300 optional and a 10 % merit scholarship, then Sam's preview shows subtotal $2,450.00, discount −$215.00 (10 % of $2,150 non-optional), total $2,235.00.
2. Given Pat's second child Sara also in Grade 7 with the auto rule SIBLING_2ND = 5 %, then Sara's preview includes a sibling discount line of −$107.50.
3. Given invoices are issued for 30 students concurrently with a manual invoice, then all numbers are unique and consecutive.
4. Given Sam's invoice of $2,235.00, when the bursar records $1,000 by bank transfer, then status becomes PARTIALLY_PAID, balance $1,235.00, a receipt RCT-2026-… prints with the amount in words, and Pat is notified.
5. Given a payment of $3,000 for a family owing $2,500, then the overpayment error appears and nothing is saved.
6. Given a payment is reversed, then the invoice returns to its previous status and balance, and the payment row remains with "Reversed" status.
7. Given an issued invoice passes its due date unpaid, then it shows OVERDUE and the parent receives the day-after-due reminder exactly once.
8. Given an admin without `isBursar`, when they try to record a payment, then `403`; a teacher opening `/admin/fees` gets `403`.
9. Given Pat opens `/fees`, then Sam's and Sara's invoices and receipts appear with the correct total outstanding; Sam (student) sees no Fees menu.

## Test Requirements

- Unit: discount calculation order, sibling rule detection, auto-allocation oldest-first, amount-in-words, status transitions.
- Integration: concurrent number allocation, reversal recomputation, `amountPaid` integrity check across random sequences of payments/reversals.
- Playwright: bursar generates term invoices, records a payment and prints the receipt; parent sees the updated balance.

## Seed Data

- Alice Admin is a bursar. Currency USD; invoice footer with sample bank details.
- Fee items: Tuition, Lab fee, Bus service (optional), Activity fee. Plans for Grades 6–8 Semester 1.
- Discounts: Sibling (SIBLING_2ND 5 %), Merit scholarship (10 %, manual, assigned to Sam).
- Issued Semester 1 invoices for Grade 7 with a mix of PAID, PARTIALLY_PAID, ISSUED and 3 OVERDUE; 12 payments across methods.
