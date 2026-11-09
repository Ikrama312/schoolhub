import * as React from 'react';
import { Button, Section, Text } from '@react-email/components';
import { BaseLayout, buttonStyle, textStyle, type EmailSchool } from './BaseLayout';

export interface GenericNotificationData {
  title: string;
  body?: string | null;
  /** Safe relative path; the CTA points at APP_URL + link. */
  link?: string | null;
  ctaLabel?: string;
}

/** FR-15: title, body (plain text, pre-line), CTA to APP_URL + link. */
export function GenericNotification({
  school,
  appUrl,
  data,
}: {
  school: EmailSchool;
  appUrl: string;
  data: GenericNotificationData;
}) {
  return (
    <BaseLayout school={school} appUrl={appUrl} preview={data.title}>
      <Text style={{ ...textStyle, fontSize: 16, fontWeight: 700 }}>{data.title}</Text>
      {data.body && <Text style={{ ...textStyle, whiteSpace: 'pre-line' }}>{data.body}</Text>}
      {data.link && (
        <Section style={{ margin: '24px 0' }}>
          <Button href={`${appUrl}${data.link}`} style={buttonStyle}>
            {data.ctaLabel ?? 'View in SchoolHub'}
          </Button>
        </Section>
      )}
    </BaseLayout>
  );
}
