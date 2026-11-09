import { prisma } from '@/server/db';
import { logger } from '@/lib/logger';
import { BODY_MAX, isSafeRelativeLink, TITLE_MAX } from '@/lib/validators/notifications';
import { getEmailSchool, renderEmail } from '@/server/email/render';
import { resolvePrefs } from './preferences';
import { NOTIFICATION_TYPES, type NotificationType } from './types';

export interface NotifyInput {
  type: NotificationType;
  userIds: string[];
  title: string;
  body?: string;
  link?: string;
  email?: { subject?: string; template: 'generic-notification'; data?: Record<string, unknown> };
  /** PRD-13 FR-20: false skips the in-app row (email-only send of a deferred message email). Default true. */
  inApp?: boolean;
}

function truncate(value: string, max: number, field: string, type: string): string {
  if (value.length <= max) return value;
  logger.warn('Notification field truncated', { field, type, length: value.length, max });
  return value.slice(0, max);
}

/**
 * Single producer entry point (FR-6..11). Writes in-app rows and enqueues
 * emails per resolved preferences. NEVER throws — failures are logged.
 * Call after your transaction commits.
 */
export async function notify(input: NotifyInput): Promise<void> {
  try {
    const def = NOTIFICATION_TYPES[input.type];
    const userIds = [...new Set(input.userIds)];
    if (!def || userIds.length === 0) return;

    const title = truncate(input.title, TITLE_MAX, 'title', input.type);
    const body = input.body == null ? null : truncate(input.body, BODY_MAX, 'body', input.type);
    let link: string | null = input.link ?? null;
    if (link !== null && !isSafeRelativeLink(link)) {
      logger.warn('Notification link dropped (not a safe relative path)', { type: input.type });
      link = null;
    }

    const [users, prefRows] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: userIds }, status: { notIn: ['DISABLED', 'ARCHIVED'] }, archivedAt: null },
        select: { id: true, email: true, firstName: true },
      }),
      prisma.notificationPreference.findMany({ where: { userId: { in: userIds }, type: input.type } }),
    ]);
    const prefByUser = new Map(prefRows.map((r) => [r.userId, r]));

    const inAppIds: string[] = [];
    const emailTo: { email: string; firstName: string }[] = [];
    for (const user of users) {
      const prefs = resolvePrefs(def, prefByUser.get(user.id));
      if (prefs.inApp && input.inApp !== false) inAppIds.push(user.id);
      if (prefs.email && input.email && user.email) emailTo.push(user);
    }

    if (inAppIds.length) {
      await prisma.notification.createMany({
        data: inAppIds.map((userId) => ({ userId, type: input.type, title, body, link })),
      });
    }

    if (emailTo.length && input.email) {
      // Rendered once per call (ADR-6): generic emails carry no per-recipient greeting.
      const school = await getEmailSchool();
      const { html, text } = await renderEmail(
        input.email.template,
        { title, body, link, ...(input.email.data ?? {}) },
        school,
      );
      const subject = input.email.subject ?? title;
      await prisma.emailOutbox.createMany({
        data: emailTo.map((u) => ({ toEmail: u.email, toName: u.firstName, subject, html, text })),
      });
    }
  } catch (error) {
    logger.error('notify() failed', {
      type: input.type,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Students ∪ their linked parents, deduped (FR-12). Pure. */
export function expandStudentRecipients(
  studentIds: string[],
  links: { studentId: string; parentId: string }[],
): string[] {
  const students = new Set(studentIds);
  const ids = new Set(studentIds);
  for (const link of links) if (students.has(link.studentId)) ids.add(link.parentId);
  return [...ids];
}

/** notify() for students and every parent linked to them (FR-12). Never throws. */
export async function notifyStudentAndParents(
  input: Omit<NotifyInput, 'userIds'> & { studentIds: string[] },
): Promise<void> {
  try {
    const { studentIds, ...rest } = input;
    const links = await prisma.parentStudentLink.findMany({
      where: { studentId: { in: studentIds } },
      select: { studentId: true, parentId: true },
    });
    await notify({ ...rest, userIds: expandStudentRecipients(studentIds, links) });
  } catch (error) {
    logger.error('notifyStudentAndParents() failed', {
      type: input.type,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
