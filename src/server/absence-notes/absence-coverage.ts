/**
 * PRD-15 pure absence-note coverage (FR-23 to FR-25, FR-27). No Prisma, so the
 * FR-46 unit tests and attendance-service share one rule. Dates are yyyy-MM-dd.
 * - whole-day note: every period on every date in [fromDate, toDate]
 * - partial note: only its periodIds on those dates
 * - a record with a null periodId (daily homeroom) is covered by any note for that date
 */
export interface CoverageNote {
  fromDate: string;
  toDate: string;
  partialDay: boolean;
  periodIds: string[];
}

export function coversRecord(note: CoverageNote, rec: { date: string; periodId: string | null }): boolean {
  if (rec.date < note.fromDate || rec.date > note.toDate) return false;
  if (!note.partialDay || rec.periodId === null) return true;
  return note.periodIds.includes(rec.periodId);
}
