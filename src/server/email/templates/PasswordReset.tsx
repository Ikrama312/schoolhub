import * as React from 'react';
import { Button, Section, Text } from '@react-email/components';
import { BaseLayout, buttonStyle, textStyle, type EmailSchool } from './BaseLayout';

export interface PasswordResetData {
  name?: string;
  link: string;
}

/** FR-15: reset link + 60-minute expiry notice. */
export function PasswordReset({ school, appUrl, data }: { school: EmailSchool; appUrl: string; data: PasswordResetData }) {
  return (
    <BaseLayout school={school} appUrl={appUrl} preview="Reset your SchoolHub password">
      <Text style={textStyle}>{data.name ? `Hi ${data.name},` : 'Hi,'}</Text>
      <Text style={textStyle}>We received a request to reset your password. Use the button below to choose a new one.</Text>
      <Section style={{ margin: '24px 0' }}>
        <Button href={data.link} style={buttonStyle}>
          Reset password
        </Button>
      </Section>
      <Text style={textStyle}>This link expires in 60 minutes.</Text>
      <Text style={textStyle}>If you did not request this, you can ignore this email.</Text>
    </BaseLayout>
  );
}
