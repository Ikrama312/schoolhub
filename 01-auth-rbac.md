# PRD-01: Authentication, Sessions & Role-Based Access Control

**Ticket:** SCH-001 · **Depends on:** PRD-00 · **Run mode:** `--brownfield --tech-stack react`

## Summary

Add user accounts, email + password sign-in, password reset, account invitations, account lockout and the role-based permission layer used by every later feature. Replace the placeholder user in the app shell with the real session user. Add the `AuditLog` model and `audit()` helper.

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

Every SchoolHub feature is role-scoped. Schools do not allow self-registration: the office creates accounts and sends invitations. Accounts are shared by minors, so lockout, strong password rules and audit trails are mandatory.

## Goals

1. Only invited users can sign in; there is no public sign-up.
2. Every protected page and API route rejects unauthenticated requests with a redirect (pages) or `401` (API).
3. Permission helpers make it a one-line call to restrict a handler to a role or an entity.

## Out of Scope

- Admin screens to create and manage users (PRD-03). This PRD supplies the service functions and seed users.
- Single sign-on (Google, Microsoft), multi-factor authentication, magic-link login.
- Email delivery infrastructure (PRD-04). Until PRD-04 lands, `sendAuthEmail()` must log the email (recipient, subject, link) via `logger.info`; PRD-04 swaps its body to enqueue into `EmailOutbox`.
- `src/server/auth/course-access.ts` and `src/server/auth/student-access.ts` already implement working per-entity RBAC (`assertCanViewCourse`, `assertCanManageCourse`, `getAccessibleStudentIds`, `assertCanViewStudent`). This PRD does not rebuild or modify either file — it only makes `getCurrentUser()` / `requireUser()` / `requireRole()` resolve a real session so those existing helpers have genuine data to check.

## User Stories

- As an invited user, I want to set my own password from an invitation link so that I can access SchoolHub.
- As a user, I want to sign in with email and password so that I can see my information.
- As a user who forgot my password, I want to reset it via an emailed link so that I can regain access.
- As a user, I want to change my password while signed in so that I can keep my account secure.
- As an admin, I want accounts to lock after repeated failed sign-ins so that passwords cannot be brute-forced.
- As an admin, I want a record of security-relevant actions so that I can investigate incidents.

## Functional Requirements

### FR-1 Data model

```prisma
enum Role { ADMIN TEACHER STUDENT PARENT }
enum UserStatus { INVITED ACTIVE DISABLED }
enum AuthTokenType { INVITE PASSWORD_RESET }

model User {
  id                 String     @id @default(cuid())
  email              String     @unique            // stored lower-cased
  passwordHash       String?                       // null until invite accepted
  firstName          String
  lastName           String
  role               Role
  status             UserStatus @default(INVITED)
  phone              String?
  failedLoginCount   Int        @default(0)
  lockedUntil        DateTime?
  lastLoginAt        DateTime?
  passwordChangedAt  DateTime?
  archivedAt         DateTime?
  createdAt          DateTime   @default(now())
  updatedAt          DateTime   @updatedAt
  authTokens         AuthToken[]
  @@index([role, status])
}

model AuthToken {
  id         String        @id @default(cuid())
  userId     String
  user       User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  type       AuthTokenType
  tokenHash  String        @unique                // SHA-256 of the raw token
  expiresAt  DateTime
  usedAt     DateTime?
  createdAt  DateTime      @default(now())
}

model AuditLog {
  id          String   @id @default(cuid())
  actorId     String?
  action      String                  // e.g. "auth.login.success", "user.update"
  entityType  String?
  entityId    String?
  metadata    Json?
  ipAddress   String?
  createdAt   DateTime @default(now())
  @@index([entityType, entityId])
  @@index([actorId, createdAt])
}
```

### FR-2 Sign-in (`/login`)
1. Built from the MUI MCP "Sign-in" template patterns (`Card`, `TextField`, `Button`, `InputAdornment` + `IconButton` for the show-password toggle, `Alert` for form-level errors). Form fields: email, password, "Show password" toggle. Submit calls Auth.js `signIn('credentials')`.
2. The authorize function must: lower-case and trim the email; reject if the user does not exist, `status != ACTIVE`, `archivedAt` is set, or `lockedUntil > now`; compare with bcrypt (cost 12).
3. Every failure must show the same message, "Email or password is incorrect.", except a locked account, which shows "This account is temporarily locked. Try again in N minutes." and a disabled account, which shows "This account is disabled. Contact the school office."
4. On a failed password, increment `failedLoginCount`. When it reaches 5, set `lockedUntil = now + 15 minutes` and reset the count to 0. On success, reset `failedLoginCount` to 0 and set `lastLoginAt`.
5. Rate limit: maximum 10 sign-in attempts per IP address per 5 minutes (in-memory sliding window in `src/server/rate-limit.ts`, exported for reuse). Exceeding it returns `RATE_LIMITED` and the form shows "Too many attempts. Wait a few minutes and try again."
6. After sign-in, redirect to the `callbackUrl` if it is a same-origin relative path, otherwise to `/dashboard`.
7. Write audit entries `auth.login.success`, `auth.login.failure` (metadata: email attempted, reason) and `auth.lockout`.

### FR-3 Session
1. JWT session lifetime 8 hours, refreshed on activity. The JWT and `session.user` must carry `id`, `role`, `firstName`, `lastName`, `email`.
2. If `passwordChangedAt` is later than the token issue time, the session is invalid (forces re-login on all devices after a password change). Check this in the `jwt` callback at most once every 5 minutes per token.
3. `middleware.ts` must redirect unauthenticated requests for any path under the `(app)` group to `/login?callbackUrl=<path>`, and return `401` JSON for `/api/*` paths except `/api/health`, `/api/auth/*` and paths explicitly listed as public in `src/config/public-routes.ts`.

### FR-4 Accept invitation (`/invite/[token]`)
0. All token creation, lookup and consumption for both `AuthToken` types goes through one module, `src/server/auth/tokens.ts` (named as the model's single producer/consumer in `prisma/schema.prisma`'s doc comment), exposing `createToken(userId, type, ttl)` → raw token (hashes it with SHA-256 before storing), `verifyToken(rawToken, type)` → the matching user/token or `null` when missing, used or expired, and `consumeToken(tokenId)` → sets `usedAt`. FR-6 and FR-8 below call the same module instead of re-implementing hashing.
1. Look up the token via `verifyToken(rawToken, 'INVITE')`; it must be unused and not expired (invite tokens expire after 7 days). Otherwise show "This invitation link is invalid or has expired. Ask the school office to send a new one."
2. Show the user's name and email (read-only) and fields: new password, confirm password.
3. On submit: validate the password policy, hash it, set `status = ACTIVE`, `passwordChangedAt = now`, call `consumeToken()`, sign the user in and redirect to `/dashboard`. Audit `auth.invite.accepted`.

### FR-5 Password policy (`src/lib/validators/auth.ts`)
1. Minimum 10 characters, maximum 128, must contain at least one letter and one digit, must not equal the user's email, must not appear in a bundled list of the 1,000 most common passwords (`src/server/auth/common-passwords.txt`).
2. A live strength checklist under the password field shows each rule as met or unmet.

### FR-6 Forgot / reset password
1. `/forgot-password`: email field. Always respond "If an account exists for that email, we've sent a reset link." regardless of whether the account exists (no user enumeration). Rate limit 3 requests per email per hour and 10 per IP per hour.
2. When the user exists and is `ACTIVE`, call `tokens.ts`'s `createToken(userId, 'PASSWORD_RESET', { minutes: 60 })` (raw token: 32 random bytes, base64url), invalidate older unused reset tokens for that user, and call `sendAuthEmail(user, 'password-reset', link)`.
3. `/reset-password/[token]`: new password + confirm. On success set the hash, `passwordChangedAt = now`, clear lockout fields, call `consumeToken()`, audit `auth.password.reset`, redirect to `/login` with a success toast (`useToast`).

### FR-7 Change password (signed in)
1. `/account/security` page with fields: current password, new password, confirm. Wrong current password → field error "Current password is incorrect." Success → toast "Password updated", other sessions are invalidated via `passwordChangedAt`, the current session is re-issued.
2. Add "Account security" to the user menu.

### FR-8 Service functions for later PRDs (`src/server/services/users.ts`)
1. `createUser({ email, firstName, lastName, role, phone? })` → creates an `INVITED` user; throws `CONFLICT` if the email exists.
2. `createInviteToken(userId)` → calls `tokens.ts`'s `createToken(userId, 'INVITE', { days: 7 })`, invalidating older unused invite tokens for that user, and returns the raw token.
3. `sendInvite(userId)` → replaces the current no-op stub (it only logs and returns, per its own code comment pending this PRD); calls `createInviteToken()` and `sendAuthEmail(user, 'invite', link)`.
4. `setUserStatus(userId, status)`, `unlockUser(userId)`.

### FR-9 Permissions (`src/server/auth/requireRole.ts`)
1. This file already exists with a hardcoded `PLACEHOLDER_USER` and only a `requireRole()` export (its own code comment says this is pending PRD-01). Add `getCurrentUser()` and `requireUser()` to the same file and delete `PLACEHOLDER_USER` — do not create a separate `permissions.ts`.
2. `getCurrentUser()` → session user or `null`.
3. `requireUser()` → session user, or throws `AppError('UNAUTHENTICATED')`. In server pages, redirect to `/login`.
4. `requireRole(...roles)` → throws `FORBIDDEN` when the role is not listed (now checking the real session role instead of the placeholder). In server pages, redirect to `/forbidden`.
5. `can(user, action, resource)` is **not** required — keep explicit role checks plus entity helpers added by later PRDs (for example `assertCanViewStudent`).

### FR-10 Audit helper (`src/server/audit.ts`)
1. `audit({ actorId, action, entityType?, entityId?, metadata?, request? })` inserts an `AuditLog` row, captures the IP from `x-forwarded-for` when a request is passed, and never throws (errors are logged).
2. Metadata must never contain password hashes, raw tokens or full passwords.

### FR-11 App shell integration
1. `src/app/(app)/shell.tsx` currently defines its own separate `PLACEHOLDER_USER` (distinct from the one removed from `requireRole.ts` in FR-9). Delete it; the shell reads the real signed-in user from the session instead, so there is exactly one source of "who is the current user" in the codebase, not two independent placeholders.
2. The top-bar user menu shows the real user's name, role badge and avatar initials. "Sign out" calls `signOut()` and redirects to `/login`.
3. `navigation.ts` filtering now uses the session role.

## Pages & Routes

| Route | Access | Purpose |
|---|---|---|
| `/login` | public | Sign in |
| `/forgot-password` | public | Request reset link |
| `/reset-password/[token]` | public | Set new password |
| `/invite/[token]` | public | Accept invitation |
| `/account/security` | any signed-in | Change password |
| `/api/auth/[...nextauth]` | public | Auth.js handlers |
| `POST /api/auth/forgot-password` | public | Request reset |
| `POST /api/auth/reset-password` | public | Complete reset (`{ token, password }`) |
| `POST /api/auth/accept-invite` | public | Complete invite (`{ token, password }`) |
| `POST /api/account/password` | any signed-in | Change password (`{ currentPassword, newPassword }`) |

## Non-Functional Requirements

1. **Security:** raw tokens are never stored — only SHA-256 hashes. Tokens are compared in constant time. Cookies are `HttpOnly`, `Secure` in production, `SameSite=Lax`. All auth forms include CSRF protection supplied by Auth.js.
2. **Security:** sign-in responses for "no such user" and "wrong password" must take similar time (run a dummy bcrypt compare when the user does not exist).
3. **Performance:** sign-in must complete in under 1 second at p95 on local hardware (bcrypt cost 12).
4. **Accessibility:** form errors are announced with `aria-live="polite"` and focus moves to the first invalid field on submit.

## Acceptance Criteria

1. Given an `ACTIVE` user with correct credentials, when they sign in, then they land on `/dashboard` and the user menu shows their name and role.
2. Given a wrong password entered 5 times, when the 6th attempt is made within 15 minutes, then sign-in is refused with the locked message even with the correct password, and an `auth.lockout` audit row exists.
3. Given an `INVITED` user, when they try to sign in, then they see "Email or password is incorrect."
4. Given a valid invite link, when the user sets a policy-compliant password, then status becomes `ACTIVE`, they are signed in, and reusing the same link shows the invalid-link message.
5. Given an invite link older than 7 days, when it is opened, then the invalid-link message shows.
6. Given a forgot-password request for an unknown email, then the same success message is shown and no token row is created.
7. Given a user resets their password on device A, when they use an existing session on device B, then device B is signed out within 5 minutes.
8. Given an unauthenticated request to `/api/anything-protected`, then the response is `401` with `error.code = "UNAUTHENTICATED"`.
9. Given a `STUDENT` session, when a handler protected by `requireRole('ADMIN')` is called, then the response is `403`.
10. Given the password "password123", when it is submitted, then validation fails with the common-password rule.

## Test Requirements

- Unit: password policy, token hashing and expiry, lockout counter logic, rate limiter, `callbackUrl` same-origin check.
- Integration (Vitest against a test database): authorize function branches, accept-invite, reset-password, change-password.
- Playwright: full sign-in/out, failed login message, forgot → reset (read the reset link from the logged email output or a test-only helper that reads the latest token from the DB).

## Seed Data

Create these users (password for all: `SchoolHub123!`, status `ACTIVE`):

| Email | Name | Role |
|---|---|---|
| admin@schoolhub.test | Alice Admin | ADMIN |
| teacher@schoolhub.test | Tom Teacher | TEACHER |
| teacher2@schoolhub.test | Tina Tutor | TEACHER |
| student@schoolhub.test | Sam Student | STUDENT |
| student2@schoolhub.test | Sara Scholar | STUDENT |
| parent@schoolhub.test | Pat Parent | PARENT |

Also create one `INVITED` user `invited@schoolhub.test` and log its invite link during seeding.
