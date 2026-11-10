import type { ReactNode } from 'react';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { formatInSchoolTz, greetingFor } from '@/lib/dates';
import { getSchoolTimezone } from '@/server/assignments/assignments-service';
import { currentTerm } from '@/server/dashboards/insights';

/** PRD-16 FR-3: greeting by school-tz hour, first name, school-tz date and current term. */
export async function GreetingHeader({ firstName, actions }: { firstName: string; actions?: ReactNode }) {
  const now = new Date();
  const [tz, term] = await Promise.all([getSchoolTimezone(), currentTerm(now)]);
  const date = formatInSchoolTz(now, 'EEEE d MMMM yyyy', tz);
  return (
    <PageHeader title={`${greetingFor(now, tz)}, ${firstName}`} description={term ? `${date} · ${term.name}` : date} actions={actions} />
  );
}
