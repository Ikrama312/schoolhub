# UI Verification Report — SH-13 (PRD-13 Direct Messaging)

- **Ticket:** SH-13
- **Status:** complete
- **Result:** 25 findings: **23 PASS, 1 FAIL, 1 BLOCKED**

> This replaces the stale SH-11 report and screenshots, which are still in git history. `ui-verification-report.json` has the same findings in machine-readable form, and `uiv-raw.json` has the raw probe output.

## Headline

Every SH-13 surface rendered and behaved as specified:

- the inbox, thread and composer
- the new-message dialog and its contact groups
- editing, deleting and reporting messages
- mute, archive, view participants and leave group
- the actions on the student page and the course roster
- quiet hours
- the 375 px single-pane layout
- the safeguarding reports and conversations views

A message sent in one browser appeared in the other browser's open thread in about **5.35 s**, within the 6 s limit.

One visual defect needs fixing:

| ID | Severity | Surface | Problem | Fix |
|---|---|---|---|---|
| **UIV-1** | moderate | `/admin/safeguarding` report drawer | The right-hand Drawer (z-index 1200) opens **under** the fixed AppBar (z-index drawer+1). The drawer's header, with the "Report" title and the **Close button**, is covered and can't be clicked: `elementFromPoint` returns the app bar and the click times out. Users can only close the drawer with Esc or a backdrop click. | Add `sx={{ zIndex: (t) => t.zIndex.modal }}` to the `<Drawer>` in `src/components/messaging/SafeguardingReports.tsx:181` |

## Minor observations

- **UIV-2 (a11y):** axe flags `list` (serious) on `/messages` and `/account/notifications`. `ListItemButton` renders as an `<a>` directly inside a `<ul>`. It also flags `heading-order` and `region` (moderate); `region` is an app-wide pattern. One run showed `color-contrast` ×1 on `/admin/safeguarding`.
- **UIV-3 (a11y):** the muted icon in a conversation row has `aria-label="Muted"`, but MUI's SvgIcon sets `aria-hidden` unless `titleAccess` is set, so screen readers never hear about it. Use `titleAccess="Muted"` instead.
- **UIV-4:** when the last message in a conversation is deleted, the list preview reads "This message was deleted" with no `sender:` prefix. Product should confirm whether that's intended.
- **UIV-5:** the "Conversation muted" toast didn't appear while an earlier toast was still on screen. The mute itself succeeded.
- **UIV-6 (not exercised in the UI; QA covers these at service level):**
  - upward infinite scroll at 30 messages per page
  - the 30 s list/badge poll timing
  - the error shown at the 25-participant cap
  - deferred email (FR-20)
- **ENV-1:** the production CSP (`script-src 'self'`) blocks Next's inline hydration scripts under `next start`, so no client UI hydrates. This predates SH-13 (ADR-4), and the existing E2E specs use `bypassCSP`, as this run did. Production still needs a nonce.
- **ENV-2:** the in-memory per-IP login rate limit forced a server restart between driver runs. This is expected behaviour.

## Method

- **Build and server:** `npm run build` (exit 0), served with `next start -p 3300` against Postgres :5433. The :3000 and :3001 servers were left alone.
- **Drivers:** throwaway Playwright scripts outside the repo: `/tmp/uiv-sh13/driver.cjs` and `supp.cjs`. The supplementary script covers the safeguarding drawer and a student conversation with edited and deleted messages.
- **Fixtures:** tagged `uiv-sh13*`:
  - a safeguarding-lead admin and a non-lead admin
  - a teacher, and a parent linked to student 1
  - 2 students and 1 course
- **Viewports:** 1280×800 and 375×667. DB state was checked after mutations. All fixtures were removed (0 remaining).
- **Design reference:** `figma-readiness.json` does not exist, so the comparison is against `requirements.json` only.

## Findings

| Req | Surface | Verdict | Notes |
|---|---|---|---|
| FR-9 | `/messages` inbox | PASS | Two panes, Inbox/Archived tabs, search and an empty state. Rows show avatar, subject, relative time and a "Pam: …" preview. Unread rows are bold (700) with a count badge. (UIV-4) |
| FR-10 | Message thread | PASS | Avatar, name and time on each message. Day divider in the school timezone (America/New_York). FileList attachment, "(edited)" and *This message was deleted* all render. Infinite scroll not exercised (UIV-6). |
| FR-11 | Composer | PASS | Enter sends and Shift+Enter adds a newline. The counter "4600 / 5000" appears past 4,500. Send is disabled at 5,001. Attach files works ("0 / 5" indicator), and the attachment is delivered. |
| FR-12 | New-message dialog | PASS | Grouped "To" picker, optional subject and a message field. Send closes the dialog and navigates to the new thread. |
| FR-8 | Contact groups | PASS | Parent sees "My child's teachers (Sam)" and "School office". Student sees "My teachers" and "School office". Another student isn't offered ("No one you can message matches"). Student-to-student API create returns 403. |
| FR-6 | Staff-created group | PASS | A student can reply in a teacher-created group. |
| FR-7 | Ended relationship | PASS | A dropped student sees an info Alert, "You can no longer send messages in this conversation.". The API returns 403. The teacher can still send. |
| FR-13 | Thread polling | PASS | The new message appeared in the other open thread after about 5.35 s. |
| FR-14 | Conversation menu | PASS | Mute adds a bell-off icon and changes the menu item to "Unmute". Archive moves the conversation to the Archived tab; Unarchive works. The Participants dialog shows role chips. Opening the thread sets `lastReadAt` and clears the badge. (UIV-3, UIV-5) |
| FR-14 | Leave group | PASS | Confirm dialog, then the conversation leaves the list. Reopening it gives 404. The creator of a group with students isn't offered "Leave group". |
| FR-15 | Edit/delete own message | PASS | Inline edit shows "(edited)". Delete has a confirm dialog and leaves the deleted placeholder. Messages older than 15 minutes have no options button, and a late PATCH returns 403. |
| FR-16 | Student page actions | PASS | Teacher: "Message parents" opens the dialog prefilled with Pam Parent. Parent: "Message teacher" is limited to the "My child's teachers (Sam)" group. |
| FR-17 | Roster selection | PASS | The button is disabled until a student is selected. Select all prefills both students. The new group has 3 participants and `involvesStudent=true`. |
| FR-18 | Sidebar Messages and badge | PASS | Shown for all roles at 1280 px and in the 375 px nav. The badge appears for unread conversations and clears after reading. |
| FR-21 | Quiet hours | PASS | Start/End time fields with a timezone hint. 22:00–07:00 (wrapping past midnight) saves and persists. No horizontal scroll at 375 px. |
| FR-22 | Report message | PASS | Reason dialog, then the toast "Reported — the school will review this.". No Report option on your own messages. |
| FR-23 | Safeguarding reports queue | PASS | The lead sees the nav entry and the OPEN report. The drawer shows the reason, participants and ±5 messages of context with the reported message highlighted. "Mark reviewed" requires a note, and the status changes to REVIEWED. A non-lead admin gets no nav entry, `/forbidden` and an API 403. |
| FR-23 | Report drawer header | **FAIL** | **UIV-1:** the title and Close button are hidden under the AppBar. |
| FR-24 | Safeguarding conversations | PASS | Participant and date filters. Only conversations with a student are listed. The read-only view has no composer and shows deleted bodies (with a "Deleted" chip), an "Edited" chip and "Earlier versions" with the original text. |
| FR-25 | View audit | PASS | Each view writes a `safeguarding.conversation.view` audit row. |
| FR-26 | Lead notification | PASS | The lead's bell shows an unread badge after the report. |
| FR-2 | Admin user form flag | BLOCKED | No admin user form exists (ADR-11, accepted at intake), so there was no UI to render. QA verified the flag via `PATCH /api/users/:id`. |
| NFR-7 | < 768 px single pane | PASS | At 375 px the list and the thread show one at a time, the back arrow returns to the list, and there is no horizontal scroll. |
| NFR-5 | MUI-only | PASS | Every rendered surface uses MUI components. |
| NFR-8 | Near-real-time | PASS | About 5.35 s via polling. |

## Evidence

All files are in `screenshots/`:

- **Parent:**
  - `parent-messages-empty-1280`
  - `parent-new-message-{contacts,filled}-1280`
  - `parent-after-send-1280`
  - `parent-composer-counter-1280`
  - `parent-thread-attachment-1280`
  - `parent-delete-confirm-1280`
  - `parent-thread-edited-deleted-1280`
  - `parent-student-message-teacher-1280`
  - `parent-quiet-hours-{1280,375}`
- **Teacher:**
  - `teacher-inbox-unread-1280`
  - `teacher-thread-1280`
  - `teacher-report-dialog-1280`
  - `teacher-reported-toast-1280`
  - `teacher-conversation-menu-1280`
  - `teacher-after-mute-1280`
  - `teacher-participants-1280`
  - `teacher-archived-tab-1280`
  - `teacher-roster-{selected,dialog}-1280`
  - `teacher-student-message-parents-1280`
- **Student:**
  - `student-new-message-contacts-375`
  - `student-inbox-375`
  - `student-thread-375`
  - `student-leave-confirm-375`
  - `student-left-not-found-375`
  - `student-relationship-ended-1280`
- **Safeguarding lead:**
  - `lead-safeguarding-reports-1280`
  - `lead-report-drawer-1280`
  - `lead-report-drawer-student-1280` (UIV-1)
  - `lead-report-reviewed-1280`
  - `lead-safeguarding-conversations-1280`
  - `lead-safeguarding-conversation-view-1280`
  - `lead-safeguarding-student-view-1280`
  - `lead-reported-conversation-view-1280`
- **Non-lead admin:** `admin-nonlead-safeguarding-1280`
