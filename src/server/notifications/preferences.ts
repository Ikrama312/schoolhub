import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import type { UpdatePreferenceBody } from '@/lib/validators/notifications';
import {
  getTypeDef,
  NOTIFICATION_TYPES,
  visibleTypesFor,
  type NotificationCategory,
  type NotificationTypeDef,
  type Role,
} from './types';

export interface ResolvedPrefs {
  inApp: boolean;
  email: boolean;
}

/** FR-7: mandatory in-app always wins; missing row → in-app on, email = registry default. Pure. */
export function resolvePrefs(
  def: Pick<NotificationTypeDef, 'mandatoryInApp' | 'defaultEmail'>,
  row?: { inApp: boolean; email: boolean } | null,
): ResolvedPrefs {
  return { inApp: def.mandatoryInApp || (row?.inApp ?? true), email: row?.email ?? def.defaultEmail };
}

export interface NotificationPreferenceItem extends ResolvedPrefs {
  type: string;
  label: string;
  description: string;
  category: NotificationCategory;
  mandatoryInApp: boolean;
}

function toItem(type: string, def: NotificationTypeDef, row?: { inApp: boolean; email: boolean } | null) {
  return {
    type,
    label: def.label,
    description: def.description,
    category: def.category,
    mandatoryInApp: def.mandatoryInApp,
    ...resolvePrefs(def, row),
  } satisfies NotificationPreferenceItem;
}

/** FR-37: role-visible, non-emailOnly types merged with the user's rows. */
export async function getPreferencesFor(user: { id: string; role: Role }): Promise<NotificationPreferenceItem[]> {
  const types = visibleTypesFor(user.role);
  const rows = await prisma.notificationPreference.findMany({ where: { userId: user.id, type: { in: types } } });
  const byType = new Map(rows.map((r) => [r.type, r]));
  return types.map((type) => toItem(type, NOTIFICATION_TYPES[type], byType.get(type)));
}

/** FR-38: rejects unknown / emailOnly / role-invisible types and inApp:false on mandatory types. */
export async function updatePreference(
  user: { id: string; role: Role },
  body: UpdatePreferenceBody,
): Promise<NotificationPreferenceItem> {
  const def = getTypeDef(body.type);
  if (!def || def.emailOnly || !def.roles.includes(user.role)) {
    throw new AppError('VALIDATION_ERROR', 'Unknown notification type', { type: body.type });
  }
  if (def.mandatoryInApp && !body.inApp) {
    throw new AppError('VALIDATION_ERROR', 'In-app notifications for this type are required by the school', {
      type: body.type,
    });
  }
  const row = await prisma.notificationPreference.upsert({
    where: { userId_type: { userId: user.id, type: body.type } },
    update: { inApp: body.inApp, email: body.email },
    create: { userId: user.id, type: body.type, inApp: body.inApp, email: body.email },
  });
  return toItem(body.type, def, row);
}
