import type { Metadata } from 'next';
import InitColorSchemeScript from '@mui/material/InitColorSchemeScript';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'SchoolHub',
  description: 'SchoolHub — single-school web platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <InitColorSchemeScript attribute="class" />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
