import { formatInTimeZone } from 'date-fns-tz';
import { env } from '@/lib/env';
import { prisma } from '@/server/db';
import { INVITE_TTL } from '@/server/auth/tokens';
import { enqueueEmail } from '@/server/email/outbox';
import { getEmailSchool, renderEmail } from '@/server/email/render';

export type AuthEmailKind = 'invite' | 'password-reset';

const PATHS: Record<AuthEmailKind, string> = { invite: '/invite/', 'password-reset': '/reset-password/' };
const SUBJECTS: Record<AuthEmailKind, string> = {
  invite: "You're invited to SchoolHub",
  'password-reset': 'Reset your SchoolHub password',
};

export function authLink(kind: AuthEmailKind, rawToken: string): string {
  return new URL(PATHS[kind] + encodeURIComponent(rawToken), env.APP_URL).toString();
}

/**
 * PRD-04 FR-16: renders the invite/password-reset template and enqueues one
 * EmailOutbox row (no Notification row, no preference lookup). Unlike
 * notify(), this still throws: a silently lost invite/reset is worse than a
 * 500. The raw link is never logged.
 */
export async function sendAuthEmail(
  user: { email: string; firstName?: string },
  kind: AuthEmailKind,
  link: string,
): Promise<void> {
  const school = await getEmailSchool();
  const name = user.firstName ?? '';
  let rendered: { html: string; text: string };
  if (kind === 'invite') {
    const settings = await prisma.schoolSettings.findUnique({ where: { id: 'singleton' }, select: { timezone: true } });
    const expires = new Date(Date.now() + INVITE_TTL.days * 24 * 60 * 60_000);
    const expiresAt = formatInTimeZone(expires, settings?.timezone ?? 'UTC', 'MMMM d, yyyy');
    rendered = await renderEmail('invite', { name: name || 'there', link, expiresAt }, school);
  } else {
    rendered = await renderEmail('password-reset', { name: name || undefined, link }, school);
  }
  await enqueueEmail({ toEmail: user.email, toName: name || null, subject: SUBJECTS[kind], ...rendered });
}
