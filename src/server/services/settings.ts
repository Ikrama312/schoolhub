import { cache } from 'react';
import type { AttendanceMode } from '@prisma/client';
import { prisma } from '@/server/db';

export interface UpdateSchoolSettingsInput {
  name?: string;
  shortName?: string;
  logoUrl?: string | null;
  timezone?: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  /** PRD-07 FR-4/FR-5 */
  attendanceMode?: AttendanceMode;
  attendanceAlertThreshold?: number;
}

/** Cached per request -- the top bar, public footer and this PRD's settings
 * page all read the one singleton row through this. */
export const getSchoolSettings = cache(async () => {
  return prisma.schoolSettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: { id: 'singleton' },
  });
});

export async function updateSchoolSettings(input: UpdateSchoolSettingsInput) {
  return prisma.schoolSettings.update({ where: { id: 'singleton' }, data: input });
}
