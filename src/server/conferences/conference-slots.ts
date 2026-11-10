/**
 * PRD-15 pure slot helpers (FR-29, FR-31). No Prisma.
 */
export interface Interval {
  startsAt: Date;
  endsAt: Date;
}

/** Back-to-back slots of slotMinutes inside each [start, end) range; a trailing partial slot is dropped. */
export function generateSlots(ranges: { start: Date; end: Date }[], slotMinutes: number): Interval[] {
  const step = slotMinutes * 60_000;
  const slots: Interval[] = [];
  for (const r of ranges) {
    for (let t = r.start.getTime(); t + step <= r.end.getTime(); t += step) {
      slots.push({ startsAt: new Date(t), endsAt: new Date(t + step) });
    }
  }
  return slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** Half-open overlap: touching intervals (a ends when b starts) do not overlap. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}
