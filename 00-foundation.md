# PRD-00: Project Foundation, App Shell & Design System

**Ticket:** SCH-000 · **Depends on:** none (greenfield) · **Run mode:** `--greenfield --tech-stack react`

## Summary

Create the SchoolHub Next.js project from an empty directory: tooling, database connection, shared UI primitives, the authenticated app shell (sidebar + top bar), public layout, error pages, API helpers and test harness. No business features are built here. Every later PRD builds on top of what this PRD creates, so the conventions established here must match the Platform Context section exactly.

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
- `src/server/services/<feature>.ts` business logic and Prisma access. Server components may call services directly; client components call the REST API.
- `src/server/auth/permissions.ts` exposes `requireUser()`, `requireRole(...roles)` and per-entity access checks. Every handler and every server page enforces access server-side; hiding a button is never the only protection.
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

SchoolHub will be built by 19 sequential PRDs. Without a consistent foundation each feature would invent its own response format, layout and validation style. This PRD fixes those choices once, in code, so later runs extend instead of re-inventing.

## Goals

1. A developer can clone the repo, run `docker compose up -d && npm install && npm run db:migrate && npm run db:seed && npm run dev` and see the app at `http://localhost:3000` in under 5 minutes.
2. All shared helpers named in the Platform Context exist and are covered by unit tests.
3. `npm run lint`, `npm run typecheck`, `npm run test` and `npm run test:e2e` all pass on a fresh clone.

## Out of Scope

- Authentication, users and roles (PRD-01). In this PRD the app shell renders with a hard-coded placeholder user so it can be viewed; PRD-01 replaces that.
- Any school data model other than `SchoolSettings`.
- Deployment pipelines and hosting configuration.

## User Stories

- As a developer, I want a single command sequence to boot the project locally so that I can start building features immediately.
- As a developer, I want shared API, validation and layout helpers so that every feature behaves consistently.
- As any user, I want a clean, responsive layout that works on phone, tablet and desktop so that I can use SchoolHub on any device.

## Functional Requirements

### FR-1 Project scaffold
1. The project must be created with Next.js 14 App Router, TypeScript strict mode, ESLint (`next/core-web-vitals` + `@typescript-eslint/recommended`) and Prettier.
2. `package.json` must define these scripts: `dev`, `build`, `start`, `lint`, `typecheck` (`tsc --noEmit`), `test` (Vitest), `test:e2e` (Playwright), `db:migrate` (`prisma migrate dev`), `db:deploy` (`prisma migrate deploy`), `db:seed` (`tsx prisma/seed.ts`), `db:reset`, `format`.
3. Path alias `@/*` must map to `src/*`.
4. `docker-compose.yml` must start PostgreSQL 16 on port 5432 with a named volume, database `schoolhub`, user/password `schoolhub`.
5. `.env.example` must list every env var with a comment. Initial vars: `DATABASE_URL`, `APP_URL`, `AUTH_SECRET`, `NODE_ENV`.
6. `src/lib/env.ts` must validate `process.env` with Zod at startup and throw a readable error naming each missing or invalid variable.

### FR-2 Database
1. `prisma/schema.prisma` must use the `postgresql` provider and define the singleton model below.
2. `src/server/db.ts` must export a single `prisma` client instance (globalThis-cached in development to survive hot reload).
3. `prisma/seed.ts` must be idempotent (re-running it never creates duplicates) and must create the `SchoolSettings` row.

```prisma
model SchoolSettings {
  id            String   @id @default("singleton")
  name          String   @default("SchoolHub Academy")
  shortName     String   @default("SchoolHub")
  logoUrl       String?
  timezone      String   @default("UTC")
  addressLine1  String?
  addressLine2  String?
  city          String?
  country       String?
  phone         String?
  email         String?
  website       String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

### FR-3 API helpers (`src/server/http.ts`)
1. `ok(data, init?)` returns `NextResponse.json({ data })`.
2. `paginated(data, { page, pageSize, total })` returns the list shape from the Platform Context.
3. `apiError(code, message, details?)` returns the error shape with the HTTP status mapped from the code table.
4. `withHandler(fn)` wraps a route handler: catches `ZodError` → `VALIDATION_ERROR` with flattened field errors in `details`; catches `AppError` (custom class with `code`) → mapped status; catches Prisma `P2002` → `CONFLICT`, `P2025` → `NOT_FOUND`; anything else → `INTERNAL` with the stack logged and never returned to the client.
5. `parsePagination(searchParams)` returns `{ page, pageSize, skip, take }`, clamping `pageSize` to a maximum of 100 and `page` to a minimum of 1.
6. `parseBody(request, schema)` and `parseQuery(searchParams, schema)` run Zod and throw on failure.

### FR-4 Health endpoint
1. `GET /api/health` must return `200 { "data": { "status": "ok", "db": "ok", "time": "<ISO>" } }` when a `SELECT 1` succeeds within 2000 ms, and `503` with `"db": "error"` otherwise.

### FR-5 Design system
1. Install `@mui/material`, `@emotion/react`, `@emotion/styled`, `@mui/material-nextjs`, `@mui/icons-material`, `@mui/x-data-grid`, `@mui/x-date-pickers` and `@mui/x-charts` at the versions the MUI MCP reports for the Material UI v9 / MUI X v9 pairing. Because the project uses React 18, also install `react-is@18.3.1` and add `"overrides": { "react-is": "^18.3.1" }` to `package.json`, as the MUI installation docs require. Read the MUI MCP pages "Installation", "App Router integration guide" (`integrations/nextjs`), "CSS theme variables" and "Dark mode" before writing any setup code.
2. `src/theme/theme.ts` builds the theme with `createTheme({ cssVariables: { colorSchemeSelector: 'class' }, colorSchemes: { light, dark } })`: primary `#4F46E5`, secondary `#0EA5E9`, error/warning/success/info palette values that meet 4.5:1 contrast, `shape.borderRadius` 8, the Roboto font loaded with `next/font/google`, and component default props (for example `MuiButton` `disableElevation`, `MuiTextField` `size: 'small'` in dense tables). The root layout wraps the app in `AppRouterCacheProvider` + `ThemeProvider` + `CssBaseline` + `LocalizationProvider` (`AdapterDateFns`), and renders `InitColorSchemeScript` to avoid a flash of the wrong mode. The default mode follows the system preference, and the top-bar toggle (an MUI `IconButton` with `LightMode`/`DarkMode` icons) calls `useColorScheme().setMode`.
3. ESLint `no-restricted-imports` must fail the build on any banned library from the UI component rule (`tailwindcss`, `@radix-ui/*`, `@headlessui/*`, `lucide-react`, `next-themes`, `@tanstack/react-table`, `recharts`, `@fullcalendar/*`, `react-select`, `react-datepicker`, `sonner`, `notistack`, `antd`, `@chakra-ui/*`, `react-bootstrap`). No `tailwind.config.*` or `postcss` Tailwind plugin may exist.
4. Shared components in `src/components/shared/`, each built only from MUI components looked up through the MUI MCP:
   - `PageHeader` — `Typography` title, optional description, optional MUI `Breadcrumbs`, optional right-side actions slot (`Stack`).
   - `DataTable` — wraps MUI X `DataGrid` with `paginationMode="server"`, `sortingMode="server"`, `rowCount` from the API `total`, a debounced (300 ms) search `TextField` in a custom toolbar slot, a `noRowsOverlay` slot that renders `EmptyState`, `loading` skeleton overlay, and URL-synced `page`/`pageSize`/`sort`/`q` query params. Props: `columns` (`GridColDef[]`), `rows`, `total`, `loading`.
   - `EmptyState` — MUI icon, `Typography` title and description, optional `Button` action, centred in a `Stack`.
   - `ConfirmDialog` — MUI `Dialog` with `DialogTitle`/`DialogContent`/`DialogActions`; destructive variant uses `Button color="error"`; `onConfirm` may be async and shows `CircularProgress` in the button while pending.
   - `useToast()` + `ToastProvider` — a single MUI `Snackbar` with an `Alert` (severity success/info/warning/error), queued, auto-hide 5 seconds.
   - `FormField` helpers bound to React Hook Form (`Controller`) for MUI `TextField`, `Select`, `Autocomplete`, `Checkbox`, `Switch`, `RadioGroup` and `DatePicker`/`DateTimePicker`, wiring `label`, `helperText` and `error`.
   - `StatCard` — MUI `Card` with label, value, optional delta `Chip` and icon (used later by dashboards).
   - `UserAvatar` — MUI `Avatar` showing initials on a deterministic background colour derived from the user id.
   - `DateDisplay` — formats a UTC date in the school timezone (`formatInSchoolTz(date, pattern)` util in `src/lib/dates.ts`, using `date-fns-tz`).
   - `LoadingSkeleton` — MUI `Skeleton` variants for table, card and form.

### FR-6 App shell
1. `src/app/(app)/layout.tsx` renders a left sidebar as a permanent MUI `Drawer` with a `List` of `ListItemButton`s (256 px wide on screens ≥ 1024 px, collapsible to 64 px icons-only with the state saved to `localStorage`) and a top bar built with `AppBar` + `Toolbar`. Follow the MUI MCP "Drawer" (mini variant, responsive drawer) and "App Bar" docs.
2. On screens < 1024 px (`useMediaQuery(theme.breakpoints.down('lg'))`) the sidebar is a `temporary` `Drawer` opened from a hamburger `IconButton`.
3. Sidebar items come from `src/config/navigation.ts`, filtered by the current user's role. Initial entries: `Dashboard` (`/dashboard`, all roles). The active item is highlighted based on the current path prefix.
4. The top bar shows (MUI `Badge`, `Menu`, `Chip`, `Avatar` as appropriate): school short name and logo (from `SchoolSettings`), a theme toggle, a placeholder notification bell (wired up by PRD-04) and a user menu (avatar, name, role badge, "Profile" and "Sign out" items — wired by PRD-01/PRD-03).
5. `/dashboard` renders a `PageHeader` "Welcome to SchoolHub" and an `EmptyState` saying dashboards arrive in a later release.
6. `src/config/student-tabs.ts` must exist, exporting an empty typed array of `{ key, label, href(studentId), roles }` for later PRDs.

### FR-7 Public layout
1. `src/app/(public)/layout.tsx` renders a header with logo, school name and a "Sign in" button linking to `/login`, and a footer with the school address, phone and email from `SchoolSettings`.
2. `/` renders a simple hero section with the school name, a one-sentence tagline and the "Sign in" button. PRD-18 replaces this with the full public website.

### FR-8 Error and status pages
1. Custom `not-found.tsx` (404), `error.tsx` (runtime error with a "Try again" button that calls `reset()`), and `global-error.tsx`.
2. A `/forbidden` page used by later PRDs when a user lacks permission (403 message plus a link back to `/dashboard`).

### FR-9 Logging
1. `src/lib/logger.ts` exports `logger.info|warn|error(message, meta?)` that writes JSON lines in production and readable lines in development.

## Non-Functional Requirements

1. **Performance:** the `/dashboard` page must reach Largest Contentful Paint under 2.5 seconds on a mid-range laptop running `npm run build && npm start`.
2. **Accessibility:** all shared components must meet WCAG 2.1 AA — visible focus rings, labelled controls, colour contrast at least 4.5:1, full keyboard operation of sidebar, dialogs and menus. Playwright e2e must run `@axe-core/playwright` on `/` and `/dashboard` with zero serious or critical violations.
3. **Responsiveness:** layouts must work from 360 px to 1920 px wide with no horizontal scroll.
4. **Security:** set security headers in `next.config.js` — `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, and a Content-Security-Policy that allows only `self` plus inline styles required by Next.js.

## Acceptance Criteria

1. Given a fresh clone with Docker running, when the developer runs the boot command sequence from Goal 1, then `http://localhost:3000` shows the public home page with the seeded school name.
2. Given the app is running, when a user opens `/dashboard`, then the MUI sidebar drawer, app bar and welcome empty state render, there is no flash of the wrong colour scheme on reload, and the theme toggle switches between light and dark mode and persists across reloads.
3. Given a viewport of 375 px, when the user taps the hamburger button, then the navigation opens as a temporary drawer and closes after a link is chosen.
4. Given the database container is stopped, when `GET /api/health` is called, then the response is `503` with `"db": "error"`.
5. Given a route handler wrapped with `withHandler` throws a `ZodError`, then the response is `400` with `error.code = "VALIDATION_ERROR"` and field errors in `details`.
6. Given `pageSize=500` in a query string, when `parsePagination` runs, then `pageSize` is `100`.
7. Given `DATABASE_URL` is missing, when the app starts, then it fails with a message naming `DATABASE_URL`.
8. Given the user visits an unknown URL, then the custom 404 page renders inside the public layout.

## Test Requirements

- Unit tests for `withHandler` (each error branch), `parsePagination`, `formatInSchoolTz`, `env.ts` validation.
- Component tests for `DataTable` (renders rows, empty state, page change updates URL), `ConfirmDialog` and `useToast`.
- A lint test proves the `no-restricted-imports` rule fails on `import { X } from 'lucide-react'`.
- Playwright: home page loads, dashboard loads, mobile nav opens, axe scan passes.

## Seed Data

- One `SchoolSettings` row: name "SchoolHub Academy", shortName "SchoolHub", timezone "America/New_York", city "Springfield", country "USA", phone "+1 555 0100", email "office@schoolhub.test".

## Technical Notes

- Deliver a top-level `README.md` describing setup, scripts, folder layout and the conventions from the Platform Context.
- Commit `.env.example`, never `.env`.
