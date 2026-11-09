// Pure (NFR-10): no Prisma client. Term containment compares school-local calendar dates.
import { schoolToday } from '@/server/attendance/attendance-rules';

export interface PlacementTerm {
  id: string;
  /** @db.Date values (UTC midnight) or 'yyyy-MM-dd'. */
  startDate: Date | string;
  endDate: Date | string;
}

const day = (d: Date | string) => (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10));

function containing<T extends PlacementTerm>(date: string, terms: readonly T[]): T | null {
  return terms.find((t) => day(t.startDate) <= date && date <= day(t.endDate)) ?? null;
}

/**
 * FR-3 / A6: the term whose dates contain `date` in the school timezone; else the term containing
 * today; else null (the caller skips the item and logs a warning).
 */
export function termFor<T extends PlacementTerm>(date: Date | null, terms: readonly T[], tz: string, now: Date): T | null {
  return (date ? containing(schoolToday(date, tz), terms) : null) ?? containing(schoolToday(now, tz), terms);
}
