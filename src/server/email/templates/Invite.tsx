import * as React from 'react';
import { Button, Section, Text } from '@react-email/components';
import { BaseLayout, buttonStyle, textStyle, type EmailSchool } from './BaseLayout';

export interface InviteData {
  name: string;
  link: string;
  expiresAt: string;
}

/** FR-15: name, school name, accept link, expiry date. */
export function Invite({ school, appUrl, data }: { school: EmailSchool; appUrl: string; data: InviteData }) {
  return (
    <BaseLayout school={school} appUrl={appUrl} preview={`You're invited to ${school.name}`}>
      <Text style={textStyle}>Hi {data.name},</Text>
      <Text style={textStyle}>
        You have been invited to join {school.name} on SchoolHub. Accept your invitation to set your password and sign in.
      </Text>
      <Section style={{ margin: '24px 0' }}>
        <Button href={data.link} style={buttonStyle}>
          Accept invitation
        </Button>
      </Section>
      <Text style={textStyle}>This invitation expires on {data.expiresAt}.</Text>
    </BaseLayout>
  );
}
