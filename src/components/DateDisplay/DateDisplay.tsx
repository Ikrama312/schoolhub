import { formatInSchoolTz } from '@/lib/dates';

export interface DateDisplayProps {
  date: Date | string;
  pattern?: string;
  timezone: string;
}

const DEFAULT_PATTERN = 'MMM d, yyyy h:mm a';

/** Renders a UTC date formatted in the school's timezone. */
export function DateDisplay({ date, pattern = DEFAULT_PATTERN, timezone }: DateDisplayProps) {
  return <span>{formatInSchoolTz(date, pattern, timezone)}</span>;
}
