import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Remote Support',
  description: 'Consent-based real-time remote screen support',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}