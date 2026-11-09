export interface DateRange {
  startDate: Date;
  endDate: Date;
}

/** True when two inclusive date ranges share at least one day. */
export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

/** True when `inner` falls entirely inside `outer` (inclusive on both ends). */
export function rangeContains(outer: DateRange, inner: DateRange): boolean {
  return inner.startDate >= outer.startDate && inner.endDate <= outer.endDate;
}
