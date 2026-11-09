# SH-12 — User Stories (PRD-12: Announcements & News)

Run mode: `--brownfield --tech-stack react`. Each story cites its requirement id(s) in `requirements.json`.

## Data & Audience

- **US-1 (FR-1, FR-2, FR-36)**: As a developer, I want the announcement models, enums and validators, so that announcements, audiences, attachments and read receipts are stored consistently.
- **US-2 (FR-3 – FR-8)**: As an author, I want audiences (school, staff, role, grade level, section, course, each with student/parent/teacher flags) resolved to exactly the right active users, so that my announcement reaches the intended people and nobody else.

## Permissions

- **US-3 (FR-9, FR-11)**: As an admin, I want to target any audience and mark announcements public, so that I can reach anyone, including website visitors. Students and parents cannot post.
- **US-4 (FR-10)**: As a teacher, I want to post to my courses and my homeroom section, so that my students and their parents hear class news. The server rejects any other audience with 403.
- **US-5 (FR-12)**: As an author, I want to edit my own announcements, and as an admin I want to edit or archive any, so that mistakes can be corrected. Edits by admins are audited.

## Composing

- **US-6 (FR-13)**: As an admin or teacher, I want a composer with a Markdown body, a cover image, attachments, an audience builder, pin/ack/public options and publish now / schedule / draft with an expiry, so that I can write a complete notice in one place.
- **US-7 (FR-14, FR-15)**: As an author, I want a live "Will reach N people" count by role, and I want publishing to zero recipients refused, so that I know who I'm reaching before I send.
- **US-8 (FR-16)**: As an admin, I want to schedule an announcement and set an expiry, so that it appears and disappears at the right time.

## Reading

- **US-9 (FR-17, FR-18)**: As any user, I want one feed of announcements meant for me, with pinned items first, unread dots and All / Unread / Requires-ack tabs, so that I don't miss anything.
- **US-10 (FR-19, FR-20)**: As a recipient, I want to open an announcement (which marks it read) and acknowledge it when required, so that the office knows I've seen it.
- **US-11 (FR-21)**: As a course member, I want an Announcements tab on the course, so that I can see class news in context.
- **US-12 (FR-22)**: As a parent, I want each grade, section or course item labelled with the child it relates to ("For Sam"), so that I know which child it's about.

## Author Tools

- **US-13 (FR-23)**: As an author, I want a manage view with status, reach, read % and acknowledged %, including expired and archived items, so that I can track my announcements.
- **US-14 (FR-24, FR-25)**: As an admin, I want per-announcement stats with a recipient table, filters and CSV export, and a "Send reminder" button for those who haven't acknowledged (at most once per 24h), so that I can follow up.

## Notifications

- **US-15 (FR-26 – FR-29)**: As a recipient, I want one notification (in-app plus email) when an announcement first becomes visible to me, so that I hear about it promptly. Later audience edits don't re-notify.

## Files, Public News & Navigation

- **US-16 (FR-30)**: As a recipient, I want to download the attachments and cover image, so that I get the full notice. Anonymous visitors can download them only for public, published announcements.
- **US-17 (FR-31)**: As the public website (PRD-18), I want `GET /api/public/news`, so that public announcements appear as school news without a login.
- **US-18 (FR-32, FR-33)**: As any user, I want an "Announcements" sidebar link with an unread badge, and as a teacher or admin I want a "New announcement" button, so that the feature is easy to reach.

## Seed

- **US-19 (FR-35)**: As a developer or tester, I want the 6 demo announcements seeded, so that every feed state (pinned, ack, course, staff, scheduled, expired) can be seen.

## Non-Functional Requirements

- **NFR-1**: Material UI only, with every component looked up via mui-mcp first. No banned libraries. QA checks the imports.
- **NFR-2**: The feed for a parent with 3 children returns in under 200 ms with 2,000 announcements, using SQL joins on audience rows.
- **NFR-3**: Server-side access checks everywhere. A teacher targeting SCHOOL gets 403.
- **NFR-4**: Markdown is sanitised as in PRD-08 (body, excerpt, email text).
- **NFR-5**: Unread dots have screen-reader text "Unread".
- **NFR-6**: No visibility outside the audience. Scheduled and expired items are hidden from feeds.
- **NFR-7**: Timestamps are stored in UTC and displayed in the school timezone.
- **NFR-8**: Brownfield reuse, no re-scaffolding. Lint, typecheck and tests stay green.
- **NFR-9**: Out of scope: comments, reactions, translation, SMS, and the PRD-18 pages themselves.
- **NFR-10**: Unit, integration (property-style audience parity, notification idempotency) and Playwright tests as listed.
- **NFR-11**: Use `logger`, never `console.log`.
