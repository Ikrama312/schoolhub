import { createElement } from 'react';
import { render } from '@react-email/render';
import { env } from '@/lib/env';
import { prisma } from '@/server/db';
import type { EmailSchool } from './templates/BaseLayout';
import { Invite, type InviteData } from './templates/Invite';
import { PasswordReset, type PasswordResetData } from './templates/PasswordReset';
import { GenericNotification, type GenericNotificationData } from './templates/GenericNotification';

/** Template registry (FR-13). Keys are the names producers pass to renderEmail(). */
export const TEMPLATES = {
  invite: Invite,
  'password-reset': PasswordReset,
  'generic-notification': GenericNotification,
} as const;

export type TemplateName = keyof typeof TEMPLATES;

export type TemplateData = {
  invite: InviteData;
  'password-reset': PasswordResetData;
  'generic-notification': GenericNotificationData;
};

/**
 * School header/footer fields for emails. Reads the singleton directly
 * (settings.ts uses react `cache`, which doesn't exist outside Next).
 */
export async function getEmailSchool(): Promise<EmailSchool> {
  const s = await prisma.schoolSettings.findUnique({
    where: { id: 'singleton' },
    select: { name: true, shortName: true, logoUrl: true, addressLine1: true, addressLine2: true },
  });
  return s ?? { name: 'SchoolHub Academy', shortName: 'SchoolHub', logoUrl: null, addressLine1: null, addressLine2: null };
}

/** Renders html + plain text (NFR-9). @react-email/render 1.x is async. */
export async function renderEmail<T extends TemplateName>(
  template: T,
  data: TemplateData[T],
  school: EmailSchool,
): Promise<{ html: string; text: string }> {
  const Component = TEMPLATES[template] as (props: {
    school: EmailSchool;
    appUrl: string;
    data: TemplateData[T];
  }) => React.ReactElement;
  const element = createElement(Component, { school, appUrl: env.APP_URL.replace(/\/$/, ''), data });
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { html, text };
}
