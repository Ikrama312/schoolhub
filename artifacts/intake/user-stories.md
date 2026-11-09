# SH-13 — PRD-13 Direct Messaging: User Stories

## Data & rules
- **FR-1, FR-2, FR-3, FR-4, FR-30, FR-31** — As the platform, I want conversations, participants, messages, attachments, reports, revisions, pending emails and quiet-hour settings stored, so that messaging is auditable and recoverable for safeguarding.
- **FR-5, FR-32** — As the school, I want every sender→recipient pair checked against the contact matrix, so that students only reach their own teachers and never other students or parents.
- **FR-6** — As a teacher, I want to message a student or a group of up to 25 students in my course, so that I can follow up on work, and the platform must refuse groups that break the rules.
- **FR-7** — As the school, I want rules re-checked on every send, so that a student whose enrollment was dropped can no longer message that teacher.
- **FR-8** — As a user, I want a grouped contact list of only the people I may message, so that I can find the right recipient quickly.

## Inbox
- **FR-9** — As a user, I want an inbox sorted by latest activity, with unread badges, search and an Archived tab, so that I respond promptly.
- **FR-10** — As a user, I want a thread with day-grouped timestamps, attachments, and edited/deleted markers, so that I can follow the conversation.
- **FR-11** — As a user, I want a composer with keyboard send, attachments and a length counter, so that I can write messages efficiently.
- **FR-12** — As a user, I want a new-conversation dialog with a recipient picker, so that I can start private or group conversations.
- **FR-13** — As a user, I want new messages to appear within seconds without refreshing, so that conversations feel live.
- **FR-14** — As a user, I want to mute, archive, view participants or leave a group, so that I control my inbox.
- **FR-15** — As a sender, I want to edit or delete my message within 15 minutes, so that I can fix mistakes.

## Entry points
- **FR-16** — As a parent, I want "Message teacher" on my child's page, so that I can contact their teacher in under 30 seconds. As a teacher, I want "Message parents", so that both guardians receive the same information.
- **FR-17** — As a teacher, I want "Message selected students" on the course roster, so that I can message a group from the course.
- **FR-18** — As a user, I want a "Messages" sidebar entry with an unread count, so that I notice new messages.

## Notifications & quiet hours
- **FR-19** — As a user, I want one in-app notification per conversation, so that my notifications don't pile up.
- **FR-20, FR-4** — As a user, I want an email only if I haven't read a message within 10 minutes, so that I'm not spammed.
- **FR-21** — As a teacher, I want quiet hours, so that I am not emailed about messages in the evening.

## Reporting & safeguarding
- **FR-22** — As a user, I want to report an inappropriate message, so that the school can act.
- **FR-23, FR-26** — As a safeguarding admin, I want to be notified of reports and work through a queue with surrounding context, so that students are protected.
- **FR-24, FR-3, FR-25** — As a safeguarding admin, I want to review any conversation involving a student, including original edited and deleted content, with every view audited, so that review is thorough and accountable.
- **FR-27** — As a participant or safeguarding lead, I want access to message attachments, so that I see what was shared, and nobody else can.
- **FR-28** — As a client developer, I want a consistent REST API, so that the UI and tests can use messaging.
- **FR-29** — As a developer/tester, I want seeded conversations and a reported message, so that I can demo and test the feature.

## Non-Functional Requirements
- **NFR-1 Security** — participation, role and safeguarding-lead checks run on the server for every endpoint. Cuids are not authorisation.
- **NFR-2 Performance** — polling responses take under 100 ms, use the index, and return empty arrays when nothing changed.
- **NFR-3 Retention** — no hard deletes by users. Soft-deleted content and revisions are kept.
- **NFR-4 Rate limit** — 30 messages/min/user, with 429 beyond that.
- **NFR-5 UI component rule** — MUI only, every component looked up through mui-mcp, no banned libraries. QA verifies this.
- **NFR-6 Conventions** — Zod validators, thin handlers, services under `src/server/messaging/`, standard response shapes, UTC storage with school-timezone display, logger.
- **NFR-7 Responsive** — single pane with back navigation below 768 px.
- **NFR-8 Near-real-time** — a message shows in another browser within 6 s via polling. No websockets.
- **NFR-9 Scope guard** — no calls, typing indicators, reactions, E2E encryption, websockets or broadcast.
- **NFR-10 Tests** — contact-matrix unit tests, integration tests (collapsing, quiet hours, revisions), Playwright round trip and student block. The existing suite stays green.
- **NFR-11 Audit** — safeguarding mutations write AuditLog rows.
