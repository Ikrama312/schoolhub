import * as React from 'react';
import { Body, Container, Head, Hr, Html, Img, Link, Preview, Section, Text } from '@react-email/components';
import type { SchoolSettings } from '@prisma/client';

export type EmailSchool = Pick<SchoolSettings, 'name' | 'shortName' | 'logoUrl' | 'addressLine1' | 'addressLine2'>;

export interface BaseLayoutProps {
  school: EmailSchool;
  appUrl: string;
  preview: string;
  children: React.ReactNode;
}

const main = { backgroundColor: '#f4f5f7', fontFamily: 'Helvetica, Arial, sans-serif', margin: 0, padding: '24px 0' };
const container = { backgroundColor: '#ffffff', borderRadius: 8, margin: '0 auto', maxWidth: 560, padding: 32 };
const muted = { color: '#6b7280', fontSize: 12, lineHeight: '18px', margin: '4px 0' };

/** FR-14: school header, content, footer with address + preferences link + fixed sentence. All text is JSX-escaped (NFR-7). */
export function BaseLayout({ school, appUrl, preview, children }: BaseLayoutProps) {
  const address = [school.addressLine1, school.addressLine2].filter(Boolean).join(', ');
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={{ marginBottom: 24 }}>
            {school.logoUrl && <Img src={school.logoUrl} alt={school.shortName} height={40} style={{ marginBottom: 8 }} />}
            <Text style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{school.name}</Text>
          </Section>
          {children}
          <Hr style={{ borderColor: '#e5e7eb', margin: '32px 0 16px' }} />
          {address && <Text style={muted}>{address}</Text>}
          <Text style={muted}>
            <Link href={`${appUrl}/account/notifications`} style={{ color: '#6b7280', textDecoration: 'underline' }}>
              Manage email preferences
            </Link>
          </Text>
          <Text style={muted}>You are receiving this because you have a SchoolHub account.</Text>
        </Container>
      </Body>
    </Html>
  );
}

export const buttonStyle = {
  backgroundColor: '#4f46e5',
  borderRadius: 6,
  color: '#ffffff',
  display: 'inline-block',
  fontSize: 14,
  fontWeight: 600,
  padding: '12px 20px',
  textDecoration: 'none',
};
export const textStyle = { fontSize: 14, lineHeight: '22px', color: '#111827' };
