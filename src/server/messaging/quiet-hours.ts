import { fromZonedTime } from 'date-fns-tz';
import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import { formatInSchoolTz } from '@/lib/dates';
import type { MessagingSettingsInput } from '@/lib/validators/messaging';

/** PRD-13 quiet hours (FR-20, FR-21, ADR-6, ADR-12). HH:mm strings in the school timezone; ranges may wrap midnight. */

export interface QuietHours {
  quietStart: string | null;
  quietEnd: string | null;
}

/** [start, end) — e.g. 22:00–07:00 covers 23:30 and 06:59 but not 07:00. start === end is never quiet. */
export function isInQuietHours(hhmm: string, start: string, end: string): boolean {
  if (start === end) return false;
  return start < end ? hhmm >= start && hhmm < end : hhmm >= start || hhmm < end;
}

/** The UTC instant quiet hours end, or null when `now` is outside quiet hours (or none are set). DST-safe via fromZonedTime. */
export function quietHoursEnd(now: Date, tz: string, settings: QuietHours | null): Date | null {
  if (!settings?.quietStart || !settings.quietEnd) return null;
  if (!isInQuietHours(formatInSchoolTz(now, 'HH:mm', tz), settings.quietStart, settings.quietEnd)) return null;
  const today = formatInSchoolTz(now, 'yyyy-MM-dd', tz);
  const end = fromZonedTime(`${today} ${settings.quietEnd}`, tz);
  if (end > now) return end;
  const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return fromZonedTime(`${tomorrow} ${settings.quietEnd}`, tz);
}

export async function getSettings(userId: string): Promise<QuietHours> {
  const row = await prisma.messagingSettings.findUnique({ where: { userId }, select: { quietStart: true, quietEnd: true } });
  return { quietStart: row?.quietStart ?? null, quietEnd: row?.quietEnd ?? null };
}

export async function putSettings(userId: string, input: MessagingSettingsInput): Promise<QuietHours> {
  const { quietStart, quietEnd } = input;
  if ((quietStart === null) !== (quietEnd === null)) throw new AppError('VALIDATION_ERROR', 'Set both start and end, or neither.');
  if (quietStart !== null && quietStart === quietEnd) throw new AppError('VALIDATION_ERROR', 'Start and end must differ.');
  const row = await prisma.messagingSettings.upsert({
    where: { userId },
    create: { userId, quietStart, quietEnd },
    update: { quietStart, quietEnd },
    select: { quietStart: true, quietEnd: true },
  });
  return row;
}
