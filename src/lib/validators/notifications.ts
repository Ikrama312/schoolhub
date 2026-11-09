import { z } from 'zod';
import { NOTIFICATION_CATEGORIES } from '@/server/notifications/types';

/** Shared notification validation (PRD-04 FR-41, NFR-6, NFR-18). */

export const TITLE_MAX = 140;
export const BODY_MAX = 500;

/**
 * Only same-origin relative paths (ADR-10): must start with '/', must not be
 * protocol-relative ('//' or '/\'), no backslashes, no control characters.
 */
export function isSafeRelativeLink(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith('/')) return false;
  if (value[1] === '/' || value[1] === '\\') return false;
  if (value.includes('\\')) return false;
  // eslint-disable-next-line no-control-regex
  return !/[\u0000-\u001f\u007f]/.test(value);
}

export const listNotificationsQuery = z.object({
  unread: z.enum(['true', 'false']).optional(),
  category: z.enum(NOTIFICATION_CATEGORIES).optional(),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuery>;

export const updatePreferenceBody = z
  .object({ type: z.string().min(1), inApp: z.boolean(), email: z.boolean() })
  .strict();
export type UpdatePreferenceBody = z.infer<typeof updatePreferenceBody>;

export const EMAIL_STATUSES = ['PENDING', 'SENDING', 'SENT', 'FAILED'] as const;
export type EmailStatusValue = (typeof EMAIL_STATUSES)[number];

export const emailLogQuery = z.object({ status: z.enum(EMAIL_STATUSES).optional() });
export type EmailLogQuery = z.infer<typeof emailLogQuery>;
