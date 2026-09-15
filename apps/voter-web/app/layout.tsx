import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Keystone — Vote',
  description: 'Cast your ballot in a verifiable election',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
