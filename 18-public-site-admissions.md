# PRD-18: Public Website, Admissions & Contact

**Ticket:** SCH-018 · **Depends on:** PRD-00 – PRD-17 · **Run mode:** `--brownfield --tech-stack react`

## Summary

Replace the placeholder home page with a complete public school website managed from inside SchoolHub (editable pages, news from public announcements, public calendar, staff directory), an online admissions application with document upload and status tracking for applicants, an admissions review pipeline for the office that converts accepted applicants into student and parent accounts, and a contact form that routes enquiries to the office.

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

The school's current website is a static brochure maintained by an outside agency, and admissions applications arrive as emailed PDFs that the office retypes. Running the public site and admissions from SchoolHub keeps news and dates current automatically and turns an accepted application into a ready-to-invite account with one click.

## Goals

1. Office staff update any public page without a developer.
2. A family completes an admission application in under 15 minutes on a phone.
3. Accepting an application creates the student and parent accounts with no retyping.

## Out of Scope

- Admission fees/online payment (an application fee can be invoiced manually via PRD-17 after acceptance).
- Entrance-exam scheduling and scoring.
- Multilingual site content.
- A drag-and-drop page builder — pages use structured sections.

## User Stories

- As a prospective parent, I want to browse information about the school, its news and upcoming events so that I can decide to apply.
- As a prospective parent, I want to apply online and upload documents so that I don't need to visit the office.
- As an applicant, I want to check my application status with a reference number so that I know what is happening.
- As an admin, I want to review, comment on and decide applications in a pipeline so that admissions are organised.
- As an admin, I want accepted applications converted into accounts so that onboarding is instant.
- As an admin, I want to edit public pages and the staff directory so that the site is always accurate.
- As a visitor, I want to send an enquiry through a contact form so that I can get answers.

## Functional Requirements

### FR-1 Data model

```prisma
enum PageStatus { DRAFT PUBLISHED }
enum ApplicationStatus { DRAFT SUBMITTED UNDER_REVIEW INTERVIEW_SCHEDULED ACCEPTED WAITLISTED REJECTED WITHDRAWN ENROLLED }
enum EnquiryStatus { NEW IN_PROGRESS CLOSED }

model SitePage {
  id          String     @id @default(cuid())
  slug        String     @unique          // "about", "academics", "admissions-info", "facilities"
  title       String
  sections    Json                        // ordered blocks, see FR-3
  seoTitle    String?
  seoDescription String?                  // max 160
  status      PageStatus @default(DRAFT)
  showInNav   Boolean    @default(true)
  navOrder    Int        @default(0)
  updatedById String
  updatedAt   DateTime   @updatedAt
  createdAt   DateTime   @default(now())
}

model StaffDirectoryEntry {
  userId      String   @id               // TEACHER or ADMIN
  isListed    Boolean  @default(false)
  jobTitle    String                       // "Head of Mathematics"
  bio         String?                      // max 1,000
  photoFileId String?
  order       Int      @default(0)
}

model AdmissionCycle {
  id             String   @id @default(cuid())
  academicYearId String
  name           String                    // "Admissions 2027–2028"
  opensAt        DateTime
  closesAt       DateTime
  gradeLevelIds  String[]                  // grades accepting applications
  isActive       Boolean  @default(true)
}

model Application {
  id              String            @id @default(cuid())
  reference       String            @unique   // "APP-2027-00042"
  cycleId         String
  status          ApplicationStatus @default(DRAFT)
  accessTokenHash String                      // for applicant status page / draft resume
  applicantEmail  String                      // parent/guardian email
  gradeLevelId    String
  student         Json                        // { firstName, lastName, dateOfBirth, gender, currentSchool, address, city, medicalNotes? }
  guardians       Json                        // [{ firstName, lastName, email, phone, relationship, occupation? }] 1–2
  answers         Json                        // { whyThisSchool, siblingsAtSchool, specialNeeds, howHeard }
  consentAccuracy Boolean           @default(false)
  consentPrivacy  Boolean           @default(false)
  submittedAt     DateTime?
  decidedAt       DateTime?
  decidedById     String?
  decisionNote    String?                     // internal
  applicantMessage String?                    // shown to applicant with the decision
  interviewAt     DateTime?
  createdStudentId String?
  createdAt       DateTime          @default(now())
  updatedAt       DateTime          @updatedAt
  documents       ApplicationDocument[]
  notes           ApplicationNote[]
  @@index([cycleId, status])
}

model ApplicationDocument {
  id            String      @id @default(cuid())
  applicationId String
  application   Application @relation(fields: [applicationId], references: [id], onDelete: Cascade)
  kind          String                         // "BIRTH_CERTIFICATE", "PREVIOUS_REPORT", "PHOTO", "OTHER"
  fileId        String
}

model ApplicationNote {
  id            String      @id @default(cuid())
  applicationId String
  application   Application @relation(fields: [applicationId], references: [id], onDelete: Cascade)
  authorId      String
  body          String                         // max 2,000, internal
  createdAt     DateTime    @default(now())
}

model Enquiry {
  id          String        @id @default(cuid())
  name        String
  email       String
  phone       String?
  topic       String                           // "Admissions", "General", "Fees", "Other"
  message     String                           // 10–3,000 chars
  status      EnquiryStatus @default(NEW)
  assignedToId String?
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt
}
```

### FR-2 Public site structure (`src/app/(public)/`)
1. Header navigation: Home, published `SitePage`s with `showInNav` ordered by `navOrder`, News, Calendar, Staff, Admissions, Contact, and a "Sign in" button. Mobile: hamburger menu.
2. **Home (`/`):** hero (school name, tagline, hero image, "Apply now" and "Book a visit" (→ contact with topic Admissions) buttons), key facts strip (configurable 4 stats), latest 3 news items, next 4 public events, a quote/testimonial block, call-to-action band. Home content is itself a `SitePage` with slug `home` (sections editor), so it is editable.
3. **News (`/news`, `/news/[id]`):** public announcements (PRD-12 `getPublicNews`) paginated 9 per page with cover images; detail page renders sanitised Markdown and public attachments.
4. **Calendar (`/calendar-public`):** list of public events (PRD-14 `getPublicEvents`) for the next 6 months grouped by month, with `.ics` download per event.
5. **Staff (`/staff`):** listed `StaffDirectoryEntry` cards (photo or initials, name with title, job title, bio) grouped by department (subject of their courses, or "Leadership & office" for admins). No emails or phone numbers.
6. **Dynamic pages (`/[slug]`):** render a published `SitePage`.
7. **SEO:** per-page `<title>` and meta description, Open Graph tags, `sitemap.xml` (all public pages, news items), `robots.txt` (disallow app routes), canonical URLs, JSON-LD `School` schema on home.
8. All public pages are statically rendered with on-demand revalidation (`revalidatePath`) when pages, news or events change; they must not require a database query per request.

### FR-3 Page sections editor (`/admin/website/pages`)
1. Supported section types (each a typed Zod schema): `hero` (heading, subheading, image, buttons[≤2]), `richText` (Markdown), `imageText` (image left/right + Markdown), `stats` (2–4 items: value, label), `cards` (2–6: icon, title, text, link), `gallery` (2–12 images with alt text), `faq` (question/answer pairs), `cta` (heading, text, button), `quote` (text, attribution).
2. Editor (MUI components only — the public site itself is also built entirely from MUI, using the MUI MCP "Marketing page" template as the visual reference): list of sections with add (type picker), edit form per section, reorder (drag + buttons), delete; side-by-side live preview at desktop/mobile widths; Save draft / Publish; SEO fields; slug editing for non-home pages with uniqueness validation (lowercase letters, digits, hyphens; reserved slugs like `news`, `staff`, `login`, `api`, `apply` refused).
3. Images upload via `FileUpload` (context `site`, public access) and require alt text.
4. Seeded pages: home, about, academics, admissions-info, facilities, with realistic content.

### FR-4 Staff directory admin (`/admin/website/staff`)
1. List of teachers and admins with toggle "Listed", job title, bio, photo upload, order.

### FR-5 Admissions application (`/apply`)
1. When no active cycle is open (`opensAt <= now < closesAt`), show "Applications are currently closed" and the next opening date if a future cycle exists.
2. Step 1 "Start": parent email + grade applying for (cycle grades only). Creates a DRAFT application, emails a private resume link (`/apply/[reference]?token=…`, token stored hashed, valid until cycle close) and continues.
3. Wizard steps (MUI `Stepper` — `MobileStepper` below 600 px — each step validated and saved on Next, back navigation keeps data):
   1. Student details (first/last name, date of birth with age check matching grade ±2 years of typical age (grade order + 5), gender, current school, address).
   2. Guardians (1–2; first guardian email defaults to the start email).
   3. Questions (why this school ≤ 1,000 chars, siblings at school (yes + names/no), special educational needs, how did you hear about us (select)).
   4. Documents: birth certificate (required), latest school report (required for grade order ≥ 2 above the lowest grade), passport photo (optional), other (optional, ≤ 3). PDF/JPG/PNG, 10 MB each. Context `admission` (access: the applicant token holder and admins).
   5. Review & submit: summary of all steps with edit links, two required consent checkboxes (accuracy, privacy policy link), submit.
4. On submit: status SUBMITTED, `submittedAt`, confirmation page with the reference, and confirmation email with the status-page link. Notify admins (`admissions.application_submitted`, default email true).
5. Spam protection: honeypot field, minimum 3 seconds between page load and Start submit, and rate limit of 5 application starts per IP per hour. No CAPTCHA.

### FR-6 Applicant status page (`/apply/status`)
1. Applicant enters reference + email, or uses the emailed link; shows current status with a human explanation per status, interview date/time if scheduled, and the decision message when decided. DRAFT applications show "Continue application". Applicants may withdraw before a decision (confirmation required).

### FR-7 Admissions pipeline (`/admin/admissions`)
1. Cycle management: create/edit cycles (name, year, dates, grades).
2. Pipeline board (columns of MUI `Paper` + `Card`s, drag via `@dnd-kit`, by status: Submitted, Under review, Interview scheduled, Accepted, Waitlisted, Rejected) with drag to change status (with confirm dialog for decision statuses), and a table view with filters (cycle, grade, status, search name/reference) and CSV export.
3. Application detail: all data, documents (inline preview), internal notes thread, status history (audit), actions: Move to under review, Schedule interview (date/time + message → emails applicant, adds to the admissions officer's calendar as a MEETING event with STAFF audience), Accept / Waitlist / Reject (with internal note and optional applicant message; emails applicant with `admissions.decision` template), Convert to student (ACCEPTED only).
4. Capacity indicator per grade: accepted count vs. a configurable target per grade per cycle (`targets Json` on `AdmissionCycle`).
5. Duplicate detection: on detail, warn when another application in the same cycle has the same student name + date of birth or the same guardian email.

### FR-8 Convert accepted applicant
1. "Convert to student" dialog pre-fills a PRD-03 student creation form from the application: student fields, grade level, enrollment date (the cycle's academic year start), generated admission number; guardians mapped to new parent users, or linked to existing parent users when the email already exists (shown as "Will link to existing parent Pat Parent"). Optional section assignment (PRD-05) for the target year.
2. On confirm (one transaction): create users + profiles + links, copy the birth certificate and photo into the student's records (FileObject context `student-document` — register access: ADMIN only), set application status ENROLLED and `createdStudentId`, and optionally send invitations (checkbox, default on).

### FR-9 Contact form (`/contact`)
1. Fields: name, email, phone (optional), topic, message, honeypot. Shows school address, phone, email and an embedded map link (plain link to OpenStreetMap — no third-party embed scripts).
2. On submit: store `Enquiry`, show thank-you message, email an acknowledgement to the sender, notify admins (`enquiry.received`). Rate limit 5 per IP per hour.
3. Admin inbox `/admin/enquiries`: list with status filters, assign to an admin, change status, reply via email (composer sends through the outbox, reply stored as an `EnquiryReply { enquiryId, authorId, body, sentAt }`), view history.

### FR-10 Navigation & public routes
1. Administration group: "Website" (pages, staff directory), "Admissions", "Enquiries".
2. Add every public route (`/`, `/news*`, `/calendar-public`, `/staff`, `/apply*`, `/contact`, `/[slug]`, `/sitemap.xml`, `/robots.txt`, `/api/public/*`) to `src/config/public-routes.ts`.

## API

| Method & path | Role | Notes |
|---|---|---|
| `GET/POST /api/site/pages`, `GET/PATCH/DELETE /api/site/pages/:id` | ADMIN | Publish via `PATCH { status }` (triggers revalidation) |
| `GET/PUT /api/site/staff` | ADMIN | |
| `GET/POST /api/admissions/cycles`, `PATCH /api/admissions/cycles/:id` | ADMIN | |
| `POST /api/public/applications` | public | `{ cycleId, email, gradeLevelId, honeypot, startedAt }` → `{ reference }` + email |
| `GET /api/public/applications/:reference` | token | Draft/status data |
| `PATCH /api/public/applications/:reference` | token | Step data while DRAFT |
| `POST /api/public/applications/:reference/documents` | token | Upload |
| `POST /api/public/applications/:reference/submit` · `/withdraw` | token | |
| `POST /api/public/applications/status-lookup` | public | `{ reference, email }` → emails a fresh link (never reveals data directly) |
| `GET /api/admissions/applications` | ADMIN | Filters, `?format=csv` |
| `GET /api/admissions/applications/:id` · `PATCH` (status/interview/decision) | ADMIN | |
| `POST /api/admissions/applications/:id/notes` | ADMIN | |
| `POST /api/admissions/applications/:id/convert` | ADMIN | |
| `POST /api/public/enquiries` | public | |
| `GET /api/enquiries`, `PATCH /api/enquiries/:id`, `POST /api/enquiries/:id/reply` | ADMIN | |

## Non-Functional Requirements

1. **Performance:** public pages score ≥ 90 on Lighthouse Performance, Accessibility, Best Practices and SEO (mobile profile) with seed content; images use `next/image` with responsive sizes.
2. **Security/privacy:** applicant tokens are 32 random bytes stored hashed; status lookup never reveals application data without the emailed token; application data (including medical notes) is visible to ADMIN only; public endpoints validate everything with Zod and are rate limited.
3. **Accessibility:** the application wizard announces step changes, keeps focus management correct between steps, and all public pages pass axe with zero serious or critical violations.
4. **Data retention:** REJECTED and WITHDRAWN applications and their documents are purged 12 months after the cycle closes by the maintenance run (documented on the privacy page).

## Acceptance Criteria

1. Given an admin edits the "about" page, adds an imageText section and publishes, then `/about` shows the change within 10 seconds without a redeploy.
2. Given a public announcement and a public event exist, then the home page lists them in the news and events blocks; a non-public announcement never appears.
3. Given an open cycle for Grade 6–8, when a parent completes the wizard on a 375 px phone and submits, then they see reference APP-2027-xxxxx, receive a confirmation email, and admins are notified.
4. Given a parent closes the browser after step 2, when they open the resume link from their email, then they continue at step 3 with previous data intact.
5. Given the honeypot field is filled, then the submission is silently discarded (200 response, no record).
6. Given an admin drags an application to Accepted and enters an applicant message, then the applicant receives the decision email and the status page shows the message.
7. Given an accepted application whose guardian email matches existing parent Pat, when the admin converts it, then a new student is created and linked to Pat (no duplicate parent), the application becomes ENROLLED, and Pat receives no new invite (already active) while new users do.
8. Given someone looks up status with a correct reference but wrong email, then the response is the same generic "If the details match, we've emailed you a link" message as for a correct pair.
9. Given a visitor submits the contact form, then an Enquiry is created, an acknowledgement email is queued and an admin can reply from `/admin/enquiries`.
10. Given `/sitemap.xml` is requested, then it lists published pages and news URLs and excludes app routes.

## Test Requirements

- Unit: section schemas, reserved slug validation, application age check, duplicate detection, reference generation.
- Integration: wizard step persistence with token auth, conversion transaction (new parent vs. existing parent), retention purge.
- Playwright: public navigation and axe scan; full application on mobile viewport; admin review → accept → convert; contact form round trip.

## Seed Data

- Published pages: home (all section types used at least once), about, academics, admissions-info, facilities — with realistic copy and placeholder images in `prisma/seed-assets/site/`.
- Staff directory: 6 listed staff with job titles and bios.
- Active cycle "Admissions 2027–2028" open now for 60 days, Grades 6–8, targets 20 per grade; 8 applications across statuses (2 submitted, 2 under review, 1 interview scheduled, 1 accepted, 1 waitlisted, 1 rejected).
- 3 enquiries (2 new, 1 closed with a reply).
