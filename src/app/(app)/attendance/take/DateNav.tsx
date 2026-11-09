'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { format } from 'date-fns';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { addDays, canOpen, type RuleRole } from '@/server/attendance/attendance-rules';

const toLocal = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day);
};

/** FR-8: pick a register date; never the future, teachers only the last 14 days (same canOpen rule as the server). */
export function DateNav({ date, today, role }: { date: string; today: string; role: RuleRole }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (
    <DatePicker
      label="Register date"
      value={toLocal(date)}
      disableFuture
      maxDate={toLocal(today)}
      minDate={role === 'TEACHER' ? toLocal(addDays(today, -14)) : undefined}
      shouldDisableDate={(d) => !canOpen(role, format(d, 'yyyy-MM-dd'), today).ok}
      onChange={(d) => {
        if (!d || Number.isNaN(d.getTime())) return;
        const next = new URLSearchParams(searchParams.toString());
        next.set('date', format(d, 'yyyy-MM-dd'));
        router.push(`${pathname}?${next.toString()}`);
      }}
      slotProps={{ textField: { size: 'small' } }}
    />
  );
}
