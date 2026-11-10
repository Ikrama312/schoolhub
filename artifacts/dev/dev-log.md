# Dev Log — SH-14 (PRD-14 School Calendar, Events & Holidays)

> Before this run, this file held SH-13's log and `task-completion-markers.json` held SH-13's markers. Both are replaced for SH-14, following the precedent from earlier tickets. `dev-rerun-count.json` was left untouched because the engine owns it.

## Iteration (continuation, 2026-11-10)

Earlier SH-14 iterations hit the turn limit before writing this log, but they left work on disk. That work was re-verified before any new work started:
- `npm ls` shows the scoped `@mui/x-internals@9.17.0` override is honoured.
- The migration is applied: `prisma migrate status` reports the schema up to date.
- The unit tests pass: 47.

Two fixes were made to that work:
- `escapeText` emitted a bare `;` instead of `\;`.
- `ical.test.ts` had TypeScript errors.

### Checklist (progress so far)
- TASK-1: scheduler + node-ical deps, scoped override, theme augmentation — ✓ complete
- TASK-2: Prisma calendar models + migration 20261113000000_add_calendar — ✓ complete
- TASK-3: schoolMidnight/schoolDateOf + calendar validators + tests — ✓ complete
- TASK-4: expandOccurrences + tests — ✓ complete
- TASK-5: iCal builder + node-ical tests — ✓ complete
- TASK-6: audience resolver + canTargetAudience test — ✓ complete
- TASK-7: event.* notification types — ✓ complete
