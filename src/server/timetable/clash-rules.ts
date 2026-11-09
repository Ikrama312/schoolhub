/**
 * Pure clash engine (PRD-06 FR-9..FR-14, ADR-4). No Prisma import, so the
 * NFR-11 unit tests run without a DB. timetable-service.ts loads the rows,
 * this decides. Every rule runs; all clashes are returned (FR-14).
 */

export type ClashRule = 'TEACHER' | 'ROOM' | 'SECTION' | 'STUDENT' | 'PERIOD_KIND' | 'NON_TEACHING_DAY';
export type Clash = { rule: ClashRule; message: string };

export interface CandidateCourse {
  id: string;
  code: string;
  teacherId: string;
  coTeacherIds: string[];
  sectionId: string | null;
  sectionName?: string | null;
  subjectName: string;
}

export interface OtherSlot {
  id: string;
  roomId: string | null;
  roomName?: string | null;
  course: CandidateCourse;
}

export interface CellCtx {
  dayLabel: string;
  period: { name: string; kind: string };
  isTeaching: boolean;
}

export interface ClashOptions {
  /** userId → display name, for the TEACHER message (co-teachers included). */
  teacherNames?: Map<string, string>;
  /** The moving slot itself, skipped on a PATCH (FR-14). */
  excludeSlotId?: string;
}

const teachersOf = (c: CandidateCourse) => [c.teacherId, ...c.coTeacherIds];

export function clashesForCell(
  course: CandidateCourse,
  roomId: string | null,
  cell: CellCtx,
  others: OtherSlot[],
  overlapByCourseId: Map<string, number>,
  opts: ClashOptions = {},
): Clash[] {
  const at = `on ${cell.dayLabel}, ${cell.period.name}.`;
  const rest = others.filter((o) => o.id !== opts.excludeSlotId);
  const clashes: Clash[] = [];

  if (cell.period.kind !== 'CLASS') {
    clashes.push({ rule: 'PERIOD_KIND', message: `Period '${cell.period.name}' is not a class period.` });
  }
  if (!cell.isTeaching) {
    clashes.push({ rule: 'NON_TEACHING_DAY', message: `${cell.dayLabel} is not a teaching day.` });
  }

  const mine = new Set(teachersOf(course));
  for (const o of rest) {
    for (const t of new Set(teachersOf(o.course))) {
      if (!mine.has(t)) continue;
      const name = opts.teacherNames?.get(t) ?? 'A teacher';
      clashes.push({ rule: 'TEACHER', message: `Clash: ${name} already teaches ${o.course.code} ${at}` });
    }
  }

  if (roomId) {
    for (const o of rest) {
      if (o.roomId !== roomId) continue;
      clashes.push({ rule: 'ROOM', message: `Clash: ${o.roomName ?? 'The room'} is used by ${o.course.code} ${at}` });
    }
  }

  if (course.sectionId) {
    for (const o of rest) {
      if (o.course.sectionId !== course.sectionId) continue;
      const section = o.course.sectionName ?? course.sectionName ?? 'The section';
      clashes.push({ rule: 'SECTION', message: `Clash: ${section} already has ${o.course.subjectName} ${at}` });
    }
  }

  for (const o of rest) {
    const n = overlapByCourseId.get(o.course.id) ?? 0;
    if (n > 0) {
      clashes.push({
        rule: 'STUDENT',
        message: `Clash: ${n} students in ${course.code} also take ${o.course.code} at this time.`,
      });
    }
  }

  return clashes;
}

/** Half-open [start, end) overlap on 'HH:MM' strings (FR-6). */
export function periodsOverlap(
  a: { startTime: string; endTime: string },
  b: { startTime: string; endTime: string },
): boolean {
  return a.startTime < b.endTime && b.startTime < a.endTime;
}
