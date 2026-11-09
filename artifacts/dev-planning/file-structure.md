# File Structure: SH-12 (PRD-12 Announcements & News)

Brownfield. `+` marks a new file (CREATE) and `~` marks an existing file that is changed (MODIFY). Nothing is deleted. No new dependencies are added (ADR-1).

```
prisma/
├── ~ schema.prisma                                   TASK-1  (enums, 4 models, lastRemindedAt, indexes, back-relations)
├── migrations/
│   └── 20261112000000_add_announcements/
│       └── + migration.sql                           TASK-1
└── ~ seed.ts                                         TASK-19 (6 announcements, skip-if-missing)

src/
├── lib/validators/
│   └── + announcements.ts                            TASK-2
├── config/
│   ├── ~ navigation.ts                               TASK-13 (NavItem.badgeEndpoint, Announcements entry)
│   ├── ~ course-tabs.ts                              TASK-18
│   └── ~ public-routes.ts                            TASK-12 ('/api/public/news')
├── server/
│   ├── announcements/
│   │   ├── + excerpt.ts                              TASK-3  toPlainText
│   │   ├── + audience.ts                             TASK-4  generic audience service
│   │   ├── + announcements-service.ts                TASK-6 (write side), TASK-7 (read side)
│   │   ├── + maintenance.ts                          TASK-8  publishDueAnnouncements
│   │   └── + files.ts                                TASK-9  announcementFileResolver
│   ├── notifications/
│   │   ├── ~ types.ts                                TASK-5
│   │   └── ~ notify.ts                               TASK-5  (mandatoryInApp override)
│   └── files/
│       └── ~ contexts.ts                             TASK-9
└── app/
    ├── (app)/
    │   ├── ~ shell.tsx                               TASK-13 (Badge + 30 s poll)
    │   ├── announcements/
    │   │   ├── + page.tsx                            TASK-14 feed
    │   │   ├── + AnnouncementFeed.tsx                TASK-14 (also used by the course tab)
    │   │   ├── + AnnouncementCard.tsx                TASK-14
    │   │   ├── + AnnouncementComposer.tsx            TASK-16
    │   │   ├── + AudienceBuilder.tsx                 TASK-16
    │   │   ├── new/
    │   │   │   └── + page.tsx                        TASK-16
    │   │   ├── manage/
    │   │   │   ├── + page.tsx                        TASK-17
    │   │   │   └── + ManageTable.tsx                 TASK-17
    │   │   └── [id]/
    │   │       ├── + page.tsx                        TASK-15 detail
    │   │       ├── + AnnouncementDetailView.tsx      TASK-15
    │   │       ├── edit/
    │   │       │   └── + page.tsx                    TASK-16
    │   │       └── stats/
    │   │           ├── + page.tsx                    TASK-17
    │   │           └── + StatsView.tsx               TASK-17
    │   └── courses/[courseId]/announcements/
    │       └── + page.tsx                            TASK-18
    └── api/
        ├── announcements/
        │   ├── + route.ts                            TASK-10 GET feed, POST create
        │   ├── unread-count/+ route.ts               TASK-10
        │   ├── preview-audience/+ route.ts           TASK-10
        │   ├── manage/+ route.ts                     TASK-10
        │   └── [id]/
        │       ├── + route.ts                        TASK-11 GET, PATCH
        │       ├── archive/+ route.ts                TASK-11
        │       ├── ack/+ route.ts                    TASK-11
        │       ├── stats/+ route.ts                  TASK-11 (?format=csv)
        │       └── remind/+ route.ts                 TASK-11
        ├── public/news/+ route.ts                    TASK-12
        └── internal/email/dispatch/~ route.ts        TASK-8

tests/
├── unit/
│   ├── validators/+ announcements.test.ts            TASK-2
│   └── announcements/
│       ├── + excerpt.test.ts                         TASK-3
│       ├── + audience-match.test.ts                  TASK-4
│       └── + permissions.test.ts                     TASK-6
├── integration/announcements/
│   ├── + audience-agreement.test.ts                  TASK-20
│   ├── + publish.test.ts                             TASK-20
│   └── + api.test.ts                                 TASK-20 (fixture creates Pat's 6A child)
└── e2e/
    └── + announcements.spec.ts                       TASK-21
```

Notes:
- The course route segment in this repo is `[courseId]`, not `[id]` as system-design §2.7 writes it. The plan uses the real path, `src/app/(app)/courses/[courseId]/announcements/page.tsx`.
- The sidebar lives in `src/app/(app)/shell.tsx`, which renders `navigationForRole()`. The badge goes there. There is no separate sidebar component.
- `announcements-service.ts` is split across two tasks (TASK-6 CREATE, TASK-7 MODIFY) so the dev continuation loop can track partial progress on the largest file.
