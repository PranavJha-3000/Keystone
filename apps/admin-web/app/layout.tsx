import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Keystone — Admin',
  description: 'Admin dashboard for managing verifiable elections',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
